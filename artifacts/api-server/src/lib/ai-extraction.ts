/**
 * Shared OpenRouter request + failure-diagnostics helpers.
 *
 * Every AI call in this server used to fail the same opaque way: the provider's
 * status code and error body were thrown away, so a bad key, an exhausted quota,
 * an unknown model and a truncated response all surfaced as one generic 5xx with
 * nothing in the logs to tell them apart. These helpers keep that diagnosis in
 * one place so the three call sites (reservations, ai, accounting) behave alike.
 *
 * Logging rule for everything here: never the API key, never the request payload,
 * never model output. Model output carries extracted customer data, and source
 * documents (emails, receipt images) must not reach the logs at all.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_AI_MODEL = "openai/gpt-4o-mini";

/**
 * AI_MODEL holds either one model or a comma-separated fallback chain
 * ("primary,second,third"). The free OpenRouter tier shares capacity between
 * users, so the primary model intermittently answers with a timeout, a 5xx or
 * JSON that does not match the schema; the later entries are tried in order
 * when that happens. A value without a comma behaves exactly as before.
 */
export function parseModelList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map(model => model.trim()).filter(Boolean);
}

const configuredModels = parseModelList(process.env.AI_MODEL);
export const AI_MODELS: string[] = configuredModels.length > 0 ? configuredModels : [DEFAULT_AI_MODEL];

/** First model of the chain. Kept as a plain string for logs and for callers
 *  that report a single model. */
export const AI_MODEL = AI_MODELS[0];

// undici applies no overall request deadline, so without this an unresponsive
// OpenRouter would keep a handler open indefinitely. Applied per attempt: every
// model in the chain gets its own budget.
export const OPENROUTER_TIMEOUT_MS = 30_000;

function positiveMs(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Ceiling for a whole fallback chain. Three 30s attempts would be 90s, close
 * enough to the platform proxy's ~100s response limit that the connection could
 * drop mid-chain and the caller would see no diagnosis at all. 75s leaves room
 * for two full attempts plus a partial third and still answers in time.
 */
export const AI_TOTAL_TIMEOUT_MS = positiveMs(process.env.AI_TOTAL_TIMEOUT_MS, 75_000);

/** Below this much remaining budget a further attempt cannot finish, so it is
 *  recorded as skipped instead of started and immediately aborted. */
const MIN_ATTEMPT_BUDGET_MS = 5_000;

/** Failure that carries the stage it happened at and provider-side detail. */
export class AiExtractionError extends Error {
  readonly diagnostics: Record<string, unknown>;
  constructor(message: string, diagnostics: Record<string, unknown>) {
    super(message);
    this.name = "AiExtractionError";
    this.diagnostics = diagnostics;
  }
}

/**
 * Pulls the operator-useful fields out of an OpenRouter error payload.
 *
 * Deliberately selective: a moderation rejection echoes the offending input back
 * under `metadata.flagged_input`, so only the error code/type/message and the
 * moderation `reasons` are kept. The raw fallback is capped for the same reason.
 */
export function summarizeOpenRouterError(body: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: unknown; type?: string; metadata?: { reasons?: unknown; provider_name?: unknown } };
    };
    if (parsed.error) {
      return {
        openRouterMessage: typeof parsed.error.message === "string" ? parsed.error.message.slice(0, 300) : undefined,
        openRouterCode: parsed.error.code,
        openRouterType: parsed.error.type,
        openRouterProvider: parsed.error.metadata?.provider_name,
        openRouterReasons: parsed.error.metadata?.reasons,
      };
    }
  } catch {
    // Not JSON — fall through to the capped raw snippet.
  }
  return { openRouterRawBody: body.slice(0, 300) };
}

/**
 * Diagnostic fields for the failure log. AbortSignal.timeout() rejects fetch with
 * a DOMException named "TimeoutError", which is not an AiExtractionError, so it
 * gets its own stage rather than falling into "unexpected".
 */
export function failureDiagnostics(error: unknown, timeoutMs?: number): Record<string, unknown> {
  if (error instanceof AiExtractionError) return error.diagnostics;
  if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError") {
    // timeoutMs is passed by the fallback chain, whose later attempts run on a
    // shorter budget than the per-attempt default.
    return { stage: "timeout", timeoutMs: timeoutMs ?? OPENROUTER_TIMEOUT_MS };
  }
  return { stage: "unexpected" };
}

/** Minimal shape of a pino logger, so callers can pass `req.log` without this
 *  module depending on pino's types. */
export interface AiFailureLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

/**
 * One structured line per AI failure. `context` is spread last, so a caller using
 * a non-default model (accounting) or reporting one attempt of a fallback chain
 * can override the reported `model`.
 */
export function logAiFailure(
  logger: AiFailureLogger,
  error: unknown,
  context: { eventType: string } & Record<string, unknown>,
  message = "AI request failed",
): void {
  logger.error(
    {
      err: error,
      model: AI_MODEL,
      // undici puts the underlying socket problem here (ECONNREFUSED,
      // UND_ERR_CONNECT_TIMEOUT, ...) when fetch itself rejects.
      networkCause: error instanceof Error && error.cause
        ? String((error.cause as { code?: string })?.code ?? error.cause)
        : undefined,
      ...failureDiagnostics(error),
      ...context,
    },
    message,
  );
}

/**
 * Best-effort recovery of the JSON object from a model response.
 *
 * Strips markdown fences, then falls back to the outermost {...} span so a model
 * that ignores a "raw JSON only" instruction and opens with a sentence ("Here's a
 * table of the reservation...") still parses. A response truncated by max_tokens
 * has no closing brace and deliberately still fails — that is a real error the
 * caller reports as stage "json_parse" with finishReason "length", not something
 * to paper over.
 */
export function cleanAiJson(raw: string): string {
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  return start !== -1 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

/**
 * Strips the input excerpt V8 embeds in JSON.parse errors.
 *
 * `JSON.parse("Here's a table for Ahmet...")` throws
 * `Unexpected token 'H', "Here's a t"... is not valid JSON` — that quoted run is
 * model output and must not reach the logs. The leading token stays: one
 * character cannot identify anyone and it is what distinguishes prose ('H') from
 * a stray code fence ('`'). Truncation errors ("Unterminated string in JSON at
 * position 56") carry no content and pass through unchanged.
 */
function sanitizeParseMessage(message: string): string {
  return message.replace(/"[^"]*"/g, '"…"').slice(0, 120);
}

/** Parses model output as JSON, reporting the stage instead of a bare SyntaxError. */
export function parseAiJson(content: string, finishReason?: string): unknown {
  try {
    return JSON.parse(cleanAiJson(content));
  } catch (parseError) {
    // The model's own output is deliberately not logged: it carries extracted
    // customer fields. stage + finishReason + the sanitized parser message are
    // enough to tell a truncated response from prose or a fenced payload.
    throw new AiExtractionError("Model did not return parseable JSON", {
      stage: "json_parse",
      finishReason,
      parseMessage: sanitizeParseMessage(
        parseError instanceof Error ? parseError.message : String(parseError),
      ),
    });
  }
}

/**
 * Builds the error for a schema mismatch. Only paths/codes/messages are kept —
 * zod issue messages do not echo the offending values.
 */
export function aiSchemaError(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; code: string; message: string }>,
  finishReason?: string,
): AiExtractionError {
  return new AiExtractionError("Model JSON did not match the expected schema", {
    stage: "schema",
    finishReason,
    schemaIssues: issues.slice(0, 5).map(issue => ({
      path: issue.path.map(String).join("."),
      code: issue.code,
      message: issue.message,
    })),
  });
}

export interface OpenRouterResponse {
  content: string;
  finishReason?: string;
  /**
   * The model that actually answered. With a fallback chain this is not
   * necessarily AI_MODELS[0], and diagnosing a bad extraction starts here.
   */
  model: string;
}

export interface OpenRouterRequestOptions {
  /** Chat messages, caller-shaped — vision calls pass a content array. */
  messages: unknown[];
  maxTokens: number;
  temperature?: number;
  /** One model, or an ordered fallback chain. Defaults to AI_MODELS. */
  model?: string | string[];
  /**
   * Adds `response_format: { type: "json_object" }`. OpenRouter drops parameters
   * a model does not list in `supported_parameters`, so this is inert on models
   * without JSON mode and enforced on the ones that have it.
   */
  jsonMode?: boolean;
  /** Per-attempt timeout — each model in the chain gets its own. */
  timeoutMs?: number;
  /** Ceiling for the whole chain, defaults to AI_TOTAL_TIMEOUT_MS. */
  totalTimeoutMs?: number;
  /** When set (and more than one model is configured), one line per failed attempt. */
  logger?: AiFailureLogger;
  logContext?: { eventType: string } & Record<string, unknown>;
}

/** One model's failure, as recorded in the combined error's diagnostics. */
export interface AiAttemptFailure extends Record<string, unknown> {
  model: string;
}

/**
 * Decides whether the next model is worth trying.
 *
 * Retried: timeouts, socket failures, 5xx/429 (provider-side), 401/402/403/404
 * (the key may be entitled to one model and not another), and answers that were
 * unusable — an error payload behind HTTP 200, empty content, unparseable JSON
 * or a schema mismatch. All of those are properties of one model's capacity or
 * output, so another model can plausibly succeed.
 *
 * Not retried: a missing API key (identical for every model) and OpenRouter's
 * own 400, which means the request we built is malformed — retrying it against
 * two more models just burns the remaining budget on the same rejection.
 *
 * Note this covers only OpenRouter failures. The route-level 400s (
 * approval_required and friends) return before any AI call is made and never
 * reach this function.
 */
function isRetryableFailure(error: unknown): boolean {
  if (error instanceof AiExtractionError) {
    const { stage, httpStatus } = error.diagnostics;
    if (stage === "not_configured") return false;
    if (stage === "http_status" && httpStatus === 400) return false;
    return true;
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  // undici surfaces socket-level problems as `TypeError: fetch failed` with the
  // real reason in `cause`. An Error without a cause is our own bug (a throwing
  // validate callback, say) and must not be replayed against every model.
  return error instanceof Error && error.cause !== undefined;
}

/** Combined failure after every model in the chain was tried or skipped. */
function allModelsFailedError(attempts: AiAttemptFailure[]): AiExtractionError {
  // Kept short on purpose: the route stores this message in processingError,
  // which is truncated to 250 characters. The full per-attempt detail lives in
  // `attempts` for the log.
  const summary = attempts
    .map(attempt => `${attempt.model} (${attempt.stage}${attempt.httpStatus ? ` ${attempt.httpStatus}` : ""})`)
    .join(", ");
  return new AiExtractionError(`All ${attempts.length} AI models failed: ${summary}`, {
    stage: "all_models_failed",
    attempts,
  });
}

/** Single OpenRouter call against one model. */
async function requestOneModel(
  model: string,
  options: OpenRouterRequestOptions,
  timeoutMs: number,
): Promise<OpenRouterResponse> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new AiExtractionError("OPENROUTER_API_KEY is not configured", { stage: "not_configured" });
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://tourpilot.com.tr",
      "X-Title": "TourPilot",
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  // Non-2xx: the status and the provider's own error payload are the whole answer
  // to "why did this fail" (401 bad key, 402 no credit, 404 unknown model, 429
  // rate limit), so read them before throwing.
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new AiExtractionError(`OpenRouter ${response.status} ${response.statusText}`, {
      stage: "http_status",
      httpStatus: response.status,
      ...summarizeOpenRouterError(body),
    });
  }

  const payload = await response.json() as {
    error?: unknown;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  // OpenRouter can answer 200 with an error object and no choices.
  if (payload.error) {
    throw new AiExtractionError("OpenRouter returned an error payload with HTTP 200", {
      stage: "error_payload",
      ...summarizeOpenRouterError(JSON.stringify({ error: payload.error })),
    });
  }

  const finishReason = payload.choices?.[0]?.finish_reason;
  const content = payload.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) {
    throw new AiExtractionError("Model returned empty content", { stage: "empty_content", finishReason });
  }
  return { content, finishReason, model };
}

/**
 * Runs the configured models in order and returns the first usable answer.
 *
 * `validate` (optional) runs inside the attempt, so a caller that parses and
 * schema-checks the response there gets the next model tried when the output is
 * unusable — the previous arrangement validated after the call returned, which
 * made a schema mismatch unrecoverable. Callers without `validate` keep exactly
 * their old behaviour, plus transport-level fallback.
 *
 * With a single configured model the original error is rethrown untouched, so
 * nothing about the one-model setup changes.
 */
export function requestOpenRouterContent(
  options: OpenRouterRequestOptions & { validate?: undefined },
): Promise<OpenRouterResponse>;
export function requestOpenRouterContent<T>(
  options: OpenRouterRequestOptions & { validate: (response: OpenRouterResponse) => T },
): Promise<OpenRouterResponse & { data: T }>;
export async function requestOpenRouterContent(
  options: OpenRouterRequestOptions & { validate?: (response: OpenRouterResponse) => unknown },
): Promise<OpenRouterResponse & { data?: unknown }> {
  const requested = typeof options.model === "string" ? [options.model] : options.model ?? [];
  const models = requested.length > 0 ? requested : AI_MODELS;
  const perAttemptMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? AI_TOTAL_TIMEOUT_MS;
  const deadline = Date.now() + totalTimeoutMs;
  const attempts: AiAttemptFailure[] = [];

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const remaining = deadline - Date.now();
    if (index > 0 && remaining < MIN_ATTEMPT_BUDGET_MS) {
      // Report every model that never got a turn, so the log shows the chain was
      // cut by the budget rather than by the models themselves.
      for (const skipped of models.slice(index)) {
        attempts.push({ model: skipped, stage: "skipped_total_timeout", totalTimeoutMs });
      }
      break;
    }
    // The first attempt always gets the full per-attempt timeout; only the
    // later ones are clamped to what is left of the overall budget.
    const timeoutMs = index === 0 ? perAttemptMs : Math.min(perAttemptMs, remaining);

    try {
      const response = await requestOneModel(model, options, timeoutMs);
      const data = options.validate?.(response);
      return options.validate ? { ...response, data } : response;
    } catch (error) {
      if (!isRetryableFailure(error) || models.length === 1) throw error;
      if (options.logger) {
        logAiFailure(
          options.logger,
          error,
          {
            eventType: "ai_model_attempt_failed",
            ...options.logContext,
            model,
            attempt: index + 1,
            attemptCount: models.length,
          },
          "AI model attempt failed, trying the next model",
        );
      }
      attempts.push({ model, ...failureDiagnostics(error, timeoutMs) });
    }
  }

  throw allModelsFailedError(attempts);
}

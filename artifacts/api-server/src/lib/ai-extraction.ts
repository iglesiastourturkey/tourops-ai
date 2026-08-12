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
export const AI_MODEL = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;

// undici applies no overall request deadline, so without this an unresponsive
// OpenRouter would keep a handler open indefinitely.
export const OPENROUTER_TIMEOUT_MS = 30_000;

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
export function failureDiagnostics(error: unknown): Record<string, unknown> {
  if (error instanceof AiExtractionError) return error.diagnostics;
  if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "TimeoutError") {
    return { stage: "timeout", timeoutMs: OPENROUTER_TIMEOUT_MS };
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
 * a non-default model (accounting) can override the reported `model`.
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

export interface OpenRouterRequestOptions {
  /** Chat messages, caller-shaped — vision calls pass a content array. */
  messages: unknown[];
  maxTokens: number;
  temperature?: number;
  /** Defaults to AI_MODEL. */
  model?: string;
  /**
   * Adds `response_format: { type: "json_object" }`. OpenRouter drops parameters
   * a model does not list in `supported_parameters`, so this is inert on models
   * without JSON mode and enforced on the ones that have it.
   */
  jsonMode?: boolean;
  timeoutMs?: number;
}

/**
 * Performs the OpenRouter call and returns the assistant message, throwing an
 * AiExtractionError with a `stage` for every distinguishable failure.
 */
export async function requestOpenRouterContent(
  options: OpenRouterRequestOptions,
): Promise<{ content: string; finishReason?: string }> {
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
      model: options.model ?? AI_MODEL,
      messages: options.messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? OPENROUTER_TIMEOUT_MS),
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
  return { content, finishReason };
}

import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../lib/auth";
import { getHistoricalRemediationDetail, listHistoricalRemediation } from "../lib/historical-remediation-read";
import { HistoricalRemediationError, remediateHistoricalImport } from "../lib/historical-remediation-mutation";
import { approveHistoricalImport } from "../lib/historical-migration-approval";
import { REMEDIATION_FIELDS } from "../lib/historical-remediation-mutation-validation";

const router = Router();

const querySchema = z.object({
  missingField: z.string().trim().max(80).optional(),
  workbook: z.string().trim().max(300).optional(),
  month: z.string().regex(/^2026-(?:0[1-9]|1[0-2])$/).optional(),
  warningProfile: z.string().trim().max(500).optional(),
  sourceKind: z.enum(["gemi", "sejour"]).optional(),
  externalSource: z.string().trim().max(100).optional(),
  externalOperator: z.string().trim().max(100).optional(),
  derivedState: z.enum(["UNRESOLVED", "READY_FOR_REVIEW"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

router.get("/", requireAuth, requirePermission("historical_migration", "review"), async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid remediation filters", details: parsed.error.flatten() });
    return;
  }
  try {
    res.json(await listHistoricalRemediation(parsed.data));
  } catch {
    res.status(500).json({ error: "Historical remediation queue could not be loaded" });
  }
});

router.get("/:id", requireAuth, requirePermission("historical_migration", "review"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid historical remediation id" });
    return;
  }
  try {
    const detail = await getHistoricalRemediationDetail(id);
    if (!detail) {
      res.status(404).json({ error: "Pending historical remediation record not found" });
      return;
    }
    res.json(detail);
  } catch {
    res.status(500).json({ error: "Historical remediation detail could not be loaded" });
  }
});

export const remediationBodySchema = z.object({
  field: z.enum(REMEDIATION_FIELDS),
  value: z.unknown().refine((val) => val !== undefined, {
    message: "Required",
  }),
  expectedVersion: z.number().int().positive(),
  expectedPayloadHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

router.post("/:sourceKey/remediate", requireAuth, requirePermission("historical_migration", "remediate"), async (req, res) => {
  const parsed = remediationBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid historical remediation request", details: parsed.error.flatten() });
    return;
  }
  try {
    const sourceKey = Array.isArray(req.params.sourceKey) ? req.params.sourceKey[0] : req.params.sourceKey;
    res.json(await remediateHistoricalImport({
      sourceKey,
      field: parsed.data.field,
      value: parsed.data.value,
      expectedVersion: parsed.data.expectedVersion,
      expectedPayloadHash: parsed.data.expectedPayloadHash,
      actorProfileId: res.locals.profile.id,
    }));
  } catch (error) {
    if (error instanceof HistoricalRemediationError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: "Historical remediation failed" });
  }
});

// Phase 3E.4B: one-record approval handoff. Body carries ONLY the
// optimistic-concurrency expectations — no correction field/value is accepted
// here. This endpoint approves a single ready record only and exposes no
// other state transitions, single-record only.
export const approvalBodySchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedPayloadHash: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

router.post("/:sourceKey/approve", requireAuth, requirePermission("historical_migration", "approve"), async (req, res) => {
  const parsed = approvalBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid historical approval request", details: parsed.error.flatten() });
    return;
  }
  try {
    const sourceKey = Array.isArray(req.params.sourceKey) ? req.params.sourceKey[0] : req.params.sourceKey;
    const result = await approveHistoricalImport({
      sourceKey,
      actorProfileId: res.locals.profile.id,
      expectedVersion: parsed.data.expectedVersion,
      expectedPayloadHash: parsed.data.expectedPayloadHash,
      requireReadyForReview: true,
    });
    if (!result.ok) {
      if (result.code === "not_found") {
        res.status(404).json({ error: result.message, code: result.code });
        return;
      }
      if (result.code === "forbidden" || result.code === "operator_not_found" || result.code === "operator_inactive") {
        res.status(403).json({ error: result.message, code: result.code });
        return;
      }
      res.status(409).json({ error: result.message, code: result.code });
      return;
    }
    res.json({
      id: result.id,
      sourceKey: result.sourceKey,
      status: result.status,
      approvalVersion: result.approvalVersion,
      payloadSha256: result.payloadSha256,
    });
  } catch {
    res.status(500).json({ error: "Historical approval failed" });
  }
});

export default router;

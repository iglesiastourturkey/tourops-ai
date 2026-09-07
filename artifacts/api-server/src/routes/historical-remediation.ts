import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission } from "../lib/auth";
import { getHistoricalRemediationDetail, listHistoricalRemediation } from "../lib/historical-remediation-read";

const router = Router();
router.use(requireAuth, requirePermission("historical_migration", "review"));

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

router.get("/", async (req, res) => {
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

router.get("/:id", async (req, res) => {
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

export default router;

import { createHmac, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  COMMUNICATION_EVENT_TYPES,
  COMMUNICATION_STATUSES,
  COMMUNICATION_WORKFLOW_KEYS,
  communicationIntegrationEventsTable,
} from "@workspace/db/schema";
import { requireAuth, requireRole } from "../lib/auth";

const router = Router();
const MAX_SIGNATURE_AGE_SECONDS = 300;

const statusEventSchema = z.object({
  tenantId: z.string().trim().min(1).max(80),
  eventId: z.string().trim().min(1).max(160),
  workflowKey: z.enum(COMMUNICATION_WORKFLOW_KEYS),
  eventType: z.enum(COMMUNICATION_EVENT_TYPES),
  status: z.enum(COMMUNICATION_STATUSES),
  channel: z.enum(["whatsapp", "email", "system"]).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().trim().min(1).max(160).nullable().optional(),
  providerEventId: z.string().trim().min(1).max(160).nullable().optional(),
  summary: z.string().trim().max(500).nullable().optional(),
  processedCount: z.number().int().min(0).max(1_000_000).optional().default(0),
  pendingApprovalCount: z.number().int().min(0).max(1_000_000).optional().default(0),
  errorCount: z.number().int().min(0).max(1_000_000).optional().default(0),
}).strict();

type StatusEvent = z.infer<typeof statusEventSchema>;

function integrationEnabled() {
  return process.env.COMMUNICATIONS_INTEGRATION_ENABLED === "true";
}

function configuredTenant() {
  return process.env.COMMUNICATIONS_TENANT_ID?.trim() ?? "";
}

function canonicalStatusEvent(timestamp: string, event: StatusEvent) {
  return [
    timestamp,
    event.tenantId,
    event.eventId,
    event.workflowKey,
    event.eventType,
    event.status,
    event.channel ?? "",
    event.occurredAt,
    event.correlationId ?? "",
    event.providerEventId ?? "",
    event.summary ?? "",
    String(event.processedCount),
    String(event.pendingApprovalCount),
    String(event.errorCount),
  ].join("\n");
}

function validSignature(signature: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const providedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

// POST /api/communications/webhooks/n8n/status
// Status-only machine endpoint. It grants no outbound or workflow-control capability.
router.post("/webhooks/n8n/status", async (req, res) => {
  if (!integrationEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const secret = process.env.COMMUNICATIONS_WEBHOOK_SECRET?.trim() ?? "";
  const tenantId = configuredTenant();
  if (!secret || secret.length < 32 || !tenantId) {
    req.log.error(
      { eventType: "communications_webhook_misconfigured" },
      "Communications webhook is enabled without complete server configuration",
    );
    res.status(503).json({ error: "Integration unavailable" });
    return;
  }

  const timestamp = req.get("x-tourpilot-timestamp")?.trim() ?? "";
  const signature = req.get("x-tourpilot-signature")?.trim() ?? "";
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (
    !Number.isInteger(timestampSeconds)
    || Math.abs(nowSeconds - timestampSeconds) > MAX_SIGNATURE_AGE_SECONDS
  ) {
    res.status(401).json({ error: "Invalid signature timestamp" });
    return;
  }

  const parsed = statusEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status event" });
    return;
  }
  const event = parsed.data;

  if (event.tenantId !== tenantId) {
    res.status(403).json({ error: "Tenant mismatch" });
    return;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(canonicalStatusEvent(timestamp, event), "utf8")
    .digest("hex");

  if (!validSignature(signature, expectedSignature)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    const inserted = await db
      .insert(communicationIntegrationEventsTable)
      .values({
        tenantId: event.tenantId,
        eventId: event.eventId,
        workflowKey: event.workflowKey,
        eventType: event.eventType,
        status: event.status,
        channel: event.channel ?? null,
        correlationId: event.correlationId ?? null,
        providerEventId: event.providerEventId ?? null,
        summary: event.summary ?? null,
        processedCount: event.processedCount,
        pendingApprovalCount: event.pendingApprovalCount,
        errorCount: event.errorCount,
        occurredAt: new Date(event.occurredAt),
      })
      .onConflictDoNothing({
        target: [
          communicationIntegrationEventsTable.tenantId,
          communicationIntegrationEventsTable.eventId,
        ],
      })
      .returning({ id: communicationIntegrationEventsTable.id });

    res.status(inserted.length > 0 ? 202 : 200).json({
      accepted: true,
      duplicate: inserted.length === 0,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      req.log.error(
        { eventType: "communications_event_table_missing" },
        "Communication integration migration has not been applied",
      );
      res.status(503).json({ error: "Integration storage unavailable" });
      return;
    }
    req.log.error(
      { err: error, eventType: "communications_event_store_failed" },
      "Could not store redacted n8n status event",
    );
    res.status(500).json({ error: "Could not store status event" });
  }
});

// Everything below is a signed-in, read-only TourPilot UI surface.
router.use(requireAuth, requireRole("admin", "operations"));

router.get("/status", async (req, res) => {
  const tenantId = configuredTenant();
  const enabled = integrationEnabled();

  if (!enabled) {
    res.json({
      configured: false,
      mode: "disabled",
      message: "n8n durum entegrasyonu güvenlik nedeniyle kapalı.",
      totals: { pendingApprovals: 0, openErrors: 0, processed: 0 },
      workflows: [],
    });
    return;
  }

  if (!tenantId || !(process.env.COMMUNICATIONS_WEBHOOK_SECRET?.trim())) {
    res.json({
      configured: false,
      mode: "misconfigured",
      message: "Entegrasyon sunucu yapılandırması tamamlanmamış.",
      totals: { pendingApprovals: 0, openErrors: 0, processed: 0 },
      workflows: [],
    });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(communicationIntegrationEventsTable)
      .where(eq(communicationIntegrationEventsTable.tenantId, tenantId))
      .orderBy(desc(communicationIntegrationEventsTable.occurredAt))
      .limit(100);

    const workflowDefinitions = [
      { key: "whatsapp-tour-sales", name: "WhatsApp Tour Sales Assistant" },
      { key: "ai-remarketing", name: "AI Remarketing & Customer Reactivation" },
    ] as const;

    const workflows = workflowDefinitions.map((definition) => {
      const workflowEvents = rows.filter(row => row.workflowKey === definition.key);
      const latest = workflowEvents[0];
      const lastSuccess = workflowEvents.find(row => row.status === "succeeded");
      const lastError = workflowEvents.find(row => row.status === "failed");

      return {
        key: definition.key,
        name: definition.name,
        status: latest?.status ?? "not_connected",
        lastEventAt: latest?.occurredAt?.toISOString() ?? null,
        lastSuccessAt: lastSuccess?.occurredAt?.toISOString() ?? null,
        lastErrorAt: lastError?.occurredAt?.toISOString() ?? null,
        summary: latest?.summary ?? null,
        processedCount: latest?.processedCount ?? 0,
        pendingApprovalCount: latest?.pendingApprovalCount ?? 0,
        errorCount: latest?.errorCount ?? 0,
      };
    });

    res.json({
      configured: true,
      mode: "readonly",
      message: "Salt-okunur n8n durum entegrasyonu etkin.",
      totals: {
        pendingApprovals: workflows.reduce((sum, item) => sum + item.pendingApprovalCount, 0),
        openErrors: workflows.reduce((sum, item) => sum + item.errorCount, 0),
        processed: workflows.reduce((sum, item) => sum + item.processedCount, 0),
      },
      workflows,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      res.json({
        configured: false,
        mode: "migration_required",
        message: "Entegrasyon veritabanı hazırlığı bekleniyor.",
        totals: { pendingApprovals: 0, openErrors: 0, processed: 0 },
        workflows: [],
      });
      return;
    }
    req.log.error(
      { err: error, eventType: "communications_status_list_failed" },
      "Could not list communication integration status",
    );
    res.status(500).json({ error: "İletişim durumu alınamadı" });
  }
});

export default router;

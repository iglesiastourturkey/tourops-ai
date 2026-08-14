import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const COMMUNICATION_WORKFLOW_KEYS = [
  "whatsapp-tour-sales",
  "ai-remarketing",
] as const;

export const COMMUNICATION_EVENT_TYPES = [
  "workflow.started",
  "workflow.completed",
  "workflow.failed",
  "approval.pending",
] as const;

export const COMMUNICATION_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "pending_approval",
] as const;

/**
 * Redacted, status-only events received from allowlisted n8n workflows.
 * No customer message, phone, email, campaign content, or arbitrary payload is stored.
 */
export const communicationIntegrationEventsTable = pgTable(
  "communication_integration_events",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    eventId: text("event_id").notNull(),
    workflowKey: text("workflow_key").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull(),
    channel: text("channel"),
    correlationId: text("correlation_id"),
    providerEventId: text("provider_event_id"),
    summary: text("summary"),
    processedCount: integer("processed_count").notNull().default(0),
    pendingApprovalCount: integer("pending_approval_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("communication_events_tenant_event_uidx").on(table.tenantId, table.eventId),
    check("communication_events_workflow_key_check", sql`${table.workflowKey} IN ('whatsapp-tour-sales', 'ai-remarketing')`),
    check("communication_events_event_type_check", sql`${table.eventType} IN ('workflow.started', 'workflow.completed', 'workflow.failed', 'approval.pending')`),
    check("communication_events_status_check", sql`${table.status} IN ('running', 'succeeded', 'failed', 'pending_approval')`),
    check("communication_events_channel_check", sql`${table.channel} IS NULL OR ${table.channel} IN ('whatsapp', 'email', 'system')`),
    check("communication_events_processed_count_check", sql`${table.processedCount} >= 0`),
    check("communication_events_pending_count_check", sql`${table.pendingApprovalCount} >= 0`),
    check("communication_events_error_count_check", sql`${table.errorCount} >= 0`),
    index("communication_events_tenant_received_idx").on(table.tenantId, table.receivedAt),
    index("communication_events_tenant_workflow_idx").on(table.tenantId, table.workflowKey),
  ],
);

export type CommunicationIntegrationEvent =
  typeof communicationIntegrationEventsTable.$inferSelect;

-- ADDITIVE MIGRATION — NOT APPLIED BY THIS COMMIT.
--
-- Apply to the Neon staging branch first. Keep
-- COMMUNICATIONS_INTEGRATION_ENABLED=false until the migration, HMAC secret,
-- tenant configuration, and signed smoke test have all been verified.
--
-- This table deliberately stores status-only, redacted events. Customer
-- messages, phone numbers, email addresses, campaign content, credentials,
-- and arbitrary provider payloads are outside the contract.

CREATE TABLE IF NOT EXISTS communication_integration_events (
  id serial PRIMARY KEY,
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  workflow_key text NOT NULL
    CHECK (workflow_key IN ('whatsapp-tour-sales', 'ai-remarketing')),
  event_type text NOT NULL
    CHECK (event_type IN ('workflow.started', 'workflow.completed', 'workflow.failed', 'approval.pending')),
  status text NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed', 'pending_approval')),
  channel text
    CHECK (channel IS NULL OR channel IN ('whatsapp', 'email', 'system')),
  correlation_id text,
  provider_event_id text,
  summary text,
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  pending_approval_count integer NOT NULL DEFAULT 0 CHECK (pending_approval_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_events_tenant_event_unique UNIQUE (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS communication_events_tenant_received_idx
  ON communication_integration_events (tenant_id, received_at);

CREATE INDEX IF NOT EXISTS communication_events_tenant_workflow_idx
  ON communication_integration_events (tenant_id, workflow_key);

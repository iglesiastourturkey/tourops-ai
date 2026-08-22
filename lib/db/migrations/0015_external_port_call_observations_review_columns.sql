-- Phase 2 (additive only): review-outcome tracking for
-- external_port_call_observations (created in 0014, still unused by any
-- application code until this migration's companion route ships).
-- 0014 already added approved_at/approved_by for the approve path; this
-- adds the reject path's mirror columns. This is an ALTER on a table this
-- session created and that no code reads yet, so it is safe - no other
-- existing table is touched, and no data in this table is modified.

ALTER TABLE external_port_call_observations
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by integer REFERENCES profiles(id) ON DELETE SET NULL;

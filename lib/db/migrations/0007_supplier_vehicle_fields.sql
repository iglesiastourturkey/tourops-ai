-- Migration: vehicle fields on suppliers (driver management)
--
-- Drivers have no dedicated entity in TourPilot — they are suppliers tagged
-- category='driver', the same way freelance guides are modeled. The Şoförler
-- tab on the Tedarikçiler page captures a plate and vehicle description, and
-- the operation "Rehber & Şoför" dialog auto-fills the plate from the selected
-- driver, so both need real columns rather than free text inside notes.
--
-- Both are nullable and only meaningful for category='driver' rows; every other
-- supplier category simply leaves them NULL.
--
-- Additive and idempotent — no table rewrite, no existing column touched.
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS vehicle_info  text;

import { Router } from "express";
import { db } from "@workspace/db";
import { reservationsTable, bookingPartiesTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { reservationRecordListRead, reservationRecordDetailRead } from "../lib/reservation-record-read";
import {
  reservationRecordEditSchema, canTransitionReservationStatus, diffChangedFields,
} from "../lib/reservation-record-write";

/**
 * Reservation Management Workspace (Phase 2A) — the persisted
 * Reservation/BookingParty domain records ("Rezervasyonlar"). Deliberately
 * NOT mounted at /reservations: that path is already fully claimed by
 * routes/reservations.ts (the Gmail/Outlook/manual "Gelen Rezervasyonlar"
 * import-review queue, backed by reservationEmailImportsTable) and
 * routes/outlook.ts. Reusing /reservations here would either collide with
 * or silently shadow those routes. Mounted at /reservation-records instead
 * — see routes/index.ts.
 *
 * Reuses the existing "reservations" permission resource (view/create/
 * update/delete, seeded in lib/seed-permissions.ts for admin/operations,
 * delete admin-only) rather than inventing a new one: it already names
 * exactly the right roles for this data, and access is enforced per-route
 * regardless of which router a path lives under.
 */
const router = Router();
router.use(requireAuth);

router.get("/", requirePermission("reservations", "view"), reservationRecordListRead);
router.get("/:id", requirePermission("reservations", "view"), reservationRecordDetailRead);

// PATCH /api/reservation-records/:id — the only mutation this phase adds.
// Reservation and BookingParty are updated atomically in one transaction
// (they are a strict 1:1 pair); a status change is validated against the
// explicit transition graph before anything is written. Operation status is
// never read or touched here — reservation and operation status stay
// independent by construction, not by convention.
router.patch("/:id", requirePermission("reservations", "update"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "Geçersiz ID" }); return; }

    const parsed = reservationRecordEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Geçersiz alanlar", issues: parsed.error.issues });
      return;
    }
    const { reservation: reservationEdit, bookingParty: bookingPartyEdit } = parsed.data;
    if (!reservationEdit && !bookingPartyEdit) {
      res.status(400).json({ error: "Güncellenecek bir alan belirtilmedi" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(reservationsTable)
        .where(eq(reservationsTable.id, id)).for("update");
      if (!current) return { notFound: true as const };

      if (reservationEdit?.status && !canTransitionReservationStatus(current.status, reservationEdit.status)) {
        return { invalidTransition: { from: current.status, to: reservationEdit.status } };
      }

      let updatedReservation = current;
      const reservationChanges = reservationEdit ? diffChangedFields(current, reservationEdit) : [];
      if (reservationEdit && reservationChanges.length) {
        [updatedReservation] = await tx.update(reservationsTable)
          .set(reservationEdit).where(eq(reservationsTable.id, id)).returning();
      }

      const [currentParty] = await tx.select().from(bookingPartiesTable)
        .where(eq(bookingPartiesTable.reservationId, id)).for("update");
      let updatedParty = currentParty ?? null;
      let partyChanges: string[] = [];
      if (bookingPartyEdit) {
        if (!currentParty) return { missingBookingParty: true as const };
        partyChanges = diffChangedFields(currentParty, bookingPartyEdit);
        if (partyChanges.length) {
          [updatedParty] = await tx.update(bookingPartiesTable)
            .set(bookingPartyEdit).where(eq(bookingPartiesTable.id, currentParty.id)).returning();
        }
      }

      const changedFields = [...reservationChanges, ...partyChanges.map(f => `bookingParty.${f}`)];
      if (changedFields.length) {
        await createAuditLog({
          eventType: "reservation_record_updated",
          actorProfileId: res.locals.profile.id,
          module: "reservations",
          entityType: "reservation",
          entityId: id,
          metadata: {
            reservationId: id, changedFields,
            previousStatus: current.status, newStatus: updatedReservation.status,
          },
          description: "Rezervasyon kaydı güncellendi",
        }, tx);
      }

      return { reservation: updatedReservation, bookingParty: updatedParty, changedFields };
    });

    if ("notFound" in result) { res.status(404).json({ error: "Rezervasyon bulunamadı" }); return; }
    if ("missingBookingParty" in result) { res.status(409).json({ error: "Bu rezervasyonun booking party kaydı yok" }); return; }
    if ("invalidTransition" in result && result.invalidTransition) {
      const { from, to } = result.invalidTransition;
      res.status(409).json({
        error: `Durum geçişi geçersiz: ${from} → ${to}`,
        code: "invalid_status_transition",
      });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log?.error({ err }, "reservation-record update failed");
    res.status(500).json({ error: "Rezervasyon güncellenemedi" });
  }
});

export default router;

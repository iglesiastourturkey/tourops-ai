/**
 * TourPilot — Demo Seed Reset Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Removes ALL records created by seed-demo.ts.
 * Identifies demo records by the  [DEMO]  marker stored in notes/description
 * fields, and the  demo_  prefix on the seed profile's clerkUserId.
 *
 * ⚠️  This script NEVER deletes records that do not carry the demo marker.
 *     Real production data is safe.
 *
 * Usage:  pnpm seed:demo:reset
 */

import { db } from "@workspace/db";
import {
  profilesTable,
  customersTable,
  suppliersTable,
  toursTable,
  quotationsTable,
  operationsTable,
  operationTasksTable,
  operationReceiptsTable,
  accountingTransactionsTable,
  accountingDocumentsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { like, eq, inArray } from "drizzle-orm";

const DEMO = "[DEMO]";

async function main() {
  const start = Date.now();
  console.log("🗑️  TourPilot demo seed reset starting…\n");
  console.log("   Identifying demo records by the [DEMO] marker.\n");

  // ── 1. Notifications ──────────────────────────────────────────────────────
  const { rowCount: notifCount } = await db
    .delete(notificationsTable)
    .where(like(notificationsTable.message, `%${DEMO}%`));
  console.log(`✓ notifications deleted: ${notifCount ?? 0}`);

  // ── 2. Accounting documents ───────────────────────────────────────────────
  const { rowCount: docCount } = await db
    .delete(accountingDocumentsTable)
    .where(like(accountingDocumentsTable.notes, `%${DEMO}%`));
  console.log(`✓ accounting_documents deleted: ${docCount ?? 0}`);

  // ── 3. Accounting transactions ────────────────────────────────────────────
  const { rowCount: txCount } = await db
    .delete(accountingTransactionsTable)
    .where(like(accountingTransactionsTable.description, `%${DEMO}%`));
  console.log(`✓ accounting_transactions deleted: ${txCount ?? 0}`);

  // ── 4. Operation receipts ─────────────────────────────────────────────────
  const { rowCount: receiptCount } = await db
    .delete(operationReceiptsTable)
    .where(like(operationReceiptsTable.guideNote, `%${DEMO}%`));
  console.log(`✓ operation_receipts deleted: ${receiptCount ?? 0}`);

  // ── 5. Operation tasks ────────────────────────────────────────────────────
  const { rowCount: taskCount } = await db
    .delete(operationTasksTable)
    .where(like(operationTasksTable.description, `%${DEMO}%`));
  console.log(`✓ operation_tasks deleted: ${taskCount ?? 0}`);

  // ── 6. Operations (notes contains [DEMO]) ─────────────────────────────────
  const { rowCount: opCount } = await db
    .delete(operationsTable)
    .where(like(operationsTable.notes, `%${DEMO}%`));
  console.log(`✓ operations deleted: ${opCount ?? 0}`);

  // ── 7. Quotations ─────────────────────────────────────────────────────────
  const { rowCount: quotCount } = await db
    .delete(quotationsTable)
    .where(like(quotationsTable.notes, `%${DEMO}%`));
  console.log(`✓ quotations deleted: ${quotCount ?? 0}`);

  // ── 8. Tours ──────────────────────────────────────────────────────────────
  const { rowCount: tourCount } = await db
    .delete(toursTable)
    .where(like(toursTable.notes, `%${DEMO}%`));
  console.log(`✓ tours deleted: ${tourCount ?? 0}`);

  // ── 9. Suppliers ──────────────────────────────────────────────────────────
  const { rowCount: supplierCount } = await db
    .delete(suppliersTable)
    .where(like(suppliersTable.notes, `%${DEMO}%`));
  console.log(`✓ suppliers deleted: ${supplierCount ?? 0}`);

  // ── 10. Customers ─────────────────────────────────────────────────────────
  const { rowCount: custCount } = await db
    .delete(customersTable)
    .where(like(customersTable.notes, `%${DEMO}%`));
  console.log(`✓ customers deleted: ${custCount ?? 0}`);

  // ── 11. Demo seed profile ─────────────────────────────────────────────────
  // Identified by clerkUserId prefix  demo_  — never touches real user profiles
  const { rowCount: profileCount } = await db
    .delete(profilesTable)
    .where(like(profilesTable.clerkUserId, "demo_%"));
  console.log(`✓ demo profiles deleted: ${profileCount ?? 0}`);

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`
╔══════════════════════════════════════════════════════╗
║      TourPilot Demo Reset — Complete                 ║
╠══════════════════════════════════════════════════════╣
║  All demo records removed. Real data untouched.      ║
║  Elapsed: ${elapsed}s                                ║
╠══════════════════════════════════════════════════════╣
║  Run  pnpm seed:demo  to re-populate demo data.      ║
╚══════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error("❌ Demo reset failed:", err);
  process.exit(1);
});

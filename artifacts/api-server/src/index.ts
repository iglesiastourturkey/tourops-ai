import app from "./app";
import { logger } from "./lib/logger";
import { seedPermissions } from "./lib/seed-permissions";
import { db } from "@workspace/db";
import { profilesTable } from "@workspace/db/schema";
import { eq, and, not, like } from "drizzle-orm";

// PORT is injected by Replit at runtime.
// Outside Replit (local dev, Docker, cloud) fall back to 8080.
const port = Number(process.env["PORT"]) || 8080;

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

// Seed permission defaults after startup (idempotent, non-blocking)
seedPermissions()
  .then(() => logger.info("Permission seed complete"))
  .catch(err => logger.error({ err }, "Permission seed failed (non-fatal)"));

// One-time idempotent correction: ensure the super_admin account keeps its
// intended role even if the auto-provisioning path created it as "guide".
// Safe to run on every startup — no-ops immediately when already correct.
db.update(profilesTable)
  .set({ role: "super_admin" })
  .where(
    and(
      eq(profilesTable.email, "aydin254@gmail.com"),
      eq(profilesTable.role, "guide"),
      not(like(profilesTable.clerkUserId, "pending-%")),
    ),
  )
  .then(result => {
    if (result.rowCount && result.rowCount > 0) {
      logger.info("Corrected aydin254@gmail.com profile role to super_admin");
    }
  })
  .catch(err => logger.error({ err }, "Profile role correction failed (non-fatal)"));

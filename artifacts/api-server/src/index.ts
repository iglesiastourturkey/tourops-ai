import app from "./app";
import { logger } from "./lib/logger";
import { seedPermissions } from "./lib/seed-permissions";

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

import app from "./app";
import { logger } from "./lib/logger";

// PORT is injected by Replit at runtime.
// Outside Replit (local dev, Docker, cloud) fall back to 8080.
const port = Number(process.env["PORT"]) || 8080;

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

import path from "path";
import { existsSync } from "fs";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import { logger } from "./lib/logger";
import { systemModeMiddleware } from "./middlewares/systemMode";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy middleware — must be before body parsers
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Comma-separated list of allowed frontend origins (e.g. the Vercel
// production domain, plus any preview deployments you want to allow).
// When unset — local dev — fall back to reflecting any origin so the
// existing dev flow keeps working without extra setup.
const allowedOrigins = (process.env.FRONTEND_URL ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  logger.warn(
    "FRONTEND_URL not set — CORS is reflecting any origin. Set FRONTEND_URL in production.",
  );
}

app.use(
  cors({
    credentials: true,
    origin:
      allowedOrigins.length > 0
        ? (origin, callback) => {
            // No Origin header: same-origin requests, curl, health checks,
            // server-to-server calls — not subject to CORS, always allow.
            if (!origin || allowedOrigins.includes(origin)) {
              return callback(null, true);
            }
            callback(new Error(`CORS: origin not allowed: ${origin}`));
          }
        : true,
  }),
);
// The public n8n status endpoint accepts a small, strict telemetry contract.
app.use(
  "/api/communications/webhooks/n8n/status",
  express.json({ limit: "32kb" }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Clerk auth middleware. With no argument it reads CLERK_PUBLISHABLE_KEY and
// CLERK_SECRET_KEY from the environment — a single fixed instance.
//
// Deliberately NOT derived per-request from the incoming Host header. A
// publishable key already encodes its Frontend API domain, so recomputing it as
// `clerk.<request host>` produced a key pointing at a Frontend API that does not
// exist (clerk.<render-host>) and that never matches the issuer of the tokens the
// frontend actually sends.
app.use(clerkMiddleware());

// System-mode gate: runs before all API handlers
app.use("/api", systemModeMiddleware);
app.use("/api", router);

// ── Production static file serving ─────────────────────────────────────────
// When the Vite build output exists (i.e. in production, or after a local
// `pnpm build`), Express serves the React SPA directly.  In development the
// Vite dev server handles "/" via Replit's path-based routing, so this block
// is a no-op (the dist directory does not exist during normal `pnpm dev`).
const clientDist = path.resolve(process.cwd(), "artifacts/tourops-ai/dist/public");
if (existsSync(clientDist)) {
  // Serve hashed JS/CSS assets with long-lived cache headers.
  app.use(express.static(clientDist, { maxAge: "1y", immutable: true }));

  // SPA fallback — any GET that did not match /api/* or a static asset
  // returns the React shell so client-side routing can take over.
  // Express 5 (path-to-regexp v8) requires a named wildcard parameter.
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

export default app;

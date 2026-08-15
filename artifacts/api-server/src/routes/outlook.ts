import { Router } from "express";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { outlookConnectionsTable } from "@workspace/db/schema";
import { requireAuth, requireActive, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { encryptCredential } from "../lib/credential-encryption";
import {
  createAuthorizationUrl, exchangeAuthorizationCode, isOutlookOAuthConfigured,
  revokeOutlookCredential, verifyOutlookAccount, MAIL_READ_SCOPE,
} from "../lib/outlook-provider";

// A standalone router — not folded into reservations.ts — so this file's own
// local middleware order (public callback, then requireAuth) is independent of
// reservations.ts's. Mounted at the same "/reservations" prefix in routes/index.ts.
const router = Router();

// Same signed, 10-minute-lived state approach as reservations.ts's Google OAuth
// flow (see .agents/memory/gmail-reservation-intake.md). Kept as its own copy
// rather than importing from reservations.ts: that file's version is specific
// to GoogleIntegration ("gmail" | "drive"), and reaching into another router's
// module to share ~15 lines was judged riskier than the small duplication —
// nothing here touches the tested, live Gmail flow.
function oauthState(profileId: number) {
  const payload = Buffer.from(JSON.stringify({ profileId, issuedAt: Date.now() })).toString("base64url");
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function parseOauthState(state: string) {
  const [payload, signature] = state.split(".");
  const secret = process.env.SESSION_SECRET;
  if (!payload || !signature || !secret) throw new Error("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { profileId: number; issuedAt: number };
  if (!parsed.profileId || Date.now() - parsed.issuedAt > 10 * 60_000) throw new Error("Expired OAuth state");
  return parsed;
}

const connectionScopes = (connection: typeof outlookConnectionsTable.$inferSelect | undefined) => connection?.grantedScopes ?? [];
const connectionSummary = (connection: typeof outlookConnectionsTable.$inferSelect | undefined) => connection ? {
  outlookAccountEmail: connection.outlookAccountEmail,
  status: connection.status,
  lastError: connection.lastError,
  grantedScopes: connectionScopes(connection),
  lastSuccessfulAccessAt: connection.lastSuccessfulAccessAt,
} : null;

// Microsoft redirects outside the authenticated SPA context, so — exactly like
// the Google callback — the signed, short-lived OAuth state above is this
// route's authorization boundary. Must stay declared before router.use(requireAuth, ...)
// below; see .agents/memory/pathless-router-mounts.md for why that ordering matters.
router.get("/outlook-connection/callback", async (req, res) => {
  try {
    const parsedState = parseOauthState(String(req.query.state ?? ""));
    if (typeof req.query.code !== "string") {
      res.status(400).send("Outlook bağlantı isteği geçersiz veya süresi dolmuş."); return;
    }
    const [existing] = await db.select().from(outlookConnectionsTable)
      .where(and(eq(outlookConnectionsTable.profileId, parsedState.profileId), eq(outlookConnectionsTable.provider, "outlook")))
      .limit(1);
    const tokens = await exchangeAuthorizationCode(req.query.code);
    const email = await verifyOutlookAccount(tokens.access_token);
    const grantedScopes = Array.from(new Set([...connectionScopes(existing), MAIL_READ_SCOPE]));
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptCredential(tokens.refresh_token)
      : existing?.refreshTokenEncrypted ?? null;
    if (!refreshTokenEncrypted) throw new Error("Microsoft refresh token is unavailable. Reconnect and approve offline access.");
    const values = {
      profileId: parsedState.profileId, provider: "outlook", outlookAccountEmail: email,
      accessTokenEncrypted: encryptCredential(tokens.access_token), refreshTokenEncrypted,
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      grantedScopes, lastSuccessfulAccessAt: new Date(), status: "connected", lastError: null,
    };
    await db.insert(outlookConnectionsTable).values(values).onConflictDoUpdate({
      target: [outlookConnectionsTable.profileId, outlookConnectionsTable.provider],
      set: values,
    });
    await createAuditLog({ eventType: "outlook_connection_created", actorProfileId: parsedState.profileId, module: "reservations", description: "Outlook bağlantısı oluşturuldu" });
    res.redirect(process.env.MICROSOFT_OAUTH_SUCCESS_URL?.trim() || "/settings?outlook=connected");
  } catch {
    res.status(502).send("Outlook bağlantısı tamamlanamadı. Ayarları kontrol edip tekrar deneyin.");
  }
});

router.use(requireAuth, requireActive());

router.get("/outlook-connection", requirePermission("settings", "manage"), async (_req, res) => {
  const [connection] = await db.select().from(outlookConnectionsTable)
    .where(and(eq(outlookConnectionsTable.profileId, res.locals.profile.id), eq(outlookConnectionsTable.provider, "outlook")))
    .limit(1);
  const configured = isOutlookOAuthConfigured();
  res.json({
    configured,
    missingConfiguration: configured ? [] : ["MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_REDIRECT_URI", "MICROSOFT_OAUTH_TENANT_ID"].filter(key => !process.env[key]?.trim()),
    connection: connectionSummary(connection),
  });
});

router.post("/outlook-connection/authorize", requirePermission("settings", "manage"), async (_req, res) => {
  if (!isOutlookOAuthConfigured()) { res.status(503).json({ error: "Outlook OAuth yapılandırılmamış" }); return; }
  const [connection] = await db.select().from(outlookConnectionsTable)
    .where(and(eq(outlookConnectionsTable.profileId, res.locals.profile.id), eq(outlookConnectionsTable.provider, "outlook")))
    .limit(1);
  res.json({ authorizationUrl: createAuthorizationUrl(oauthState(res.locals.profile.id), connectionScopes(connection)) });
});

router.delete("/outlook-connection", requirePermission("settings", "manage"), async (_req, res) => {
  const [connection] = await db.select().from(outlookConnectionsTable)
    .where(and(eq(outlookConnectionsTable.profileId, res.locals.profile.id), eq(outlookConnectionsTable.provider, "outlook")))
    .limit(1);
  if (!connection) { res.status(204).send(); return; }
  if (connection.refreshTokenEncrypted) {
    try { await revokeOutlookCredential(); } catch { /* disconnect still removes local access */ }
  }
  await db.delete(outlookConnectionsTable).where(eq(outlookConnectionsTable.id, connection.id));
  await createAuditLog({ eventType: "outlook_connection_disconnected", actorProfileId: res.locals.profile.id, module: "reservations", description: "Outlook bağlantısı kaldırıldı" });
  res.status(204).send();
});

export default router;

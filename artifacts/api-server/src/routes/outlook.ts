import { Router } from "express";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import { microsoftConnectionsTable, reservationEmailImportsTable } from "@workspace/db/schema";
import { requireAuth, requireActive, requirePermission } from "../lib/auth";
import { createAuditLog } from "../lib/audit";
import { decryptCredential, encryptCredential } from "../lib/credential-encryption";
import {
  createAuthorizationUrl, exchangeAuthorizationCode, fetchTourPilotMessages,
  isMicrosoftOAuthConfigured, refreshAccessToken, verifyMicrosoftAccount, OUTLOOK_SCOPE,
} from "../lib/outlook-provider";

const router = Router();

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
const connectionScopes = (connection: typeof microsoftConnectionsTable.$inferSelect) => connection.grantedScopes ?? [];
const connectionSummary = (connection: typeof microsoftConnectionsTable.$inferSelect | undefined) => connection ? {
  microsoftAccountEmail: connection.microsoftAccountEmail,
  status: connection.status,
  lastError: connection.lastError,
  grantedScopes: connectionScopes(connection),
  lastSuccessfulAccessAt: connection.lastSuccessfulAccessAt,
} : null;
async function activeAccessToken(connection: typeof microsoftConnectionsTable.$inferSelect) {
  if (!connection.refreshTokenEncrypted) throw new Error("Microsoft connection has no refresh token");
  const refreshToken = decryptCredential(connection.refreshTokenEncrypted);
  return await refreshAccessToken(refreshToken);
}

// Microsoft redirects outside the authenticated SPA context, same as Google's
// callback. The signed, short-lived OAuth state below is the authorization
// boundary for this one route.
router.get("/outlook-connection/callback", async (req, res) => {
  try {
    const parsedState = parseOauthState(String(req.query.state ?? ""));
    if (typeof req.query.code !== "string") {
      res.status(400).send("Microsoft bağlantı isteği geçersiz veya süresi dolmuş."); return;
    }
    const [existing] = await db.select().from(microsoftConnectionsTable)
      .where(and(eq(microsoftConnectionsTable.profileId, parsedState.profileId), eq(microsoftConnectionsTable.provider, "outlook")))
      .limit(1);
    const tokens = await exchangeAuthorizationCode(req.query.code);
    const email = await verifyMicrosoftAccount(tokens.access_token!);
    const grantedScopes = Array.from(new Set([...connectionScopes(existing ?? {} as typeof microsoftConnectionsTable.$inferSelect), OUTLOOK_SCOPE]));
    const refreshTokenEncrypted = tokens.refresh_token
      ? encryptCredential(tokens.refresh_token)
      : existing?.refreshTokenEncrypted ?? null;
    if (!refreshTokenEncrypted) throw new Error("Microsoft refresh token is unavailable. Reconnect and approve offline access.");
    const tokenExpiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
    await db.insert(microsoftConnectionsTable).values({
      profileId: parsedState.profileId, provider: "outlook", microsoftAccountEmail: email,
      accessTokenEncrypted: encryptCredential(tokens.access_token!), refreshTokenEncrypted,
      tokenExpiresAt, grantedScopes, lastSuccessfulAccessAt: new Date(), status: "connected", lastError: null,
    }).onConflictDoUpdate({
      target: [microsoftConnectionsTable.profileId, microsoftConnectionsTable.provider],
      set: {
        microsoftAccountEmail: email, accessTokenEncrypted: encryptCredential(tokens.access_token!), refreshTokenEncrypted,
        tokenExpiresAt, grantedScopes, lastSuccessfulAccessAt: new Date(), status: "connected", lastError: null,
      },
    });
    await createAuditLog({ eventType: "microsoft_connection_created", actorProfileId: parsedState.profileId, module: "reservations", metadata: { integration: "outlook" }, description: "Outlook rezervasyon bağlantısı oluşturuldu" });
    res.redirect(process.env.MICROSOFT_OAUTH_SUCCESS_URL?.trim() || "/settings?outlook=connected");
  } catch (error) {
    req.log.error({ err: error }, "Microsoft OAuth callback failed");
    res.status(502).send("Outlook bağlantısı tamamlanamadı. Ayarları kontrol edip tekrar deneyin.");
  }
});

// Applied per-route below (not via a blanket router.use()) because this
// router is mounted before reservationsRouter at the same "/reservations"
// prefix (see routes/index.ts) so that its literal paths — /outlook-connection,
// /outlook-scan — aren't swallowed by reservations.ts's generic /:id and
// DELETE /:id routes. A blanket router.use(requireAuth, ...) here would run
// for every unmatched request under /reservations/* before it falls through
// to reservationsRouter, which would incorrectly gate reservations.ts's own
// unauthenticated route (GET /google-connection/callback).
router.get("/outlook-connection", requireAuth, requireActive(), requirePermission("settings", "manage"), async (_req, res) => {
  const [connection] = await db.select().from(microsoftConnectionsTable)
    .where(and(eq(microsoftConnectionsTable.profileId, res.locals.profile.id), eq(microsoftConnectionsTable.provider, "outlook")))
    .limit(1);
  const configured = isMicrosoftOAuthConfigured();
  res.json({
    configured,
    missingConfiguration: configured ? [] : [
      "MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_REDIRECT_URI", "MICROSOFT_OAUTH_TENANT_ID",
    ].filter(key => !process.env[key]?.trim()),
    connection: connectionSummary(connection),
  });
});

router.post("/outlook-connection/authorize", requireAuth, requireActive(), requirePermission("settings", "manage"), async (_req, res) => {
  if (!isMicrosoftOAuthConfigured()) { res.status(503).json({ error: "Microsoft OAuth yapılandırılmamış" }); return; }
  res.json({ authorizationUrl: createAuthorizationUrl(oauthState(res.locals.profile.id)) });
});

router.delete("/outlook-connection", requireAuth, requireActive(), requirePermission("settings", "manage"), async (_req, res) => {
  const [connection] = await db.select().from(microsoftConnectionsTable)
    .where(and(eq(microsoftConnectionsTable.profileId, res.locals.profile.id), eq(microsoftConnectionsTable.provider, "outlook")))
    .limit(1);
  if (!connection) { res.status(204).send(); return; }
  // Microsoft has no public single-refresh-token revocation endpoint to call
  // here (unlike Google's /oauth2/revoke) — removing the local row is the
  // full disconnect. Imported reservation records are intentionally kept.
  await db.delete(microsoftConnectionsTable).where(eq(microsoftConnectionsTable.id, connection.id));
  await createAuditLog({ eventType: "microsoft_connection_disconnected", actorProfileId: res.locals.profile.id, module: "reservations", metadata: { integration: "outlook" }, description: "Outlook rezervasyon bağlantısı kaldırıldı" });
  res.status(204).send();
});

router.post("/outlook-scan", requireAuth, requireActive(), requirePermission("reservations", "create"), async (_req, res) => {
  const [connection] = await db.select().from(microsoftConnectionsTable)
    .where(and(eq(microsoftConnectionsTable.profileId, res.locals.profile.id), eq(microsoftConnectionsTable.provider, "outlook")))
    .limit(1);
  if (!connection || connection.status !== "connected" || !connectionScopes(connection).includes(OUTLOOK_SCOPE)) { res.status(409).json({ error: "Yönetici önce Outlook rezervasyon bağlantısını kurmalıdır" }); return; }
  try {
    await createAuditLog({ eventType: "reservation_scan_started", actorProfileId: res.locals.profile.id, module: "reservations", metadata: { source: "outlook" }, description: "Outlook rezervasyon taraması başlatıldı" });
    const messages = await fetchTourPilotMessages(await activeAccessToken(connection));
    let imported = 0;
    for (const message of messages) {
      const [created] = await db.insert(reservationEmailImportsTable).values({
        source: "outlook", microsoftConnectionId: connection.id, outlookMessageId: message.messageId, outlookConversationId: message.conversationId,
        sender: message.sender, recipients: message.recipients, subject: message.subject, receivedAt: message.receivedAt,
        plainTextBody: message.plainTextBody, sanitizedHtmlBody: message.sanitizedHtmlBody, attachments: message.attachments,
      }).onConflictDoNothing().returning();
      if (created) {
        imported += 1;
        await createAuditLog({ eventType: "reservation_email_imported", actorProfileId: res.locals.profile.id, module: "reservations", entityType: "reservation_import", entityId: created.id, metadata: { importId: created.id, outlookMessageId: message.messageId }, description: "Outlook rezervasyon e-postası içe aktarıldı" });
      }
    }
    await createAuditLog({ eventType: "reservation_scan_completed", actorProfileId: res.locals.profile.id, module: "reservations", metadata: { imported, source: "outlook" }, description: "Outlook rezervasyon taraması tamamlandı" });
    await db.update(microsoftConnectionsTable).set({ lastSuccessfulAccessAt: new Date(), status: "connected", lastError: null }).where(eq(microsoftConnectionsTable.id, connection.id));
    res.json({ scanned: messages.length, imported });
  } catch (error) {
    await db.update(microsoftConnectionsTable).set({ status: "error", lastError: error instanceof Error ? error.message.slice(0, 250) : "Tarama başarısız" }).where(eq(microsoftConnectionsTable.id, connection.id));
    await createAuditLog({ eventType: "reservation_scan_failed", actorProfileId: res.locals.profile.id, module: "reservations", result: "failure", metadata: { source: "outlook" }, description: "Outlook rezervasyon taraması başarısız" });
    res.status(502).json({ error: error instanceof Error ? error.message : "Outlook taraması başarısız" });
  }
});

export default router;

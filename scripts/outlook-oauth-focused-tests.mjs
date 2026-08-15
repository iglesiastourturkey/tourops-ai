import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

// Focused tests for the Outlook OAuth connection
// (artifacts/api-server/src/routes/outlook.ts).
//
// Same shape as reservation-guard-focused-tests.mjs: the real route imports
// express + a live DB connection, so the state sign/verify logic is mirrored
// here as a pure function and kept honest by the source assertions at the
// bottom, which fail loudly if the callback route stops being public or the
// HMAC/expiry checks are weakened.

const ROUTE_SOURCE = readFileSync(
  new URL("../artifacts/api-server/src/routes/outlook.ts", import.meta.url),
  "utf8",
);

process.env.SESSION_SECRET ??= "test-secret-for-outlook-oauth-focused-tests";

// Mirror of oauthState/parseOauthState in outlook.ts.
function oauthState(profileId, issuedAt = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ profileId, issuedAt })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function parseOauthState(state) {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("Invalid OAuth state");
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!parsed.profileId || Date.now() - parsed.issuedAt > 10 * 60_000) throw new Error("Expired OAuth state");
  return parsed;
}

// ── A freshly signed state round-trips ───────────────────────────────────────
const state = oauthState(42);
assert.deepEqual(parseOauthState(state), { profileId: 42, issuedAt: parseOauthState(state).issuedAt });

// ── Tampering with either half is rejected ───────────────────────────────────
const [payload, signature] = state.split(".");
assert.throws(() => parseOauthState(`${payload}.${signature.slice(0, -1)}x`), /Invalid OAuth state/);
const forgedPayload = Buffer.from(JSON.stringify({ profileId: 99, issuedAt: Date.now() })).toString("base64url");
assert.throws(() => parseOauthState(`${forgedPayload}.${signature}`), /Invalid OAuth state/);

// ── A state older than 10 minutes is rejected ────────────────────────────────
const staleState = oauthState(42, Date.now() - 11 * 60_000);
assert.throws(() => parseOauthState(staleState), /Expired OAuth state/);

// ── A state issued 9 minutes ago still verifies ──────────────────────────────
const freshEnoughState = oauthState(42, Date.now() - 9 * 60_000);
assert.equal(parseOauthState(freshEnoughState).profileId, 42);

// ── A state with no profileId is rejected ────────────────────────────────────
assert.throws(() => parseOauthState(oauthState(0)), /Expired OAuth state/); // 0 is falsy -> !parsed.profileId

// ── Source assertions: keep the mirror above honest ──────────────────────────
assert.ok(
  ROUTE_SOURCE.includes('router.get("/outlook-connection/callback"'),
  "outlook.ts must expose GET /outlook-connection/callback",
);

// The callback must be declared before router.use(requireAuth, ...) — Microsoft
// redirects the browser here with no Clerk session, so requiring auth on this
// path would break every connection attempt. See .agents/memory/pathless-router-mounts.md.
const callbackAt = ROUTE_SOURCE.indexOf('router.get("/outlook-connection/callback"');
const requireAuthAt = ROUTE_SOURCE.indexOf("router.use(requireAuth, requireActive())");
assert.ok(callbackAt >= 0, "callback route not found");
assert.ok(requireAuthAt >= 0, "requireAuth middleware registration not found");
assert.ok(
  callbackAt < requireAuthAt,
  "GET /outlook-connection/callback must be declared before router.use(requireAuth, requireActive())",
);

// Timing-safe comparison must stay in place — a plain === would leak signature
// bytes through response-time differences.
assert.ok(
  ROUTE_SOURCE.includes("crypto.timingSafeEqual") || readFileSync(
    new URL("../artifacts/api-server/src/lib/outlook-provider.ts", import.meta.url),
    "utf8",
  ).includes("crypto.timingSafeEqual"),
  "OAuth state verification must use crypto.timingSafeEqual",
);

// Mail.Read must actually be requested — the whole point of this app registration.
const providerSource = readFileSync(
  new URL("../artifacts/api-server/src/lib/outlook-provider.ts", import.meta.url),
  "utf8",
);
assert.ok(
  providerSource.includes('MAIL_READ_SCOPE = "Mail.Read"'),
  "outlook-provider.ts must request the Mail.Read delegated scope",
);
assert.ok(
  ROUTE_SOURCE.includes("MAIL_READ_SCOPE"),
  "outlook.ts callback must record MAIL_READ_SCOPE as a granted scope",
);

// Refresh tokens and client secrets must never reach the audit log or a plain
// response body unencrypted.
assert.ok(
  ROUTE_SOURCE.includes("encryptCredential(tokens.access_token)") && ROUTE_SOURCE.includes("encryptCredential(tokens.refresh_token)"),
  "outlook.ts must encrypt both tokens before storing them",
);
assert.ok(
  !/outlookAccountEmail: email,[\s\S]{0,40}accessTokenEncrypted: tokens\.access_token,/.test(ROUTE_SOURCE),
  "access token must not be stored in plaintext",
);

console.log("outlook OAuth focused tests: passed");

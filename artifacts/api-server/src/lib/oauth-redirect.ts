// The browser is on this API server's own origin when it receives an OAuth
// callback's redirect, so a relative path (e.g. "/settings?...") resolves
// against the API domain, not the frontend — landing on "Cannot GET /settings"
// in production. Building an absolute URL from FRONTEND_URL — already
// configured in production for CORS (see app.ts) — avoids needing a second,
// provider-specific env var for the same frontend origin.
export function buildOAuthSuccessRedirectUrl(explicitUrl: string | undefined, path: string) {
  const explicit = explicitUrl?.trim();
  if (explicit) return explicit;
  // FRONTEND_URL is a comma-separated allowlist (see app.ts); only the first
  // origin is used as the redirect target.
  const frontendOrigin = (process.env.FRONTEND_URL ?? "").split(",")[0]?.trim().replace(/\/+$/, "");
  return frontendOrigin ? `${frontendOrigin}${path}` : path;
}

// outlook-provider.ts — Microsoft identity platform (Entra ID) OAuth client for
// the Outlook mail connection, mirroring gmail-provider.ts's exported shape so
// the route file can treat both providers symmetrically.
//
// No SDK dependency (msal-node etc.) is added for this: the authorization-code
// flow is a handful of plain HTTPS calls against well-documented endpoints, and
// gmail-provider.ts already sets the precedent of talking to the provider's
// REST API directly rather than pulling in a client library.

export const MAIL_READ_SCOPE = "Mail.Read";
// offline_access is required to receive a refresh token; openid/profile/email
// let verifyOutlookAccount read the signed-in user's address back from Graph
// without a second consent prompt.
const BASE_SCOPES = ["openid", "profile", "email", "offline_access"];

export type OutlookTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

function config() {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim();
  // The app registration is single-tenant (see .agents/memory or the Azure
  // portal — "Accounts in this organizational directory only"), so the
  // tenant-specific authorize/token endpoint is required; the multi-tenant
  // "common" endpoint would reject it.
  const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID?.trim();
  if (!clientId || !clientSecret || !redirectUri || !tenantId) {
    throw new Error("Microsoft OAuth is not configured");
  }
  return { clientId, clientSecret, redirectUri, tenantId };
}

export function isOutlookOAuthConfigured() {
  return Boolean(
    process.env.MICROSOFT_OAUTH_CLIENT_ID
    && process.env.MICROSOFT_OAUTH_CLIENT_SECRET
    && process.env.MICROSOFT_OAUTH_REDIRECT_URI
    && process.env.MICROSOFT_OAUTH_TENANT_ID,
  );
}

function authorityUrl(tenantId: string, segment: "authorize" | "token") {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/${segment}`;
}

export function createAuthorizationUrl(state: string, existingScopes: string[] = []) {
  const { clientId, redirectUri, tenantId } = config();
  const scope = Array.from(new Set([...existingScopes, ...BASE_SCOPES, MAIL_READ_SCOPE])).join(" ");
  const url = new URL(authorityUrl(tenantId, "authorize"));
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  // Forces re-consent so a previously-declined Mail.Read scope is asked for
  // again, matching the Gmail flow's prompt=consent behaviour.
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<OutlookTokens> {
  const { clientId, clientSecret, redirectUri, tenantId } = config();
  const response = await fetch(authorityUrl(tenantId, "token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      ...body,
    }),
  });
  const payload = await response.json() as OutlookTokens & { error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(`Microsoft token request failed: ${payload.error_description ?? payload.error ?? response.status}`);
  }
  return payload;
}

export async function exchangeAuthorizationCode(code: string) {
  return tokenRequest({ grant_type: "authorization_code", code });
}

export async function refreshAccessToken(refreshToken: string) {
  const tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  return tokens.access_token;
}

export async function verifyOutlookAccount(accessToken: string) {
  const response = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Microsoft Graph request failed (${response.status})`);
  const payload = await response.json() as { mail?: string | null; userPrincipalName?: string | null };
  return payload.mail ?? payload.userPrincipalName ?? null;
}

// Microsoft Graph has no direct "revoke this refresh token" endpoint for
// confidential web apps (unlike Google's /revoke). Disconnecting locally
// (deleting the stored, encrypted refresh token) is the correct and complete
// action here; the token simply expires on Microsoft's side per its own TTL.
export async function revokeOutlookCredential(): Promise<void> {
  // Intentionally a no-op — see comment above. Kept as an exported function so
  // the route file's disconnect handler can call it symmetrically with
  // revokeGoogleCredential without a provider-specific branch.
}

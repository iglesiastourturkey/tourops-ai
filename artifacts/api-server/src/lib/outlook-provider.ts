import { MAX_EMAIL_BODY_CHARS, sanitizeEmailHtml } from "./email-sanitize";

// Delegated Graph scopes: offline_access for a refresh token, Mail.Read to
// list/read inbox messages, User.Read to resolve the connected account's
// email during the OAuth callback.
export const OUTLOOK_SCOPE = "https://graph.microsoft.com/Mail.Read";
const BASE_SCOPES = ["openid", "profile", "email", "offline_access", OUTLOOK_SCOPE, "https://graph.microsoft.com/User.Read"];
const MAX_MESSAGES_PER_SCAN = 50;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type OutlookMessage = {
  messageId: string;
  conversationId: string | null;
  sender: string | null;
  recipients: string | null;
  subject: string | null;
  receivedAt: Date | null;
  plainTextBody: string | null;
  sanitizedHtmlBody: string | null;
  attachments: Array<{ name: string; mimeType: string; size: number }>;
};

function config() {
  const clientId = process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim();
  const tenantId = process.env.MICROSOFT_OAUTH_TENANT_ID?.trim();
  if (!clientId || !clientSecret || !redirectUri || !tenantId) {
    throw new Error("Microsoft OAuth is not configured");
  }
  return { clientId, clientSecret, redirectUri, tenantId };
}

export function isMicrosoftOAuthConfigured() {
  return Boolean(
    process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim()
    && process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim()
    && process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim()
    && process.env.MICROSOFT_OAUTH_TENANT_ID?.trim(),
  );
}

export function createAuthorizationUrl(state: string) {
  const { clientId, redirectUri, tenantId } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: BASE_SCOPES.join(" "),
    state,
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize?${params.toString()}`;
}

type MicrosoftTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function requestToken(body: URLSearchParams): Promise<MicrosoftTokenResponse> {
  const { tenantId } = config();
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json() as MicrosoftTokenResponse;
  if (!response.ok) throw new Error(payload.error_description ?? `Microsoft token request failed (${response.status})`);
  return payload;
}

export async function exchangeAuthorizationCode(code: string) {
  const { clientId, clientSecret, redirectUri } = config();
  const tokens = await requestToken(new URLSearchParams({
    client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
    grant_type: "authorization_code", code, scope: BASE_SCOPES.join(" "),
  }));
  if (!tokens.access_token) throw new Error("Microsoft did not return an access token. Reconnect and approve access.");
  return tokens;
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = config();
  const tokens = await requestToken(new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: "refresh_token", refresh_token: refreshToken, scope: BASE_SCOPES.join(" "),
  }));
  if (!tokens.access_token) throw new Error("Unable to refresh Microsoft access token");
  return tokens.access_token;
}

async function graphFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`${GRAPH_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Microsoft Graph request failed (${response.status})`);
  return await response.json() as T;
}

export async function verifyMicrosoftAccount(accessToken: string) {
  const profile = await graphFetch<{ mail?: string | null; userPrincipalName?: string | null }>(accessToken, "me?$select=mail,userPrincipalName");
  return profile.mail ?? profile.userPrincipalName ?? null;
}

// Microsoft does not expose a public single-refresh-token revocation endpoint
// the way Google's /oauth2/revoke does — disconnecting only removes the local
// row; there is nothing else to call here on purpose.

type GraphAddress = { emailAddress?: { address?: string | null; name?: string | null } };
type GraphMessage = {
  id: string;
  conversationId?: string | null;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  subject?: string | null;
  receivedDateTime?: string | null;
  body?: { contentType?: string; content?: string };
  hasAttachments?: boolean;
};

function addressText(recipients: GraphAddress[] | undefined) {
  const list = (recipients ?? []).map(r => r.emailAddress?.address).filter((v): v is string => Boolean(v));
  return list.length ? list.join(", ") : null;
}

export async function fetchTourPilotMessages(accessToken: string): Promise<OutlookMessage[]> {
  const filter = encodeURIComponent("categories/any(c:c eq 'TourPilot')");
  const select = "id,conversationId,from,toRecipients,subject,receivedDateTime,body,hasAttachments";
  const listed = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `me/mailFolders/inbox/messages?$filter=${filter}&$top=${MAX_MESSAGES_PER_SCAN}&$select=${select}`,
  );

  const messages = await Promise.all((listed.value ?? []).map(async (message) => {
    let attachments: OutlookMessage["attachments"] = [];
    if (message.hasAttachments) {
      const attachmentList = await graphFetch<{ value?: Array<{ name?: string; contentType?: string; size?: number }> }>(
        accessToken,
        `me/messages/${encodeURIComponent(message.id)}/attachments?$select=name,contentType,size`,
      );
      attachments = (attachmentList.value ?? []).map(item => ({
        name: item.name ?? "attachment",
        mimeType: item.contentType ?? "application/octet-stream",
        size: item.size ?? 0,
      }));
    }
    const isHtml = (message.body?.contentType ?? "").toLowerCase() === "html";
    const bodyContent = message.body?.content ?? "";
    return {
      messageId: message.id,
      conversationId: message.conversationId ?? null,
      sender: message.from?.emailAddress?.address ?? null,
      recipients: addressText(message.toRecipients),
      subject: message.subject ?? null,
      receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : null,
      plainTextBody: isHtml ? null : (bodyContent.slice(0, MAX_EMAIL_BODY_CHARS) || null),
      sanitizedHtmlBody: isHtml && bodyContent ? sanitizeEmailHtml(bodyContent) : null,
      attachments,
    };
  }));
  return messages;
}

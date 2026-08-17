import { OAuth2Client } from "google-auth-library";
import { MAX_EMAIL_BODY_CHARS, sanitizeEmailHtml } from "./email-sanitize";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_MESSAGES_PER_SCAN = 50;

export type GmailMessage = {
  messageId: string;
  threadId: string | null;
  sender: string | null;
  recipients: string | null;
  subject: string | null;
  receivedAt: Date | null;
  plainTextBody: string | null;
  sanitizedHtmlBody: string | null;
  attachments: Array<{ name: string; mimeType: string; size: number }>;
};

export type GoogleIntegration = "gmail" | "drive";

function config() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleOAuthConfigured() {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && process.env.GOOGLE_OAUTH_REDIRECT_URI);
}

export function createGoogleClient() {
  const { clientId, clientSecret, redirectUri } = config();
  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

export function createAuthorizationUrl(state: string, integration: GoogleIntegration, existingScopes: string[] = []) {
  const requestedScope = integration === "gmail" ? GMAIL_SCOPE : DRIVE_SCOPE;
  const scope = Array.from(new Set([...existingScopes, requestedScope]));
  return createGoogleClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope,
    state,
  });
}

export async function exchangeAuthorizationCode(code: string) {
  const client = createGoogleClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("Google did not return an access token. Reconnect and approve access.");
  }
  return tokens;
}

function headerValue(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string) {
  return headers?.find(header => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decodeBase64Url(value?: string | null) {
  if (!value) return "";
  return Buffer.from(value, "base64url").toString("utf8");
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

function collectMessageContent(part: GmailPart, content: { text: string[]; html: string[]; attachments: GmailMessage["attachments"] }) {
  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.filename && part.body?.attachmentId) {
    content.attachments.push({ name: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: part.body.size ?? 0 });
  }
  if (mime === "text/plain" && part.body?.data) content.text.push(decodeBase64Url(part.body.data));
  if (mime === "text/html" && part.body?.data) content.html.push(decodeBase64Url(part.body.data));
  for (const child of part.parts ?? []) collectMessageContent(child, content);
}

async function gmailFetch<T>(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Gmail API request failed (${response.status})`);
  return await response.json() as T;
}

export async function refreshAccessToken(refreshToken: string) {
  const client = createGoogleClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Unable to refresh Google access token");
  return token;
}

export async function verifyGoogleAccount(accessToken: string, integration: GoogleIntegration) {
  if (integration === "gmail") {
    const profile = await gmailFetch<{ emailAddress?: string }>(accessToken, "profile");
    return profile.emailAddress ?? null;
  }

  const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Google Drive API request failed (${response.status})`);
  const payload = await response.json() as { user?: { emailAddress?: string } };
  return payload.user?.emailAddress ?? null;
}

export async function revokeGoogleCredential(token: string) {
  const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Google token revocation failed (${response.status})`);
  }
}

export async function fetchTourPilotMessages(accessToken: string): Promise<GmailMessage[]> {
  const labels = await gmailFetch<{ labels?: Array<{ id: string; name: string }> }>(accessToken, "labels");
  const label = labels.labels?.find(item => item.name === "TourPilot");
  if (!label) throw new Error('Gmail "TourPilot" etiketi bulunamadı');

  const listed = await gmailFetch<{ messages?: Array<{ id: string; threadId?: string }> }>(
    accessToken,
    `messages?labelIds=${encodeURIComponent(label.id)}&maxResults=${MAX_MESSAGES_PER_SCAN}`,
  );
  const messages = await Promise.all((listed.messages ?? []).map(async ({ id }) => {
    const raw = await gmailFetch<{
      id: string; threadId?: string; payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> }; internalDate?: string;
    }>(accessToken, `messages/${encodeURIComponent(id)}?format=full`);
    const payload = raw.payload ?? {};
    const content = { text: [] as string[], html: [] as string[], attachments: [] as GmailMessage["attachments"] };
    collectMessageContent(payload, content);
    return {
      messageId: raw.id,
      threadId: raw.threadId ?? null,
      sender: headerValue(payload.headers, "From"),
      recipients: headerValue(payload.headers, "To"),
      subject: headerValue(payload.headers, "Subject"),
      receivedAt: raw.internalDate ? new Date(Number(raw.internalDate)) : null,
      plainTextBody: content.text.join("\n").slice(0, MAX_EMAIL_BODY_CHARS) || null,
      sanitizedHtmlBody: content.html.length ? sanitizeEmailHtml(content.html.join("\n")) : null,
      attachments: content.attachments,
    };
  }));
  return messages;
}
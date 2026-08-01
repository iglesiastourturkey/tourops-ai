/**
 * Storage service — reusable client-side utility for Replit Object Storage.
 *
 * All storage concerns are centralised here so no page component scatters
 * presigned-URL logic around the codebase.
 *
 * Flow for uploads:
 *   1. Call requestUploadUrl(file)  → server returns { uploadURL, objectPath }
 *   2. PUT the raw file binary to uploadURL (directly to GCS, no server hop)
 *   3. Store objectPath in your DB record
 *
 * Flow for serving:
 *   getStorageObjectUrl(objectPath) → /api/storage/objects/<path>
 */

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

/**
 * Ask the API server for a presigned GCS upload URL. Requires Clerk auth.
 * Pass `authToken` (from `useAuth().getToken()`) to authenticate via Bearer —
 * this is necessary in Replit's proxied deployment where session cookies may
 * not reach the API server from the browser.
 */
export async function requestUploadUrl(
  file: Pick<File, 'name' | 'size' | 'type'>,
  authToken: string | null,
): Promise<{ uploadURL: string; objectPath: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE}/storage/uploads/request-url`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * PUT the file binary directly to the presigned GCS URL (no auth needed).
 * Content-Type is intentionally omitted: the signed URL was generated without
 * binding a Content-Type header, so including one in the PUT would cause a
 * GCS V4 `SignatureDoesNotMatch` error. The MIME type has already been
 * validated server-side before the URL was issued.
 */
export async function uploadFileToGcs(uploadURL: string, file: File): Promise<void> {
  const res = await fetch(uploadURL, {
    method: 'PUT',
    // No Content-Type header — must match what was signed (nothing).
    body: file,
  });
  if (!res.ok) throw new Error(`GCS upload failed: HTTP ${res.status}`);
}

/**
 * High-level convenience: request URL then PUT the file.
 * Pass the Clerk session token (from `useAuth().getToken()`) so the API server
 * can authenticate the presigned-URL request regardless of cookie availability.
 * Returns the objectPath to store in the DB record.
 */
export async function uploadFile(file: File, authToken: string | null): Promise<string> {
  const { uploadURL, objectPath } = await requestUploadUrl(file, authToken);
  await uploadFileToGcs(uploadURL, file);
  return objectPath;
}

/**
 * Convert a stored objectPath (e.g. `/objects/uploads/some-uuid`) to a
 * browser-accessible URL served via the API.
 * Example: /objects/uploads/abc → /tourops-ai/api/storage/objects/uploads/abc
 */
export function getStorageObjectUrl(objectPath: string): string {
  // objectPath starts with /objects/…; strip leading slash for URL join
  const stripped = objectPath.replace(/^\/objects\//, '');
  return `${API_BASE}/storage/objects/${stripped}`;
}

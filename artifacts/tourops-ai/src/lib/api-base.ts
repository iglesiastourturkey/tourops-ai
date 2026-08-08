/**
 * Resolves where the frontend should send API requests.
 *
 * Historically frontend and backend were served from the same origin
 * (single Express server), so every call site used a path relative to
 * `import.meta.env.BASE_URL`. Now the frontend (Vercel) and backend
 * (Render) live on different origins, so `VITE_API_URL` — set at build
 * time — must point at the backend origin. When it's unset (local dev,
 * where a single dev server / proxy still serves both) everything falls
 * back to the old relative-path behavior.
 */
import { setBaseUrl } from '@workspace/api-client-react';

const apiOrigin = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '') || null;

// Prefixes every relative (`/...`) request made through the generated
// api-client-react hooks / customFetch with the configured origin.
setBaseUrl(apiOrigin);

const basePath = import.meta.env.BASE_URL ?? '/';
const relativeApiBase = basePath.endsWith('/') ? `${basePath}api` : `${basePath}/api`;

/** Base URL for hand-built API calls, e.g. `` `${API_BASE}/tours` ``. */
export const API_BASE = apiOrigin ? `${apiOrigin}/api` : relativeApiBase;

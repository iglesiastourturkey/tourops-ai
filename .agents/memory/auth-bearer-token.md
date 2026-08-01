---
name: Auth Bearer token via AuthGate
description: Why and how Bearer tokens are used instead of Clerk cookies for API auth
---

## Problem
In Replit's proxied-iframe dev environment, Clerk session cookies are unreliable for cross-path API calls. Without a Bearer token, `@clerk/express` `getAuth(req)` returns no userId → 401.

## Solution
`App.tsx` wraps `QueryClientProvider` in an `AuthGate` component:

```tsx
function AuthGate({ children }) {
  const { getToken, isLoaded } = useAuth();
  // Synchronous: registered before ANY child hook can fire a query
  setAuthTokenGetter(() => getToken());
  if (!isLoaded) return null;  // blocks QueryClient until Clerk ready
  return <>{children}</>;
}
```

This guarantees:
1. `_authTokenGetter` is set before `QueryClientProvider` mounts
2. Clerk is fully initialized before any React Query hook fires
3. Every generated API hook call includes `Authorization: Bearer <token>` via `customFetch`

## Why not cookies?
Clerk's `__session` cookie in dev mode expires in ~60 s. The Clerk JS SDK refreshes it, but the refresh may not reach the API server path in the Replit proxy. `getToken()` from `useAuth` always returns a fresh, valid token (auto-refreshes internally).

## Key files
- `artifacts/tourops-ai/src/App.tsx` — AuthGate implementation
- `lib/api-client-react/src/custom-fetch.ts` — setAuthTokenGetter / _authTokenGetter mechanism

**Why:** Without `AuthGate`, there's a race: stale React Query cache triggers a refetch before Clerk's token getter is registered → first batch of requests always 401.

**How to apply:** Any new workspace that shares this api-client-react package needs the same AuthGate pattern if it makes protected API calls.

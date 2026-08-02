---
name: PWA and offline foundation
description: Sprint 6.1 PWA, offline queue, location sharing, and browser notifications implementation details
---

## PWA (vite-plugin-pwa)
- Package: `vite-plugin-pwa` installed in `@workspace/tourops-ai`
- Strategy: `generateSW` (automatic — no custom sw.ts needed)
- Icons: SVG-only (`logo.svg` + `favicon.svg`) — PNG icons are a known gap for iOS Safari
- SW disabled in dev (`devOptions: { enabled: false }`) to avoid HMR interference
- Runtime caching: NetworkFirst for `/api/field/*` + `/api/guide/*` (5min), `/api/notifications/*` + `/api/dashboard/*` (2min)
- Accounting / storage / AI / documents: NOT cached (no runtimeCaching entry = NetworkOnly)
- `navigateFallback: 'index.html'` with denylist `/^\/api\//`

**Why:** SW must not serve stale accounting or financial data; NetworkFirst ensures fresh data while allowing offline degradation for field/guide pages.

## Offline Queue (IndexedDB)
- DB name: `tourpilot-offline-queue`, store: `pending-actions`
- Files: `src/lib/offlineQueue.ts` (raw IDB) + `src/contexts/OfflineQueueContext.tsx` (React context)
- Deduplication via `idempotencyKey` = djb2 hash of `method+url+body`
- Auto-retry on `window.online` event
- `OfflineQueueProvider` wraps `ProfileProvider` in `App.tsx`
- `OfflineIndicator` component added to AppShell header (shows offline badge + pending count)

**How to apply:** Field/guide pages call `queueAction(url, method, body, type, label)` from `useOfflineQueue()` when a mutation fails with a network error.

## Location Sharing
- DB table: `operationLocationsTable` in `lib/db/src/schema/operations.ts` — pushed to DB
- Backend routes:
  - `POST /api/field/operations/:id/location` — field_ops/operations/admin/super_admin
  - `GET  /api/field/operations/:id/location` — same roles
  - `POST /api/guide/operations/:id/location` — guide (must be assigned) + admin/super_admin
  - `GET  /api/guide/operations/:id/location` — guide (must be assigned) + admin/super_admin
- Frontend: `LocationShare` component (`src/components/LocationShare.tsx`) used in both field-operation-detail and guide-operation-detail
- Consent dialog shown before every first share (Turkish text)
- Maps/Waze navigation links shown after successful share
- No background tracking, no auto-permission on page load

## Browser Notifications
- Service: `src/lib/notificationService.ts` — wraps Notification API, uses SW `showNotification` when available
- Sync hook: `src/hooks/useNotificationSync.ts` — watches `useListNotifications`, mirrors unread critical items to browser notifications (uses seen-IDs set per session to avoid duplicates)
- Permission UI: added to `NotificationsPage` — `BrowserNotificationCard` component
- `AppServices` component in `App.tsx` calls `useNotificationSync()` inside the provider tree
- Permission must be explicitly requested by user (button click); never auto-prompted

## Install Prompt
- `PwaInstallPrompt` component listens for `beforeinstallprompt`, shown once per session (sessionStorage flag)
- Skipped if already in standalone mode (already installed)
- Rendered in App.tsx outside the router

## Known Limitations
- PNG icons not generated → iOS Safari add-to-homescreen uses SVG (works in iOS 16.4+)
- Offline queue does not intercept mutations automatically; field pages must explicitly call `queueAction` on network failure
- Browser notifications not delivered when app is completely closed (no FCM/APNs push)
- `api-server` tsc --noEmit has pre-existing Sprint 6 errors (Sprint 6.1 introduced no new backend TS errors; tsup builds successfully)

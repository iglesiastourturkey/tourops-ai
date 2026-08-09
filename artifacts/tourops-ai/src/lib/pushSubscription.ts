/**
 * Web Push subscription plumbing.
 *
 * Complements notificationService.ts (which shows *local* notifications while
 * the app is open). This module registers the browser with the push service so
 * the server can reach the user when TourPilot is closed.
 *
 * The "never request permission on page load" rule from notificationService.ts
 * applies here too — subscribe() must be called from a user gesture.
 */

import { customFetch } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/api-base';

/** VAPID keys are base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** The push subscription this browser already holds, if any. */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function fetchVapidPublicKey(): Promise<string | null> {
  const result = await customFetch<{ configured: boolean; publicKey: string | null }>(
    `${API_BASE}/notifications/push/public-key`,
  );
  return result.configured ? result.publicKey : null;
}

export type SubscribeFailureReason =
  | 'unsupported'
  | 'denied'
  | 'not-configured'
  | 'server-unavailable'
  | 'offline'
  | 'session'
  | 'failed';

export type SubscribeResult =
  | { ok: true; alreadySubscribed: boolean }
  | { ok: false; reason: SubscribeFailureReason; detail?: string };

/** Maps a customFetch rejection onto a reason the UI can explain honestly. */
function classifyError(err: unknown): { reason: SubscribeFailureReason; detail?: string } {
  const status = (err as { status?: number }).status;
  const message = (err as { data?: { error?: string } }).data?.error;

  if (status === undefined) {
    // customFetch only omits status for a transport-level failure.
    return typeof navigator !== 'undefined' && navigator.onLine === false
      ? { reason: 'offline' }
      : { reason: 'failed' };
  }
  if (status === 401 || status === 403) return { reason: 'session' };
  if (status === 503) return { reason: 'server-unavailable', ...(message ? { detail: message } : {}) };
  if (status >= 500) return { reason: 'server-unavailable', ...(message ? { detail: message } : {}) };
  return { reason: 'failed', ...(message ? { detail: message } : {}) };
}

/** Registers an existing browser subscription with the API. Idempotent server-side. */
async function registerWithServer(subscription: PushSubscription): Promise<boolean> {
  const payload = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) return false;

  const result = await customFetch<{ ok: boolean; alreadySubscribed?: boolean }>(
    `${API_BASE}/notifications/push/subscribe`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: payload.endpoint, keys: payload.keys }),
    },
  );
  return !!result.alreadySubscribed;
}

// Guards against overlapping calls — a double tap, or the Settings card
// mounting twice. Without it two subscribe flows race on the same PushManager
// and the loser reports a spurious failure.
let inFlight: Promise<SubscribeResult> | null = null;

/**
 * Requests permission, subscribes with the push service and registers the
 * subscription with the API. Must be called from a click/tap handler.
 *
 * Already-subscribed browsers are re-registered with the server rather than
 * treated as an error: that is what repairs the state after a failed attempt,
 * where the browser kept its subscription but the server never stored the row.
 */
export function subscribeToPush(): Promise<SubscribeResult> {
  if (inFlight) return inFlight;
  inFlight = runSubscribe().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSubscribe(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  // Ask the server first: without VAPID keys there is nothing to subscribe to,
  // and prompting the user would burn a permission request for nothing.
  let publicKey: string | null;
  try {
    publicKey = await fetchVapidPublicKey();
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  }
  if (!publicKey) return { ok: false, reason: 'not-configured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  // Tracks whether this call is what created the browser subscription, so a
  // server failure only rolls back a subscription we just made — never one the
  // user already had from an earlier successful run.
  let createdHere = false;
  let subscription: PushSubscription | null = null;

  try {
    const registration = await navigator.serviceWorker.ready;

    // Reuse the existing subscription when there is one; re-subscribing with a
    // different applicationServerKey throws, so drop a mismatched one first.
    subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const current = subscription.options.applicationServerKey;
      const expected = urlBase64ToUint8Array(publicKey);
      const matches =
        current instanceof ArrayBuffer &&
        current.byteLength === expected.byteLength &&
        new Uint8Array(current).every((byte, i) => byte === expected[i]);
      if (!matches) {
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      createdHere = true;
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }

  try {
    const alreadySubscribed = await registerWithServer(subscription);
    return { ok: true, alreadySubscribed };
  } catch (err) {
    // The server did not record the subscription. Leaving the browser
    // subscribed here is what previously made the UI report "on" after a
    // reload while no push could ever arrive.
    if (createdHere) await subscription.unsubscribe().catch(() => {});
    return { ok: false, ...classifyError(err) };
  }
}

/**
 * Reconciles this browser against the server: returns true when a subscription
 * exists AND the server holds a row for it. Safe to call on mount — the POST it
 * performs is idempotent and repairs rows lost to an earlier failure.
 */
export async function verifySubscription(): Promise<boolean> {
  const subscription = await getExistingSubscription();
  if (!subscription) return false;
  try {
    await registerWithServer(subscription);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unsubscribes this browser and removes the row on the server. Browser
 * permission itself can only be revoked by the user in site settings.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const subscription = await getExistingSubscription();
    if (!subscription) return true;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});

    // Server-side removal is best-effort: a row left behind is pruned on the
    // next failed delivery anyway.
    await customFetch(`${API_BASE}/notifications/push/subscribe`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});

    return true;
  } catch {
    return false;
  }
}

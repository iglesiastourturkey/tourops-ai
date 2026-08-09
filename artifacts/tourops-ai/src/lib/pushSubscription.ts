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

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'not-configured' | 'failed' };

/**
 * Requests permission, subscribes with the push service and registers the
 * subscription with the API. Must be called from a click/tap handler.
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };

  // Ask the server first: without VAPID keys there is nothing to subscribe to,
  // and prompting the user would burn a permission request for nothing.
  let publicKey: string | null;
  try {
    publicKey = await fetchVapidPublicKey();
  } catch {
    return { ok: false, reason: 'failed' };
  }
  if (!publicKey) return { ok: false, reason: 'not-configured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const registration = await navigator.serviceWorker.ready;

    // Reuse the existing subscription when there is one; re-subscribing with a
    // different applicationServerKey throws, so drop a mismatched one first.
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const current = subscription.options.applicationServerKey;
      const expected = urlBase64ToUint8Array(publicKey);
      const matches =
        current instanceof ArrayBuffer &&
        new Uint8Array(current).every((byte, i) => byte === expected[i]) &&
        current.byteLength === expected.byteLength;
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
    }

    const payload = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
      return { ok: false, reason: 'failed' };
    }

    await customFetch(`${API_BASE}/notifications/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: payload.endpoint, keys: payload.keys }),
    });

    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
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

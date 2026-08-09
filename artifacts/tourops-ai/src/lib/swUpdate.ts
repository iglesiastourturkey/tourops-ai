/**
 * Service worker registration + update signalling.
 *
 * Registered from app code (vite.config.ts sets `injectRegister: null`) so the
 * update callback can be hooked. Registration runs at import time, before React
 * mounts, so no update event is missed.
 *
 * Update model is 'prompt': a new worker installs and then *waits*. The running
 * tab keeps serving the build it was loaded with — which is what stops a stale
 * tab from lazy-loading route chunks that no longer exist on the CDN — and the
 * user is offered a refresh instead of being reloaded from under their feet.
 */

import { registerSW } from 'virtual:pwa-register';

type Listener = (needRefresh: boolean) => void;

const listeners = new Set<Listener>();
let needRefresh = false;

/** Applies the waiting worker and reloads. Only called from the user's click. */
let applyUpdate: (reload?: boolean) => Promise<void> = async () => {};

function emit() {
  for (const listener of listeners) listener(needRefresh);
}

if (typeof window !== 'undefined') {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
    onRegisteredSW(_url, registration) {
      // Deploys land while long-lived tabs stay open (operations staff keep the
      // app open all day), so poll hourly rather than only on navigation.
      if (!registration) return;
      setInterval(() => { void registration.update().catch(() => {}); }, 60 * 60 * 1000);
    },
  });
}

export function subscribeToSwUpdate(listener: Listener): () => void {
  listeners.add(listener);
  listener(needRefresh);
  return () => { listeners.delete(listener); };
}

/** Activates the waiting service worker and reloads the page. */
export function reloadWithUpdate(): void {
  void applyUpdate(true);
}

// ── Stale chunk recovery ──────────────────────────────────────────────────────
// Second line of defence for a tab that was already stale when the deploy
// happened: its dynamic import of a hashed chunk 404s and React would otherwise
// surface a blank error boundary. Reload once — the fresh index.html points at
// filenames that exist. The sessionStorage guard makes it strictly one attempt,
// so a genuinely broken deploy cannot turn into a reload loop.
const RELOAD_GUARD_KEY = 'chunk-reload-attempted';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', event => {
    event.preventDefault();
    let alreadyTried = true;
    try {
      alreadyTried = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
      if (!alreadyTried) sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    } catch {
      // Storage unavailable — do not reload at all rather than risk a loop.
      return;
    }
    if (!alreadyTried) window.location.reload();
  });

  // A load that got all the way to interactive is proof the assets resolved.
  window.addEventListener('load', () => {
    try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* ignore */ }
  });
}

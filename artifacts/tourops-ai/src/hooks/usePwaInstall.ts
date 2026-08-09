/**
 * usePwaInstall — shared access to the browser's deferred install prompt.
 *
 * `beforeinstallprompt` fires once, early, and often before React has mounted.
 * The listener is therefore registered at module import time and the event is
 * held in a module-level singleton, so both the first-visit banner and the
 * permanent row in Settings can trigger the same install flow — whichever
 * mounts later still sees the captured event.
 */

import { useEffect, useState } from 'react';

// Chrome/Edge inject this event before the browser install prompt.
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

/** Set once the user dismisses the banner; keeps it hidden on later visits. */
export const PWA_DISMISS_KEY = 'pwa-install-dismissed';

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari adds navigator.standalone
    (navigator as { standalone?: boolean }).standalone === true
  );
}

// ── Module-level singleton ────────────────────────────────────────────────────

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });

  // Fired after a successful install; the prompt is spent from here on.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });
}

export interface PwaInstallState {
  /** True when the browser has offered an install prompt we can still fire. */
  canInstall: boolean;
  /** True when running as an installed app — nothing should be offered. */
  isInstalled: boolean;
  /** Fires the native prompt. Returns true when the user accepted. */
  install: () => Promise<boolean>;
}

export function usePwaInstall(): PwaInstallState {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender(n => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const isInstalled = installed || isStandalone();

  async function install(): Promise<boolean> {
    if (!deferredPrompt) return false;
    const prompt = deferredPrompt;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    // A prompt can only be used once, accepted or not.
    deferredPrompt = null;
    if (choice.outcome === 'accepted') installed = true;
    emit();
    return choice.outcome === 'accepted';
  }

  return { canInstall: !!deferredPrompt && !isInstalled, isInstalled, install };
}

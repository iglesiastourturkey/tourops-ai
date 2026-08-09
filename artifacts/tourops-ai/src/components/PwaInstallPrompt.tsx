/**
 * PwaInstallPrompt — dismissable install banner shown on the first visit.
 *
 * Rules:
 *  - Hidden once the user dismisses it (localStorage flag, persists across
 *    visits — a banner that returns every session is noise)
 *  - Hidden when the app is already installed (display-mode: standalone)
 *  - Only rendered when the browser actually offered an install prompt
 *
 * Dismissing it is not the end of the road: Ayarlar → Hesap keeps a permanent
 * "Uygulamayı Yükle" row driven by the same usePwaInstall() singleton.
 */
import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePwaInstall, PWA_DISMISS_KEY } from '@/hooks/usePwaInstall';

function wasDismissed() {
  try {
    return localStorage.getItem(PWA_DISMISS_KEY) === '1';
  } catch {
    // Private mode / storage disabled — treat as not dismissed.
    return false;
  }
}

export function PwaInstallPrompt() {
  const { canInstall, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (dismissed || !canInstall) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(PWA_DISMISS_KEY, '1');
    } catch {
      // Nothing to persist to; the banner stays hidden for this session only.
    }
  };

  return (
    <div
      role="banner"
      className="fixed bottom-20 left-3 right-3 z-50 lg:left-auto lg:right-4 lg:bottom-4 lg:w-80 bg-[#0B1F3A] text-white rounded-xl shadow-2xl p-4 flex items-start gap-3 border border-white/10"
      data-testid="banner-pwa-install"
    >
      <img src="/logo.svg" alt="TourPilot" className="w-10 h-10 rounded-lg shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">TourPilot'u Yükle</p>
        <p className="text-xs text-white/70 mt-0.5 leading-snug">
          Ana ekrana ekleyerek çevrimdışıda bile kullanabilirsiniz.
        </p>
        <button
          onClick={() => void install()}
          className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold bg-[#F97316] text-white rounded-lg px-3 py-1.5 hover:bg-orange-600 transition-colors"
          data-testid="button-pwa-install-banner"
        >
          <Download className="w-3.5 h-3.5" />
          Yükle
        </button>
      </div>
      <button
        onClick={dismiss}
        className="text-white/50 hover:text-white shrink-0 mt-0.5"
        aria-label="Kapat"
        data-testid="button-pwa-dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

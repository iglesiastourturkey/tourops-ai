/**
 * PwaInstallPrompt — shows a dismissable install banner when the browser
 * supports PWA installation (`beforeinstallprompt` event).
 *
 * Rules:
 *  - Appears only once per session (sessionStorage dismiss flag)
 *  - Only shown if the app is not already installed (display-mode standalone)
 *  - Not shown on desktop Safari (which does not support installation)
 */
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

// Chrome/Edge inject this event before the browser install prompt.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = 'pwa-install-dismissed';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari adds navigator.standalone
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return; // already installed
    if (sessionStorage.getItem(DISMISS_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!visible || !deferredPrompt) return null;

  const install = async () => {
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(DISMISS_KEY, '1');
  };

  return (
    <div
      role="banner"
      className="fixed bottom-20 left-3 right-3 z-50 lg:left-auto lg:right-4 lg:bottom-4 lg:w-80 bg-[#0B1F3A] text-white rounded-xl shadow-2xl p-4 flex items-start gap-3 border border-white/10"
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
        >
          <Download className="w-3.5 h-3.5" />
          Yükle
        </button>
      </div>
      <button
        onClick={dismiss}
        className="text-white/50 hover:text-white shrink-0 mt-0.5"
        aria-label="Kapat"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

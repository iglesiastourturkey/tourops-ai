/**
 * SwUpdateNotice — gentle "new version available" banner.
 *
 * Shown when a new service worker has installed and is waiting. Nothing is
 * forced: the user keeps working until they choose to refresh, or dismisses the
 * banner (it returns on the next update, since a dismissal is per-update).
 */
import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { subscribeToSwUpdate, reloadWithUpdate } from '@/lib/swUpdate';

export function SwUpdateNotice() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => subscribeToSwUpdate(value => {
    setNeedRefresh(value);
    if (value) setDismissed(false);
  }), []);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed bottom-3 left-3 right-3 z-50 lg:left-auto lg:right-4 lg:w-80 rounded-xl border bg-card text-card-foreground shadow-lg p-3 flex items-start gap-3"
      data-testid="banner-sw-update"
    >
      <RefreshCw className="w-4 h-4 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-tight">Yeni sürüm hazır</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
          Güncellemeyi uygulamak için sayfayı yenileyin. Devam eden işiniz varsa daha sonra da yapabilirsiniz.
        </p>
        <button
          onClick={() => { setReloading(true); reloadWithUpdate(); }}
          disabled={reloading}
          className="mt-2 flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors disabled:opacity-60"
          data-testid="button-sw-update-reload"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${reloading ? 'animate-spin' : ''}`} />
          {reloading ? 'Yenileniyor...' : 'Yenile'}
        </button>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
        aria-label="Kapat"
        data-testid="button-sw-update-dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

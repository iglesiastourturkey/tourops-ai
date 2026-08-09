/**
 * DeviceSettingsCard — per-device settings on the Ayarlar → Hesap tab:
 * Web Push subscription and the permanent PWA install entry point.
 *
 * Both are device-scoped rather than account-scoped (a push subscription
 * belongs to one browser, an install to one device), which is why they live
 * here instead of anywhere role- or agency-related.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bell, BellOff, Download, Smartphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  verifySubscription,
} from '@/lib/pushSubscription';

// Each reason names the actual cause, so a server-side outage is never reported
// as "try again" — retrying cannot fix it and the user just repeats the loop.
const SUBSCRIBE_ERRORS: Record<string, string> = {
  unsupported:          'Bu tarayıcı anlık bildirimleri desteklemiyor.',
  denied:               'Bildirim izni reddedildi. Tarayıcı site ayarlarından izin verebilirsiniz.',
  'not-configured':     'Anlık bildirimler sunucuda henüz yapılandırılmamış. Yönetici ile iletişime geçin.',
  'server-unavailable': 'Sunucu bildirim aboneliğini kaydedemedi. Bu geçici bir sunucu sorunu, tekrar denemek çözmeyebilir.',
  offline:              'İnternet bağlantısı yok. Bağlandığınızda tekrar deneyin.',
  session:              'Oturumunuz doğrulanamadı. Sayfayı yenileyip tekrar deneyin.',
  failed:               'Bildirimler açılamadı. Lütfen tekrar deneyin.',
};

export function DeviceSettingsCard() {
  const { toast } = useToast();
  const { canInstall, isInstalled, install } = usePwaInstall();

  const supported = isPushSupported();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // Reflects the *server's* view, not just the browser's. A browser can hold a
  // push subscription the server never stored (an earlier attempt failed after
  // the browser had already subscribed); showing that as "on" is what made the
  // next action fail with a confusing error.
  useEffect(() => {
    if (!supported) { setSubscribed(false); return; }
    let cancelled = false;
    void verifySubscription().then(ok => {
      if (!cancelled) setSubscribed(ok);
    });
    return () => { cancelled = true; };
  }, [supported]);

  async function handleEnable() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (result.ok) {
        setSubscribed(true);
        toast({
          title: result.alreadySubscribed ? 'Bildirimler zaten açık' : 'Bildirimler açıldı',
          description: 'Bu cihaza anlık bildirim gönderilecek.',
        });
      } else {
        toast({
          title: 'Bildirimler açılamadı',
          description: result.detail ?? SUBSCRIBE_ERRORS[result.reason] ?? SUBSCRIBE_ERRORS['failed'],
          variant: 'destructive',
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await unsubscribeFromPush();
      if (ok) {
        setSubscribed(false);
        toast({ title: 'Bildirimler kapatıldı', description: 'Bu cihaza artık anlık bildirim gönderilmeyecek.' });
      } else {
        toast({ title: 'Hata', description: 'Bildirimler kapatılamadı.', variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  }

  const permissionBlocked =
    supported && typeof Notification !== 'undefined' && Notification.permission === 'denied';

  return (
    <Card className="max-w-md">
      <CardHeader><CardTitle className="text-base">Bu Cihaz</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* ── Push notifications ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              Anlık Bildirimler
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              {!supported
                ? 'Bu tarayıcı anlık bildirimleri desteklemiyor.'
                : permissionBlocked && !subscribed
                  ? 'Bildirim izni tarayıcıda engellenmiş. Site ayarlarından izin verin.'
                  : subscribed
                    ? 'Bu cihaza bildirim gönderiliyor.'
                    : 'Uygulama kapalıyken de önemli gelişmelerden haberdar olun.'}
            </p>
          </div>
          {supported && (
            subscribed
              ? (
                <Button
                  variant="outline" size="sm" className="gap-1.5 shrink-0"
                  onClick={() => void handleDisable()} disabled={busy}
                  data-testid="button-push-disable"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  {busy ? 'Kapatılıyor...' : 'Kapat'}
                </Button>
              )
              : (
                <Button
                  size="sm" className="gap-1.5 shrink-0"
                  onClick={() => void handleEnable()}
                  disabled={busy || subscribed === null || permissionBlocked}
                  data-testid="button-push-enable"
                >
                  <Bell className="w-3.5 h-3.5" />
                  {busy ? 'Açılıyor...' : 'Aç'}
                </Button>
              )
          )}
        </div>

        {/* ── PWA install — hidden entirely once the app runs standalone ── */}
        {!isInstalled && (
          <div className="flex items-start justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                Uygulama Olarak Yükle
              </p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {canInstall
                  ? 'Ana ekrana ekleyerek çevrimdışıda bile kullanın.'
                  : 'Tarayıcınızın menüsünden "Ana ekrana ekle" ile yükleyebilirsiniz.'}
              </p>
            </div>
            {canInstall && (
              <Button
                size="sm" variant="outline" className="gap-1.5 shrink-0"
                onClick={() => void install()}
                data-testid="button-pwa-install-settings"
              >
                <Download className="w-3.5 h-3.5" />
                Yükle
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

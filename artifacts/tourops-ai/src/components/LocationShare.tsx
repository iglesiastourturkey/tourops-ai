/**
 * LocationShare — "Konumumu Paylaş" card for field and guide operation detail pages.
 *
 * Rules (from spec):
 *  - Browser Geolocation API is invoked ONLY after explicit user action.
 *  - Permission is NOT requested on page load.
 *  - Tracking stops after the component unmounts (no background collection).
 *  - Clear Turkish consent text is shown before the first share.
 *  - Navigation links (Google Maps, Waze) are shown after a successful share.
 *  - Authorized roles: field_operations, operations, admin, super_admin, guide (assigned).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  MapPin, Navigation2, AlertTriangle, CheckCircle2, ExternalLink, Loader2,
} from 'lucide-react';

import { API_BASE } from '@/lib/api-base';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LocationData {
  id: number;
  profileId: number | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
  profileName: string | null;
}

interface LocationShareProps {
  operationId: number;
  /** 'field' uses /api/field, 'guide' uses /api/guide */
  context: 'field' | 'guide';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LocationShare({ operationId, context }: LocationShareProps) {
  const BASE_PATH = context === 'guide' ? `${API_BASE}/guide` : `${API_BASE}/field`;
  const locationUrl = `${BASE_PATH}/operations/${operationId}/location`;

  const qc = useQueryClient();
  const { toast } = useToast();

  const [consentOpen, setConsentOpen] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // ── Current location ────────────────────────────────────────────────────
  const { data: locationData } = useQuery<LocationData | null>({
    queryKey: ['operation-location', operationId, context],
    queryFn: () => customFetch<LocationData | null>(locationUrl).catch(() => null),
    refetchInterval: 60_000,
  });

  // ── Share mutation ────────────────────────────────────────────────────────
  const shareMutation = useMutation({
    mutationFn: (coords: { latitude: number; longitude: number; accuracy: number | null }) =>
      customFetch(locationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coords),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operation-location', operationId, context] });
      toast({ title: 'Konum paylaşıldı' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  // ── Geolocation ───────────────────────────────────────────────────────────
  const acquireAndShare = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('Bu tarayıcı konum servisini desteklemiyor.');
      return;
    }
    setAcquiring(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAcquiring(false);
        setConsentOpen(false);
        shareMutation.mutate({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
      },
      (err) => {
        setAcquiring(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGeoError('Konum izni reddedildi. Tarayıcı ayarlarınızdan konum iznini etkinleştirin.');
            break;
          case err.POSITION_UNAVAILABLE:
            setGeoError('Konum bilgisi alınamadı. Lütfen tekrar deneyin.');
            break;
          case err.TIMEOUT:
            setGeoError('Konum isteği zaman aşımına uğradı.');
            break;
          default:
            setGeoError('Konum alınırken bir hata oluştu.');
        }
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  // ── Map links ─────────────────────────────────────────────────────────────
  const mapsLink = locationData
    ? `https://maps.google.com?q=${locationData.latitude},${locationData.longitude}`
    : null;
  const wazeLink = locationData
    ? `https://waze.com/ul?ll=${locationData.latitude},${locationData.longitude}&navigate=yes`
    : null;

  const lastSharedLabel = locationData
    ? new Date(locationData.capturedAt).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
            <h3 className="text-sm font-bold text-gray-800">Konum Paylaşımı</h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setGeoError(null); setConsentOpen(true); }}
            disabled={shareMutation.isPending || acquiring}
            className="text-xs h-8 border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            {(shareMutation.isPending || acquiring) ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Navigation2 className="w-3.5 h-3.5 mr-1.5" />
            )}
            Konumumu Paylaş
          </Button>
        </div>

        {locationData ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs text-gray-600">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">
                  {locationData.profileName ?? 'Bilinmeyen kullanıcı'}
                </span>{' '}
                tarafından {lastSharedLabel} paylaşıldı
                {locationData.accuracy && (
                  <span className="text-gray-400"> (~{Math.round(locationData.accuracy)}m)</span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {mapsLink && (
                <a
                  href={mapsLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-blue-600 font-medium border border-blue-200 rounded-lg px-2.5 py-1.5 hover:bg-blue-50 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Google Maps
                </a>
              )}
              {wazeLink && (
                <a
                  href={wazeLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-cyan-600 font-medium border border-cyan-200 rounded-lg px-2.5 py-1.5 hover:bg-cyan-50 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Waze
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Henüz konum paylaşılmadı.</p>
        )}
      </div>

      {/* Consent dialog */}
      <Dialog open={consentOpen} onOpenChange={(v) => { if (!v && !acquiring) setConsentOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600 shrink-0" />
              Konum Paylaşım İzni
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm text-gray-600">
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="font-semibold text-blue-800 mb-1">Ne toplanır?</p>
              <ul className="text-xs text-blue-700 space-y-0.5">
                <li>• Enlem ve boylam koordinatları</li>
                <li>• Konum doğruluğu (metre cinsinden)</li>
                <li>• Paylaşım zamanı</li>
                <li>• Kullanıcı kimliği</li>
              </ul>
            </div>
            <div>
              <p className="text-xs text-gray-500 leading-relaxed">
                Bu bilgiler yalnızca seçili operasyonla ilişkilendirilir ve yetkili personel
                (operasyon sorumlusu, yöneticiler, ilgili rehber) tarafından görülebilir.
                Arka planda konum takibi yapılmaz; yalnızca bu butona bastığınızda
                tek seferlik konum alınır.
              </p>
            </div>
            {geoError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg p-2.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{geoError}</p>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => { setConsentOpen(false); setGeoError(null); }}
              disabled={acquiring}
              className="flex-1"
            >
              Vazgeç
            </Button>
            <Button
              onClick={acquireAndShare}
              disabled={acquiring}
              className="flex-1 bg-[#0B1F3A]"
            >
              {acquiring ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Alınıyor…</>
              ) : (
                <><Navigation2 className="w-4 h-4 mr-2" /> Paylaş</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

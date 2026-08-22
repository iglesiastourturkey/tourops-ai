import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useAuth } from '@clerk/react';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/api-base';

// Manual-entry / human review workflow for external_port_call_observations
// (see artifacts/api-server/src/routes/external-observations.ts). No
// provider/scraper code exists anywhere in the app - rows are entered by
// hand and reviewed here. Approve writes to port_calls; reject never does.

type MatchStatus =
  | 'MATCHED'
  | 'NEW_PORT_CALL'
  | 'TIME_CHANGED'
  | 'SHIP_UNMATCHED'
  | 'PORT_UNMATCHED'
  | 'CONFLICT'
  | 'SOURCE_MISSING_TIME'
  | 'MANUAL_REVIEW_REQUIRED';

interface ExternalObservation {
  id: number;
  provider: string;
  externalReference: string;
  shipNameRaw: string;
  shipId: number | null;
  portNameRaw: string;
  portId: number | null;
  arrivalDate: string | null;
  arrivalTime: string | null;
  departureDate: string | null;
  departureTime: string | null;
  matchStatus: MatchStatus;
  matchedPortCallId: number | null;
  detectedChanges: Record<string, { from: unknown; to: unknown }> | null;
  fetchedAt: string;
  approvedAt: string | null;
  approvedBy: number | null;
  rejectedAt: string | null;
  rejectedBy: number | null;
}

const STATUS_LABELS: Record<MatchStatus, string> = {
  MATCHED: 'Eşleşti',
  NEW_PORT_CALL: 'Yeni Liman Ziyareti',
  TIME_CHANGED: 'Saat Değişti',
  SHIP_UNMATCHED: 'Gemi Eşleşmedi',
  PORT_UNMATCHED: 'Liman Eşleşmedi',
  CONFLICT: 'Çakışma',
  SOURCE_MISSING_TIME: 'Saat Bilgisi Eksik',
  MANUAL_REVIEW_REQUIRED: 'Manuel İnceleme Gerekli',
};

const STATUS_COLORS: Record<MatchStatus, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-800',
  NEW_PORT_CALL: 'bg-blue-100 text-blue-800',
  TIME_CHANGED: 'bg-amber-100 text-amber-800',
  SHIP_UNMATCHED: 'bg-red-100 text-red-800',
  PORT_UNMATCHED: 'bg-red-100 text-red-800',
  CONFLICT: 'bg-red-100 text-red-800',
  SOURCE_MISSING_TIME: 'bg-gray-100 text-gray-800',
  MANUAL_REVIEW_REQUIRED: 'bg-gray-100 text-gray-800',
};

const REVIEWABLE_STATUSES = new Set<MatchStatus>(['MATCHED', 'NEW_PORT_CALL', 'TIME_CHANGED']);

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

function formatDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('tr-TR');
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('tr-TR');
}

export default function ExternalObservationsPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [confirmTarget, setConfirmTarget] = useState<{ observation: ExternalObservation; action: 'approve' | 'reject' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['external-observations', statusFilter],
    queryFn: () => customFetch<ExternalObservation[]>(`${API_BASE}/external-observations?status=${statusFilter}`),
  });

  async function authFetch(url: string, opts: RequestInit = {}) {
    const token = await getToken();
    const resp = await fetch(url, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Hata' }));
      throw new Error(err.error ?? 'İşlem başarısız');
    }
    return resp.json();
  }

  function openConfirm(observation: ExternalObservation, action: 'approve' | 'reject', e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmTarget({ observation, action });
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    setActionLoading(true);
    try {
      await authFetch(`${API_BASE}/external-observations/${confirmTarget.observation.id}/${confirmTarget.action}`, {
        method: 'POST',
      });
      toast({ title: confirmTarget.action === 'approve' ? 'Gözlem onaylandı' : 'Gözlem reddedildi' });
      setConfirmTarget(null);
      qc.invalidateQueries({ queryKey: ['external-observations'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  }

  const observations = data ?? [];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Dış Kaynak Gözlem İncelemesi</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manuel olarak girilen liman ziyareti gözlemlerini inceleyin, onaylayın veya reddedin.
          </p>
        </div>

        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="pending">Bekleyen</TabsTrigger>
            <TabsTrigger value="approved">Onaylanan</TabsTrigger>
            <TabsTrigger value="rejected">Reddedilen</TabsTrigger>
            <TabsTrigger value="all">Tümü</TabsTrigger>
          </TabsList>

          <TabsContent value={statusFilter} className="mt-4">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Kaynak</th>
                      <th className="px-4 py-3">Gemi</th>
                      <th className="px-4 py-3">Liman</th>
                      <th className="px-4 py-3">Varış / Kalkış</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Alındı</th>
                      <th className="px-4 py-3 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading &&
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-3" colSpan={7}>
                            <Skeleton className="h-5 w-full" />
                          </td>
                        </tr>
                      ))}

                    {!isLoading && isError && (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={7}>
                          Gözlemler yüklenirken bir hata oluştu.
                        </td>
                      </tr>
                    )}

                    {!isLoading && !isError && observations.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={7}>
                          Bu filtrede gösterilecek gözlem yok.
                        </td>
                      </tr>
                    )}

                    {!isLoading &&
                      !isError &&
                      observations.map((obs) => (
                        <tr key={obs.id} className="border-t align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium">{obs.provider}</div>
                            <div className="text-xs text-muted-foreground">{obs.externalReference}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div>{obs.shipNameRaw}</div>
                            {!obs.shipId && (
                              <div className="text-xs text-red-600">Sistemde eşleşen gemi yok</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div>{obs.portNameRaw}</div>
                            {!obs.portId && (
                              <div className="text-xs text-red-600">Sistemde eşleşen liman yok</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div>{formatDate(obs.arrivalDate)} {obs.arrivalTime ?? ''}</div>
                            <div className="text-xs text-muted-foreground">
                              Kalkış: {formatDate(obs.departureDate)} {obs.departureTime ?? ''}
                            </div>
                            {obs.detectedChanges && (
                              <div className="mt-1 text-xs text-amber-700 space-y-0.5">
                                {Object.entries(obs.detectedChanges).map(([field, change]) => (
                                  <div key={field}>
                                    {field}: {String(change.from ?? '-')} → {String(change.to ?? '-')}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={STATUS_COLORS[obs.matchStatus]}>{STATUS_LABELS[obs.matchStatus]}</Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(obs.fetchedAt)}</td>
                          <td className="px-4 py-3 text-right">
                            {obs.approvedAt && (
                              <span className="text-xs text-emerald-700">Onaylandı · {formatDateTime(obs.approvedAt)}</span>
                            )}
                            {obs.rejectedAt && (
                              <span className="text-xs text-red-700">Reddedildi · {formatDateTime(obs.rejectedAt)}</span>
                            )}
                            {!obs.approvedAt && !obs.rejectedAt && (
                              <div className="flex justify-end gap-2">
                                {REVIEWABLE_STATUSES.has(obs.matchStatus) ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                    onClick={(e) => openConfirm(obs, 'approve', e)}
                                  >
                                    Onayla
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground self-center">Önce düzeltilmeli</span>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 border-red-300 hover:bg-red-50"
                                  onClick={(e) => openConfirm(obs, 'reject', e)}
                                >
                                  Reddet
                                </Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!confirmTarget} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmTarget?.action === 'approve' ? 'Gözlemi onayla' : 'Gözlemi reddet'}</DialogTitle>
            <DialogDescription>
              {confirmTarget?.observation.shipNameRaw} · {confirmTarget?.observation.portNameRaw}
              {confirmTarget?.action === 'approve'
                ? ' — bu gözlem onaylandığında ilgili liman ziyareti port_calls tablosuna yazılacak.'
                : ' — bu gözlem reddedilecek ve port_calls tablosuna hiçbir yazma yapılmayacak.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={actionLoading}>
              Vazgeç
            </Button>
            <Button
              variant={confirmTarget?.action === 'reject' ? 'destructive' : 'default'}
              onClick={handleConfirm}
              disabled={actionLoading}
            >
              {confirmTarget?.action === 'approve' ? 'Onayla' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

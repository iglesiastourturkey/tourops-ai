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

// Manual review workflow for sheet_reservation_imports (see
// artifacts/api-server/src/routes/sheet-import.ts). A Google Apps Script
// trigger on the user's own "GEMI Master Operasyon" sheet pushes every
// edited "Reservations" row here via a signed webhook - one-way, Sheet ->
// TourPilot only. Nothing writes to operations/customers until an
// admin/operations user approves it here.

type SheetImportStatus = 'pending' | 'approved' | 'rejected';
type RowValue = string | number | boolean | null;

interface SheetReservationImport {
  id: number;
  sheetFileId: string;
  sheetName: string;
  rowNumber: number;
  rowData: Record<string, RowValue>;
  editedByEmail: string;
  editedAt: string;
  status: SheetImportStatus;
  matchedOperationId: number | null;
  matchedCustomerId: number | null;
  approvedAt: string | null;
  approvedBy: number | null;
  rejectedAt: string | null;
  rejectedBy: number | null;
}

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('tr-TR');
}

export default function SheetImportReviewPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [confirmTarget, setConfirmTarget] = useState<{ row: SheetReservationImport; action: 'approve' | 'reject' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sheet-import', statusFilter],
    queryFn: () => customFetch<SheetReservationImport[]>(`${API_BASE}/sheet-import?status=${statusFilter}`),
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

  function openConfirm(row: SheetReservationImport, action: 'approve' | 'reject', e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmTarget({ row, action });
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    setActionLoading(true);
    try {
      await authFetch(`${API_BASE}/sheet-import/${confirmTarget.row.id}/${confirmTarget.action}`, {
        method: 'POST',
      });
      toast({ title: confirmTarget.action === 'approve' ? 'Satır onaylandı' : 'Satır reddedildi' });
      setConfirmTarget(null);
      qc.invalidateQueries({ queryKey: ['sheet-import'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setActionLoading(false);
    }
  }

  const rows = data ?? [];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Sheet İçe Aktarım İncelemesi</h1>
          <p className="text-sm text-muted-foreground mt-1">
            GEMI Master Operasyon tablosunda düzenlenen satırları inceleyin. Onaylanan satırlar için
            taslak bir operasyon kaydı oluşturulur; siz tamamlayana kadar sistemde eksik/taslak olarak kalır.
            Reddedilen satırlar hiçbir yere yazılmaz.
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
                      <th className="px-4 py-3">Sayfa / Satır</th>
                      <th className="px-4 py-3">Düzenleyen</th>
                      <th className="px-4 py-3">Satır Verisi</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Düzenlendi</th>
                      <th className="px-4 py-3 text-right">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading &&
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-4 py-3" colSpan={6}>
                            <Skeleton className="h-5 w-full" />
                          </td>
                        </tr>
                      ))}

                    {!isLoading && isError && (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                          Kayıtlar yüklenirken bir hata oluştu.
                        </td>
                      </tr>
                    )}

                    {!isLoading && !isError && rows.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                          Bu filtrede gösterilecek kayıt yok.
                        </td>
                      </tr>
                    )}

                    {!isLoading &&
                      !isError &&
                      rows.map((row) => (
                        <tr key={row.id} className="border-t align-top">
                          <td className="px-4 py-3">
                            <div className="font-medium">{row.sheetName}</div>
                            <div className="text-xs text-muted-foreground">Satır {row.rowNumber}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">{row.editedByEmail}</td>
                          <td className="px-4 py-3">
                            <div className="max-h-32 overflow-y-auto space-y-0.5 text-xs">
                              {Object.entries(row.rowData)
                                .filter(([, v]) => v !== null && String(v).trim() !== '')
                                .map(([k, v]) => (
                                  <div key={k}>
                                    <span className="text-muted-foreground">{k}:</span> {String(v)}
                                  </div>
                                ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {row.status === 'pending' && <Badge className="bg-gray-100 text-gray-800">Bekliyor</Badge>}
                            {row.status === 'approved' && <Badge className="bg-emerald-100 text-emerald-800">Onaylandı</Badge>}
                            {row.status === 'rejected' && <Badge className="bg-red-100 text-red-800">Reddedildi</Badge>}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(row.editedAt)}</td>
                          <td className="px-4 py-3 text-right">
                            {row.approvedAt && (
                              <span className="text-xs text-emerald-700">Onaylandı · {formatDateTime(row.approvedAt)}</span>
                             )}
                            {row.rejectedAt && (
                              <span className="text-xs text-red-700">Reddedildi · {formatDateTime(row.rejectedAt)}</span>
                            )}
                            {!row.approvedAt && !row.rejectedAt && (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                  onClick={(e) => openConfirm(row, 'approve', e)}
                                >
                                  Onayla
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 border-red-300 hover:bg-red-50"
                                  onClick={(e) => openConfirm(row, 'reject', e)}
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
            <DialogTitle>{confirmTarget?.action === 'approve' ? 'Satırı onayla' : 'Satırı reddet'}</DialogTitle>
            <DialogDescription>
              {confirmTarget?.row.sheetName} · Satır {confirmTarget?.row.rowNumber}
              {confirmTarget?.action === 'approve'
                ? ' — onaylandığında taslak bir operasyon kaydı oluşturulacak; müşteri ve tur bilgilerini siz tamamlayacaksınız.'
                : ' — bu satır reddedilecek ve hiçbir kaydı oluşturulmayacak.'}
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

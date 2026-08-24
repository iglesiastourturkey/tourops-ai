import { useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { sheetImportApi, type SheetReservationImport } from '@/lib/sheet-import-api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Search } from 'lucide-react';

// Manual review workflow for sheet_reservation_imports (see
// artifacts/api-server/src/routes/sheet-import.ts). A Google Apps Script
// trigger on the user's own "GEMI Master Operasyon" sheet pushes every
// edited "Reservations" row here via a signed webhook - one-way, Sheet ->
// TourPilot only. Nothing writes to operations/customers until an
// admin/operations user approves it here.
//
// Faz 5.3: this list page now links each row to a sectioned review panel
// (/sheet-import/:id, see sheet-import-detail.tsx) where the structured
// mapped fields can be inspected and edited via PATCH /:id/review before
// approving. The raw-row preview here is intentionally truncated (first 8
// non-empty fields) - the full row is always available on the detail page's
// collapsible "Import Audit" section.
//
// Faz 5.3 hardening: the action column below now keys off row.status, not
// row.approvedAt/row.rejectedAt presence. A row that was approved and then
// edited in the sheet comes back from the server with status "pending" but
// a non-null approvedAt (it now means "last approved at", not "is approved
// right now" - see sheet-import.ts's header comment) - keying off
// approvedAt here would have kept showing "Onaylandı" and hidden the
// Onayla/Reddet buttons for a row that actually needs re-review.

type StatusFilter = 'pending' | 'approved' | 'rejected' | 'all';

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('tr-TR');
}

export default function SheetImportReviewPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [confirmTarget, setConfirmTarget] = useState<{ row: SheetReservationImport; action: 'approve' | 'reject' } | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sheet-import', statusFilter],
    queryFn: () => sheetImportApi.list(statusFilter),
  });

  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!confirmTarget) throw new Error('Seçili satır yok');
      return confirmTarget.action === 'approve'
        ? sheetImportApi.approve(confirmTarget.row.id)
        : sheetImportApi.reject(confirmTarget.row.id);
    },
    onSuccess: () => {
      toast({ title: confirmTarget?.action === 'approve' ? 'Satır onaylandı' : 'Satır reddedildi' });
      setConfirmTarget(null);
      qc.invalidateQueries({ queryKey: ['sheet-import'] });
    },
    onError: (error: Error) => {
      toast({ title: 'İşlem başarısız', description: error.message, variant: 'destructive' });
    },
  });

  function openConfirm(row: SheetReservationImport, action: 'approve' | 'reject', e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmTarget({ row, action });
  }

  const rows = data ?? [];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Sheet İçe Aktarım İncelemesi</h1>
          <p className="text-sm text-muted-foreground mt-1">
            GEMI Master Operasyon tablosunda düzenlenen satırları inceleyin. Bir satırı açarak alan alan
            düzenleyebilir, sonra onaylayabilirsiniz - onaylanan satırlar yapılandırılmış bilgilerle bir operasyon
            kaydına dönüşür. Reddedilen satırlar hiçbir yere yazılmaz.
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
                      <th className="px-4 py-3">Satır Verisi (özet)</th>
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
                            <Link href={`/sheet-import/${row.id}`} className="font-medium text-[#1e3a5f] hover:underline">
                              {row.sheetName}
                            </Link>
                            <div className="text-xs text-muted-foreground">Satır {row.rowNumber}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">{row.editedByEmail}</td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5 text-xs">
                              {Object.entries(row.rowData)
                                .filter(([, v]) => v !== null && String(v).trim() !== '')
                                .slice(0, 8)
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
                            <div className="flex justify-end flex-wrap gap-2">
                              <Link href={`/sheet-import/${row.id}`}>
                                <Button size="sm" variant="outline" className="gap-1">
                                  <Search className="w-3.5 h-3.5" />
                                  İncele
                                </Button>
                              </Link>
                              {row.status === 'approved' && (
                                <span className="text-xs text-emerald-700 self-center">Onaylandı · {formatDateTime(row.approvedAt)}</span>
                              )}
                              {row.status === 'rejected' && (
                                <span className="text-xs text-red-700 self-center">Reddedildi · {formatDateTime(row.rejectedAt)}</span>
                              )}
                              {row.status === 'pending' && (
                                <>
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
                                </>
                              )}
                            </div>
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
                ? ' — onaylandığında yapılandırılmış alanlar kullanılarak bir operasyon kaydı oluşturulacak.'
                : ' — bu satır reddedilecek ve hiçbir kaydı oluşturulmayacak.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)} disabled={confirmMutation.isPending}>
              Vazgeç
            </Button>
            <Button
              variant={confirmTarget?.action === 'reject' ? 'destructive' : 'default'}
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
            >
              {confirmTarget?.action === 'approve' ? 'Onayla' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

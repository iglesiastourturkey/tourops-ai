import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useListOperations, useDeleteOperation, useUpdateOperation, useCreateOperation, useListCustomers, useListTours } from '@workspace/api-client-react';
import { getListOperationsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ExternalLink, RefreshCw, MoreHorizontal, Archive, Trash2, Plus } from 'lucide-react';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, formatDate } from '@/lib/labels';

export default function OperationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ customerId: '', tourId: '', startDate: '', endDate: '', notes: '' });

  const { data: operations, isLoading, isError, refetch } = useListOperations();
  const { data: customers } = useListCustomers();
  const { data: tours } = useListTours();
  const deleteMutation = useDeleteOperation();
  const archiveMutation = useUpdateOperation();
  const createMutation = useCreateOperation();

  const filtered = (operations ?? []).filter(op => {
    const isArchived = op.status === 'archived';
    if (!showArchived && isArchived) return false;
    if (showArchived && !isArchived) return false;
    if (!showArchived && statusFilter !== 'all' && op.status !== statusFilter) return false;
    return true;
  });

  function handleArchive(id: number) {
    archiveMutation.mutate({ id, data: { status: 'archived' } }, {
      onSuccess: () => { toast({ title: `OP-${id} arşivlendi` }); qc.invalidateQueries({ queryKey: getListOperationsQueryKey() }); },
      onError: () => toast({ title: 'Arşivleme başarısız', variant: 'destructive' }),
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const { id } = deleteTarget;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: `OP-${id} silindi` }); qc.invalidateQueries({ queryKey: getListOperationsQueryKey() }); setDeleteTarget(null); },
      onError: () => { setDeleteTarget(null); toast({ title: 'Silme başarısız', variant: 'destructive' }); },
    });
  }

  function handleCreateOperation() {
    const customerId = Number(createForm.customerId);
    if (!customerId) {
      toast({ title: 'Müşteri seçimi zorunludur', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      data: {
        customerId,
        tourId: createForm.tourId ? Number(createForm.tourId) : undefined,
        startDate: createForm.startDate || undefined,
        endDate: createForm.endDate || undefined,
        notes: createForm.notes.trim() || undefined,
        status: 'active',
      },
    }, {
      onSuccess: (operation) => {
        qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
        setCreateOpen(false);
        setCreateForm({ customerId: '', tourId: '', startDate: '', endDate: '', notes: '' });
        toast({ title: 'Manuel operasyon oluşturuldu' });
        setLocation(`/operations/${operation.id}`);
      },
      onError: () => toast({ title: 'Operasyon oluşturulamadı', variant: 'destructive' }),
    });
  }

  return (
    <AppShell title="Operasyon Planlama">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        {!showArchived && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="select-operation-status-filter"><SelectValue placeholder="Tüm Durumlar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Durumlar</SelectItem>
              <SelectItem value="active">{OPERATION_STATUS_LABELS.active}</SelectItem>
              <SelectItem value="completed">{OPERATION_STATUS_LABELS.completed}</SelectItem>
              <SelectItem value="cancelled">{OPERATION_STATUS_LABELS.cancelled}</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Button
          variant={showArchived ? 'secondary' : 'outline'}
          onClick={() => { setShowArchived(s => !s); setStatusFilter('all'); }}
          className="gap-2"
          data-testid="button-toggle-archived-operations"
        >
          <Archive className="w-4 h-4" />{showArchived ? 'Aktif Operasyonlar' : 'Arşivlenenler'}
        </Button>
        <Button className="gap-2 sm:ml-auto" onClick={() => setCreateOpen(true)} data-testid="button-new-operation">
          <Plus className="w-4 h-4" />Yeni Operasyon Oluştur
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead className="hidden md:table-cell">Başlangıç</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Tamamlanma</TableHead>
              <TableHead className="w-12">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-destructive text-sm">Veriler yüklenemedi.</p>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} data-testid="button-retry-operations">
                      <RefreshCw className="w-3.5 h-3.5" />Yeniden Dene
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  {showArchived ? 'Arşivlenmiş operasyon bulunamadı' : 'Operasyon bulunamadı'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(op => (
                <TableRow key={op.id} data-testid={`row-operation-${op.id}`}>
                  <TableCell className="font-mono text-sm font-medium">OP-{op.id}</TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{formatDate(op.startDate)}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OPERATION_STATUS_COLORS[op.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {OPERATION_STATUS_LABELS[op.status] ?? op.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={op.completionRate} className="h-1.5 w-20" />
                      <span className="text-xs text-muted-foreground">%{Math.round(op.completionRate)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-menu-operation-${op.id}`}>
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/operations/${op.id}`} className="flex items-center gap-2 cursor-pointer">
                            <ExternalLink className="w-3.5 h-3.5" />Görüntüle / Düzenle
                          </Link>
                        </DropdownMenuItem>
                        {op.status !== 'archived' && (
                          <DropdownMenuItem className="gap-2" onClick={() => handleArchive(op.id)}>
                            <Archive className="w-3.5 h-3.5" />Arşivle
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget({ id: op.id })}
                          data-testid={`button-delete-operation-${op.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Manuel Operasyon</DialogTitle>
            <DialogDescription>Bu operasyon bir teklife bağlı olmadan oluşturulur.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Müşteri</label>
              <Select value={createForm.customerId} onValueChange={customerId => setCreateForm(form => ({ ...form, customerId }))}>
                <SelectTrigger data-testid="select-new-operation-customer"><SelectValue placeholder="Müşteri seçin" /></SelectTrigger>
                <SelectContent>
                  {(customers ?? []).map(customer => <SelectItem key={customer.id} value={String(customer.id)}>{customer.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Tur (opsiyonel)</label>
              <Select value={createForm.tourId} onValueChange={tourId => setCreateForm(form => ({ ...form, tourId }))}>
                <SelectTrigger data-testid="select-new-operation-tour"><SelectValue placeholder="Tur seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tur yok</SelectItem>
                  {(tours ?? []).map(tour => <SelectItem key={tour.id} value={String(tour.id)}>{tour.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Başlangıç</label>
                <Input type="date" value={createForm.startDate} onChange={event => setCreateForm(form => ({ ...form, startDate: event.target.value }))} data-testid="input-new-operation-start-date" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Bitiş</label>
                <Input type="date" value={createForm.endDate} onChange={event => setCreateForm(form => ({ ...form, endDate: event.target.value }))} data-testid="input-new-operation-end-date" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Notlar (opsiyonel)</label>
              <Input value={createForm.notes} onChange={event => setCreateForm(form => ({ ...form, notes: event.target.value }))} data-testid="input-new-operation-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>İptal</Button>
            <Button onClick={handleCreateOperation} disabled={createMutation.isPending} data-testid="button-submit-new-operation">
              {createMutation.isPending ? 'Oluşturuluyor...' : 'Operasyon Oluştur'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm dialog ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Operasyonu sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>OP-{deleteTarget?.id}</strong> operasyonu, tüm görevleri ve makbuzlarıyla birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              data-testid="button-confirm-delete-operation"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

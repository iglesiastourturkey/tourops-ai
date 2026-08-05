import { useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useListQuotations, useDeleteQuotation, useUpdateQuotation } from '@workspace/api-client-react';
import { getListQuotationsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, ExternalLink, MoreHorizontal, Archive, Trash2, GitBranch } from 'lucide-react';
import { QUOTATION_STATUS_LABELS, QUOTATION_STATUS_COLORS, formatCurrency, formatDate } from '@/lib/labels';

export default function QuotationsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; number: string } | null>(null);

  const { data: quotations, isLoading } = useListQuotations();
  const deleteMutation = useDeleteQuotation();
  const archiveMutation = useUpdateQuotation();

  const ACTIVE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised', 'converted'];

  const filtered = (quotations ?? []).filter(q => {
    const isArchived = q.status === 'archived';
    if (!showArchived && isArchived) return false;
    if (showArchived && !isArchived) return false;
    const ms = !search || (q.number?.toLowerCase() ?? '').includes(search.toLowerCase());
    const mst = statusFilter === 'all' || q.status === statusFilter;
    return ms && mst;
  });

  function handleArchive(id: number, number: string) {
    archiveMutation.mutate({ id, data: { status: 'archived' } }, {
      onSuccess: () => { toast({ title: `Teklif ${number} arşivlendi` }); qc.invalidateQueries({ queryKey: getListQuotationsQueryKey() }); },
      onError: () => toast({ title: 'Arşivleme başarısız', variant: 'destructive' }),
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const { id, number } = deleteTarget;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: `Teklif ${number} silindi` }); qc.invalidateQueries({ queryKey: getListQuotationsQueryKey() }); setDeleteTarget(null); },
      onError: (err) => {
        setDeleteTarget(null);
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 409) {
          toast({ title: 'Silinemez', description: 'Bu teklife bağlı aktif bir operasyon bulunmaktadır. Önce operasyonu arşivleyin ya da silin.', variant: 'destructive' });
        } else {
          toast({ title: 'Silme başarısız', variant: 'destructive' });
        }
      },
    });
  }

  const statusOptionsForFilter = showArchived
    ? [{ value: 'all', label: 'Tüm Arşiv' }]
    : [
        { value: 'all', label: 'Tüm Aktif' },
        ...ACTIVE_STATUSES.map(v => ({ value: v, label: QUOTATION_STATUS_LABELS[v] ?? v })),
      ];

  return (
    <AppShell title="Teklifler">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Teklif no ara..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-quotations" />
        </div>
        {!showArchived && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" data-testid="select-quotation-status-filter"><SelectValue placeholder="Tüm Durumlar" /></SelectTrigger>
            <SelectContent>
              {statusOptionsForFilter.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button
          variant={showArchived ? 'secondary' : 'outline'}
          onClick={() => { setShowArchived(s => !s); setStatusFilter('all'); }}
          className="gap-2"
          data-testid="button-toggle-archived-quotations"
        >
          <Archive className="w-4 h-4" />{showArchived ? 'Aktif Teklifler' : 'Arşivlenenler'}
        </Button>
        <Link href="/quotations/new"><Button className="gap-2" data-testid="button-new-quotation"><Plus className="w-4 h-4" />Yeni Teklif</Button></Link>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Teklif No</TableHead>
              <TableHead className="hidden md:table-cell">Son Geçerlilik</TableHead>
              <TableHead>Tutar</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="hidden lg:table-cell">Bağlı Operasyon</TableHead>
              <TableHead className="w-12">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                {showArchived ? 'Arşivlenmiş teklif bulunamadı' : 'Teklif bulunamadı'}
              </TableCell></TableRow>
            ) : filtered.map(q => (
              <TableRow key={q.id} data-testid={`row-quotation-${q.id}`}>
                <TableCell className="font-mono text-sm font-medium">{q.number}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{formatDate(q.expiresAt)}</TableCell>
                <TableCell className="font-semibold">{formatCurrency(q.finalPrice, q.currency)}</TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${QUOTATION_STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-600'}`}>{QUOTATION_STATUS_LABELS[q.status] ?? q.status}</span></TableCell>
                <TableCell className="hidden lg:table-cell">
                  {q.convertedOperationId ? (
                    <Link href={`/operations/${q.convertedOperationId}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                      <GitBranch className="w-3.5 h-3.5" />OP-{q.convertedOperationId}
                    </Link>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-menu-quotation-${q.id}`}>
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/quotations/${q.id}`} className="flex items-center gap-2 cursor-pointer">
                          <ExternalLink className="w-3.5 h-3.5" />Görüntüle / Düzenle
                        </Link>
                      </DropdownMenuItem>
                      {q.status !== 'archived' && (
                        <DropdownMenuItem className="gap-2" onClick={() => handleArchive(q.id, q.number ?? String(q.id))}>
                          <Archive className="w-3.5 h-3.5" />Arşivle
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2 text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget({ id: q.id, number: q.number ?? String(q.id) })}
                        data-testid={`button-delete-quotation-${q.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />Sil
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ── Delete confirm dialog ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Teklifi sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.number}</strong> numaralı teklif kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              data-testid="button-confirm-delete-quotation"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

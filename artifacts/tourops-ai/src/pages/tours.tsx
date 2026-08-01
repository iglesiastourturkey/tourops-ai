import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useListTours, useUpdateTour, useDeleteTour } from '@workspace/api-client-react';
import { getListToursQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Ship, MoreHorizontal, Archive, Trash2, ExternalLink } from 'lucide-react';
import { TOUR_STATUS_LABELS, TOUR_STATUS_COLORS, formatDate } from '@/lib/labels';

export default function ToursPage() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { data: tours, isLoading, isError, refetch } = useListTours();
  const { toast } = useToast();
  const qc = useQueryClient();

  const updateTourMutation = useUpdateTour();
  const deleteTourMutation = useDeleteTour();

  const filtered = (tours ?? []).filter(t => {
    const ms = !search || (t.name?.toLowerCase() ?? '').includes(search.toLowerCase()) || (t.code?.toLowerCase() ?? '').includes(search.toLowerCase());
    const mst = statusFilter === 'all' || t.status === statusFilter;
    return ms && mst;
  });

  function handleArchive(id: number) {
    updateTourMutation.mutate({ id, data: { status: 'archived' } }, {
      onSuccess: () => {
        toast({ title: 'Tur arşivlendi' });
        qc.invalidateQueries({ queryKey: getListToursQueryKey() });
      },
      onError: () => toast({ title: 'Arşivleme başarısız', variant: 'destructive' }),
    });
  }

  function handleDeleteConfirm() {
    if (deletingId == null) return;
    deleteTourMutation.mutate({ id: deletingId }, {
      onSuccess: () => {
        toast({ title: 'Tur silindi' });
        qc.invalidateQueries({ queryKey: getListToursQueryKey() });
        setDeletingId(null);
      },
      onError: (err: unknown) => {
        const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        if (message?.includes('active')) {
          toast({ title: 'Silinemez', description: 'Bu tura bağlı aktif bir teklif veya operasyon bulunmaktadır.', variant: 'destructive' });
        } else {
          toast({ title: 'Silme başarısız', variant: 'destructive' });
        }
        setDeletingId(null);
      },
    });
  }

  return (
    <AppShell title="Turlar">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Ad, kod ara..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-tours" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44" data-testid="select-tour-status-filter"><SelectValue placeholder="Tüm Durumlar" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Durumlar</SelectItem>
            {Object.entries(TOUR_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Link href="/tours/new"><Button className="gap-2" data-testid="button-new-tour"><Plus className="w-4 h-4" />Yeni Tur</Button></Link>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kod</TableHead>
              <TableHead>Ad</TableHead>
              <TableHead className="hidden md:table-cell">Destinasyon</TableHead>
              <TableHead className="hidden lg:table-cell">Başlangıç</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="hidden md:table-cell">Kişi</TableHead>
              <TableHead className="w-16">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10">
                  <p className="text-destructive text-sm mb-2">Turlar yüklenemedi.</p>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>Yeniden Dene</Button>
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Tur bulunamadı</TableCell></TableRow>
            ) : filtered.map(t => (
              <TableRow key={t.id} data-testid={`row-tour-${t.id}`}>
                <TableCell className="font-mono text-xs text-muted-foreground">{t.code}</TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {t.name}
                    {t.isCruiseExcursion && <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700"><Ship className="w-3 h-3" />Kruvaziyer</span>}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{t.mainDestination ?? '-'}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">{formatDate(t.startDate)}</TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TOUR_STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>{TOUR_STATUS_LABELS[t.status] ?? t.status}</span></TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{t.adultCount}Y{t.childCount > 0 ? ` + ${t.childCount}Ç` : ''}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-actions-tour-${t.id}`}>
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => navigate(`/tours/${t.id}`)} data-testid={`action-view-tour-${t.id}`}>
                        <ExternalLink className="w-3.5 h-3.5 mr-2" />
                        Görüntüle / Düzenle
                      </DropdownMenuItem>
                      {t.status !== 'archived' && (
                        <DropdownMenuItem
                          onClick={() => handleArchive(t.id)}
                          data-testid={`action-archive-tour-${t.id}`}
                          className="text-orange-600"
                        >
                          <Archive className="w-3.5 h-3.5 mr-2" />
                          Arşivle
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeletingId(t.id)}
                        data-testid={`action-delete-tour-${t.id}`}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Sil
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deletingId != null} onOpenChange={open => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turu sil</AlertDialogTitle>
            <AlertDialogDescription>
              Bu işlem geri alınamaz. Tura bağlı aktif teklif veya operasyon varsa silme engellenir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-tour"
            >
              {deleteTourMutation.isPending ? 'Siliniyor...' : 'Evet, Sil'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

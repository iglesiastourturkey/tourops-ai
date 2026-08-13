import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationApi, createDraftError, type ReservationImport } from '@/lib/reservation-api';
import { DestructiveConfirmDialog } from '@/components/destructive-confirm-dialog';
import { usePermission } from '@/hooks/usePermission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ReservationFieldsForm, normalizeReservationData,
} from '@/components/reservations/reservation-fields-form';
import { STATUS_LABELS } from '@/lib/reservation-status';
import type { ReservationData } from '@/lib/reservation-api';
import { Inbox, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';

const STATUS = STATUS_LABELS;

export default function ReservationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const reservations = useQuery({
    queryKey: ['reservations', search, status],
    queryFn: () => reservationApi.list(search, status === 'all' ? '' : status),
  });
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState<ReservationData>(() => normalizeReservationData(null));
  const createManual = useMutation({
    mutationFn: () => reservationApi.create(manualForm),
    onSuccess: (created) => {
      toast({ title: 'Rezervasyon oluşturuldu', description: 'İnceleme ekranında devam edebilirsiniz.' });
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setManualOpen(false);
      setManualForm(normalizeReservationData(null));
      navigate(`/reservations/${created.id}`);
    },
    onError: (error) => toast({ title: 'Rezervasyon oluşturulamadı', description: error.message, variant: 'destructive' }),
  });

  const canDelete = usePermission('reservations', 'delete');
  const [deleteTarget, setDeleteTarget] = useState<ReservationImport | null>(null);
  const removeReservation = useMutation({
    mutationFn: (id: number) => reservationApi.remove(id),
    onSuccess: () => {
      toast({ title: 'Rezervasyon silindi' });
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
      setDeleteTarget(null);
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast({ title: 'Silinemedi', description: createDraftError(error)?.error ?? error.message, variant: 'destructive' });
    },
  });

  const scan = useMutation({
    mutationFn: reservationApi.scan,
    onSuccess: (result) => {
      toast({ title: 'Tarama tamamlandı', description: `${result.imported} yeni e-posta içe aktarıldı.` });
      queryClient.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (error) => toast({ title: 'Tarama başarısız', description: error.message, variant: 'destructive' }),
  });

  return <AppShell title="Gelen Rezervasyonlar">
    <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-center">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Konu veya gönderen ara" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-full sm:w-56"><SelectValue placeholder="Durum" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Tüm Durumlar</SelectItem>{Object.entries(STATUS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Button className="gap-2" onClick={() => scan.mutate()} disabled={scan.isPending} data-testid="button-scan-reservations">
        <RefreshCw className={`w-4 h-4 ${scan.isPending ? 'animate-spin' : ''}`} />{scan.isPending ? 'Taranıyor...' : 'Gmail’i Tara'}
      </Button>
      <Button variant="outline" className="gap-2" onClick={() => setManualOpen(true)} data-testid="button-new-reservation">
        <Plus className="w-4 h-4" />Yeni Rezervasyon
      </Button>
    </div>
    <p className="text-xs text-muted-foreground mb-4">Sadece Gmail’deki <strong>TourPilot</strong> etiketi manuel olarak taranır. E-postalar otomatik olarak operasyon oluşturmaz.</p>
    <div className="border rounded-lg overflow-hidden bg-card">
      <Table>
        <TableHeader><TableRow><TableHead>Konu</TableHead><TableHead>Gönderen</TableHead><TableHead className="hidden md:table-cell">Tarih</TableHead><TableHead>Durum</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {reservations.isLoading ? Array.from({ length: 5 }).map((_, index) => <TableRow key={index}><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>)
            : reservations.isError ? <TableRow><TableCell colSpan={5} className="py-10 text-center"><p className="text-destructive mb-3">Rezervasyonlar yüklenemedi.</p><Button variant="outline" onClick={() => reservations.refetch()}>Yeniden Dene</Button></TableCell></TableRow>
            : !reservations.data?.length ? <TableRow><TableCell colSpan={5} className="py-14 text-center text-muted-foreground"><Inbox className="mx-auto mb-3 w-8 h-8 opacity-50" />Henüz içe aktarılmış rezervasyon e-postası yok.</TableCell></TableRow>
            : reservations.data.map(item => <TableRow key={item.id}>
              <TableCell className="font-medium max-w-[270px] truncate">{item.subject ?? '(Konu yok)'}</TableCell>
              <TableCell className="text-muted-foreground max-w-[180px] truncate">{item.sender ?? '-'}</TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground">{item.receivedAt ? new Date(item.receivedAt).toLocaleDateString('tr-TR') : '-'}</TableCell>
              <TableCell><span className="rounded-full bg-primary/10 text-primary px-2 py-1 text-xs font-medium">{STATUS[item.status] ?? item.status}</span></TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <Link href={`/reservations/${item.id}`}><Button variant="ghost" size="sm" className="gap-1"><Sparkles className="w-3.5 h-3.5" />İncele</Button></Link>
                {/* Server-side reservations.delete is the guarantee; hiding the
                    button only keeps an action the user cannot perform out of
                    reach. A converted row is refused by the server too. */}
                {canDelete && (
                  <Button
                    variant="ghost" size="sm"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(item)}
                    disabled={item.status === 'draft_created'}
                    title={item.status === 'draft_created' ? 'Önce bağlı operasyonu silin' : 'Kalıcı olarak sil'}
                    data-testid={`button-delete-reservation-${item.id}`}
                  ><Trash2 className="w-3.5 h-3.5" /></Button>
                )}
              </TableCell>
            </TableRow>)}
        </TableBody>
      </Table>
    </div>

    <DestructiveConfirmDialog
      open={Boolean(deleteTarget)}
      onOpenChange={open => { if (!open && !removeReservation.isPending) setDeleteTarget(null); }}
      title="Rezervasyon kalıcı olarak silinsin mi?"
      description={<><strong>{deleteTarget?.subject ?? '(Konu yok)'}</strong> kaydı ve AI analiz sonucu veritabanından tamamen kaldırılacak. Bu işlem geri alınamaz.</>}
      consequences={[
        'Rezervasyon kaydı ve incelenen/onaylanan alanlar silinir.',
        'Gmail’den gelen bir kayıtsa, aynı e-posta yeniden taramada tekrar içe aktarılabilir.',
        'İşlem denetim kaydına (audit log) yazılır.',
      ]}
      pending={removeReservation.isPending}
      onConfirm={() => { if (deleteTarget) removeReservation.mutate(deleteTarget.id); }}
    />

    {/* Manual entry: same field set as the review screen, so the two cannot
        drift. Saving lands the record in the normal review flow. */}
    <Dialog open={manualOpen} onOpenChange={open => { if (!createManual.isPending) setManualOpen(open); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Yeni Rezervasyon</DialogTitle>
          <DialogDescription>
            E-postayla gelmeyen bir rezervasyonu elle girin. Kayıt, normal inceleme akışına
            “Kontrol Bekliyor” durumunda eklenir.
          </DialogDescription>
        </DialogHeader>
        <ReservationFieldsForm
          value={manualForm}
          onChange={setManualForm}
          idPrefix="manual"
          disabled={createManual.isPending}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setManualOpen(false)} disabled={createManual.isPending}>İptal</Button>
          <Button
            onClick={() => createManual.mutate()}
            disabled={createManual.isPending || !String(manualForm.customerName ?? '').trim()}
          >
            {createManual.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}
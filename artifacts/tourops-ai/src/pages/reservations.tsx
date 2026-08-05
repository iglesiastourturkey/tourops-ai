import { useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationApi } from '@/lib/reservation-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Inbox, RefreshCw, Search, Sparkles } from 'lucide-react';

const STATUS: Record<string, string> = {
  new: 'Yeni', analyzing: 'Analiz Ediliyor', pending_review: 'Kontrol Bekliyor',
  missing_information: 'Eksik Bilgi', draft_created: 'Operasyon Taslağı Oluşturuldu',
  error: 'Hatalı', rejected: 'Reddedildi',
};

export default function ReservationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const reservations = useQuery({
    queryKey: ['reservations', search, status],
    queryFn: () => reservationApi.list(search, status === 'all' ? '' : status),
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
              <TableCell><Link href={`/reservations/${item.id}`}><Button variant="ghost" size="sm" className="gap-1"><Sparkles className="w-3.5 h-3.5" />İncele</Button></Link></TableCell>
            </TableRow>)}
        </TableBody>
      </Table>
    </div>
  </AppShell>;
}
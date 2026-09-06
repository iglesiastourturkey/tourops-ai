import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationRecordsApi, type ReservationRecordListFilters, type ReservationRecordListItem } from '@/lib/reservation-records-api';
import { RESERVATION_STATUS_LABELS, OPERATION_STATUS_LABELS, SOURCE_TYPE_LABELS } from '@/lib/labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent } from '@/components/ui/card';
import { Search, TicketCheck, TriangleAlert } from 'lucide-react';

const WARNING_LABELS: Record<string, string> = {
  incomplete_pax: 'Eksik PAX', missing_language: 'Dil yok', missing_pickup: 'Pickup yok',
  unlinked_operation: 'Operasyona Atanmamış', missing_booking_reference: 'Referans yok',
};

function pax(item: ReservationRecordListItem) {
  const p = item.bookingParty;
  if (!p) return '-';
  return p.totalPax != null ? String(p.totalPax) : `${p.adultCount ?? '?'}Y / ${p.childCount ?? '?'}Ç`;
}

function Warnings({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="text-muted-foreground">-</span>;
  return <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
    <TriangleAlert className="w-3.5 h-3.5 shrink-0" />{codes.map(c => WARNING_LABELS[c] ?? c).join(', ')}
  </span>;
}

export default function ReservationRecordsPage() {
  const [filters, setFilters] = useState<ReservationRecordListFilters>({});
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['reservation-records', filters, search],
    queryFn: () => reservationRecordsApi.list({ ...filters, q: search || undefined }),
  });

  const set = <K extends keyof ReservationRecordListFilters>(key: K, value: ReservationRecordListFilters[K]) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  return <AppShell title="Rezervasyonlar">
    <p className="text-xs text-muted-foreground mb-4">
      Onaylanmış rezervasyon kayıtları — e-posta/Sheet/manuel onayı tamamlanmış, kalıcı Reservation kayıtları.
      İnceleme bekleyen e-postalar için <Link href="/reservations" className="underline">Gelen Rezervasyonlar</Link> sayfasına bakın.
    </p>

    <div className="flex flex-col gap-3 mb-5 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Misafir veya müşteri ara" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <Select value={filters.reservationStatus ?? 'all'} onValueChange={v => set('reservationStatus', v === 'all' ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Rezervasyon Durumu" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Tüm Durumlar</SelectItem>{Object.entries(RESERVATION_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.operationStatus ?? 'all'} onValueChange={v => set('operationStatus', v === 'all' ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Operasyon Durumu" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Tüm Operasyonlar</SelectItem>{Object.entries(OPERATION_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.sourceType ?? 'all'} onValueChange={v => set('sourceType', v === 'all' ? undefined : v)}>
        <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Kaynak" /></SelectTrigger>
        <SelectContent><SelectItem value="all">Tüm Kaynaklar</SelectItem>{Object.entries(SOURCE_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
      </Select>
      <Button
        variant={filters.incompletePax ? 'default' : 'outline'} size="sm"
        onClick={() => set('incompletePax', filters.incompletePax ? undefined : true)}
      >Eksik PAX</Button>
      <Button
        variant={filters.missingPickup ? 'default' : 'outline'} size="sm"
        onClick={() => set('missingPickup', filters.missingPickup ? undefined : true)}
      >Pickup Eksik</Button>
    </div>

    {/* Desktop / tablet: table with progressively-hidden columns, same
        pattern as reservations.tsx and OperationsPage — never a fixed
        pixel width, never horizontal scroll. */}
    <div className="hidden sm:block border rounded-lg overflow-hidden bg-card">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Tarih</TableHead><TableHead>Misafir</TableHead>
          <TableHead className="hidden lg:table-cell">Kaynak</TableHead>
          <TableHead className="hidden lg:table-cell">Operatör</TableHead>
          <TableHead className="hidden md:table-cell">Booking Ref</TableHead>
          <TableHead>PAX</TableHead>
          <TableHead className="hidden lg:table-cell">Dil</TableHead>
          <TableHead className="hidden xl:table-cell">Pickup</TableHead>
          <TableHead>Rez. Durumu</TableHead>
          <TableHead>Operasyon</TableHead>
          <TableHead className="hidden md:table-cell">Uyarılar</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {query.isLoading ? Array.from({ length: 6 }).map((_, i) => <TableRow key={i}><TableCell colSpan={11}><Skeleton className="h-8 w-full" /></TableCell></TableRow>)
            : query.isError ? <TableRow><TableCell colSpan={11} className="py-10 text-center"><p className="text-destructive mb-3">Rezervasyonlar yüklenemedi.</p><Button variant="outline" onClick={() => query.refetch()}>Yeniden Dene</Button></TableCell></TableRow>
            : !query.data?.length ? <TableRow><TableCell colSpan={11} className="py-14 text-center text-muted-foreground"><TicketCheck className="mx-auto mb-3 w-8 h-8 opacity-50" />Kayıt bulunamadı.</TableCell></TableRow>
            : query.data.map(item => <TableRow key={item.reservation.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">{item.operation?.startDate ? new Date(item.operation.startDate).toLocaleDateString('tr-TR') : '-'}</TableCell>
              <TableCell className="font-medium max-w-[220px] truncate">
                <Link href={`/reservation-records/${item.reservation.id}`} className="hover:underline">{item.reservation.leadGuestName}</Link>
                {item.customer && <div className="text-xs text-muted-foreground truncate">{item.customer.name}</div>}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">{item.reservation.sourceType ? SOURCE_TYPE_LABELS[item.reservation.sourceType] ?? item.reservation.sourceType : '-'}</TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground truncate max-w-[140px]">{item.bookingParty?.externalOperator ?? '-'}</TableCell>
              <TableCell className="hidden md:table-cell text-muted-foreground truncate max-w-[140px]">{item.reservation.sourceBookingReference ?? '-'}</TableCell>
              <TableCell>{pax(item)}</TableCell>
              <TableCell className="hidden lg:table-cell text-muted-foreground">{item.bookingParty?.passengerLanguage ?? '-'}</TableCell>
              <TableCell className="hidden xl:table-cell text-muted-foreground truncate max-w-[160px]">{item.bookingParty?.pickupPoint ?? '-'}</TableCell>
              <TableCell><span className="rounded-full bg-primary/10 text-primary px-2 py-1 text-xs font-medium whitespace-nowrap">{RESERVATION_STATUS_LABELS[item.reservation.status] ?? item.reservation.status}</span></TableCell>
              <TableCell className="whitespace-nowrap">
                {item.operation ? <Link href={`/operations/${item.operation.id}`} className="text-xs underline">{OPERATION_STATUS_LABELS[item.operation.status] ?? item.operation.status}</Link> : <span className="text-xs text-muted-foreground">Operasyona Atanmamış</span>}
              </TableCell>
              <TableCell className="hidden md:table-cell"><Warnings codes={item.warnings} /></TableCell>
            </TableRow>)}
        </TableBody>
      </Table>
    </div>

    {/* Mobile: compact cards, no table at all. */}
    <div className="sm:hidden space-y-3">
      {query.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
        : query.isError ? <Card><CardContent className="py-8 text-center"><p className="text-destructive mb-3">Rezervasyonlar yüklenemedi.</p><Button variant="outline" onClick={() => query.refetch()}>Yeniden Dene</Button></CardContent></Card>
        : !query.data?.length ? <Card><CardContent className="py-10 text-center text-muted-foreground">Kayıt bulunamadı.</CardContent></Card>
        : query.data.map(item => <Link key={item.reservation.id} href={`/reservation-records/${item.reservation.id}`}>
          <Card className="hover:bg-accent/40 transition-colors">
            <CardContent className="p-4 space-y-1.5">
              <div className="flex justify-between items-start gap-2">
                <span className="font-semibold">{item.reservation.leadGuestName}</span>
                <span className="rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium whitespace-nowrap">{RESERVATION_STATUS_LABELS[item.reservation.status] ?? item.reservation.status}</span>
              </div>
              <div className="text-xs text-muted-foreground">{item.operation?.startDate ? new Date(item.operation.startDate).toLocaleDateString('tr-TR') : '-'} · {item.reservation.sourceType ? SOURCE_TYPE_LABELS[item.reservation.sourceType] ?? item.reservation.sourceType : '-'} · PAX {pax(item)}</div>
              <div className="text-xs text-muted-foreground">{item.operation ? `Operasyon: ${OPERATION_STATUS_LABELS[item.operation.status] ?? item.operation.status}` : 'Operasyona Atanmamış'}</div>
              {item.warnings.length > 0 && <Warnings codes={item.warnings} />}
            </CardContent>
          </Card>
        </Link>)}
    </div>
  </AppShell>;
}

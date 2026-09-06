import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import {
  reservationRecordsApi, type ReservationRecordEdit,
} from '@/lib/reservation-records-api';
import { RESERVATION_STATUS_LABELS, OPERATION_STATUS_LABELS, SOURCE_TYPE_LABELS } from '@/lib/labels';
import { nextReservationStatuses } from '@/lib/reservation-record-status';
import { usePermission } from '@/hooks/usePermission';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, TriangleAlert, Users } from 'lucide-react';

const WARNING_LABELS: Record<string, string> = {
  incomplete_pax: 'Eksik PAX', missing_language: 'Dil bilgisi yok', missing_pickup: 'Pickup noktası yok',
  unlinked_operation: 'Operasyona Atanmamış', missing_booking_reference: 'Booking referansı yok',
};

/**
 * Reservation Detail Workspace (Phase 2A). Six clearly separated sections —
 * this is deliberately NOT laid out as a child form embedded inside the
 * Operation screen: Reservation is the booking/customer commitment,
 * Operation is the execution of one or more Reservations, and Section D
 * below only ever links out to the existing Operation Detail Workspace
 * (OperationDomainWorkspace) rather than re-rendering any of it here.
 */
export default function ReservationRecordDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const { toast } = useToast();
  const client = useQueryClient();
  const canEdit = usePermission('reservations', 'update');

  const query = useQuery({
    queryKey: ['reservation-record', id],
    queryFn: () => reservationRecordsApi.get(id),
    enabled: Number.isSafeInteger(id) && id > 0,
  });

  const [status, setStatus] = useState('');
  const [leadGuestName, setLeadGuestName] = useState('');
  const [bookingReference, setBookingReference] = useState('');
  const [adultCount, setAdultCount] = useState<string>('');
  const [childCount, setChildCount] = useState<string>('');
  const [passengerLanguage, setPassengerLanguage] = useState('');
  const [pickupPoint, setPickupPoint] = useState('');
  const [itineraryRaw, setItineraryRaw] = useState('');

  useEffect(() => {
    if (!query.data) return;
    setStatus(query.data.reservation.status);
    setLeadGuestName(query.data.reservation.leadGuestName);
    setBookingReference(query.data.reservation.sourceBookingReference ?? '');
    setAdultCount(query.data.bookingParty?.adultCount != null ? String(query.data.bookingParty.adultCount) : '');
    setChildCount(query.data.bookingParty?.childCount != null ? String(query.data.bookingParty.childCount) : '');
    setPassengerLanguage(query.data.bookingParty?.passengerLanguage ?? '');
    setPickupPoint(query.data.bookingParty?.pickupPoint ?? '');
    setItineraryRaw(query.data.bookingParty?.itineraryRaw ?? '');
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => {
      const edit: ReservationRecordEdit = {
        reservation: {
          status,
          leadGuestName: leadGuestName.trim(),
          sourceBookingReference: bookingReference.trim() || null,
        },
      };
      if (query.data?.bookingParty) {
        edit.bookingParty = {
          adultCount: adultCount === '' ? null : Number(adultCount),
          childCount: childCount === '' ? null : Number(childCount),
          passengerLanguage: passengerLanguage.trim() || null,
          pickupPoint: pickupPoint.trim() || null,
          itineraryRaw: itineraryRaw.trim() || null,
        };
      }
      return reservationRecordsApi.update(id, edit);
    },
    onSuccess: () => {
      toast({ title: 'Rezervasyon güncellendi' });
      client.invalidateQueries({ queryKey: ['reservation-record', id] });
      client.invalidateQueries({ queryKey: ['reservation-records'] });
    },
    onError: (error: Error) => toast({ title: 'Güncellenemedi', description: error.message, variant: 'destructive' }),
  });

  if (query.isLoading) return <AppShell title="Rezervasyon"><Skeleton className="h-64 w-full" /></AppShell>;
  if (query.isError || !query.data) return <AppShell title="Rezervasyon">
    <p className="text-destructive mb-3">Rezervasyon yüklenemedi.</p>
    <Link href="/reservation-records"><Button variant="outline" className="gap-2"><ArrowLeft className="w-4 h-4" />Listeye dön</Button></Link>
  </AppShell>;

  const data = query.data;
  const allowedStatuses = nextReservationStatuses(data.reservation.status);

  return <AppShell title={`Rezervasyon: ${data.reservation.leadGuestName}`}>
    <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
      <Link href="/reservation-records"><Button variant="ghost" size="sm" className="gap-2"><ArrowLeft className="w-4 h-4" />Listeye dön</Button></Link>
      {canEdit && <Button size="sm" className="gap-2" onClick={() => save.mutate()} disabled={save.isPending}>
        <Save className="w-4 h-4" />{save.isPending ? 'Kaydediliyor…' : 'Kaydet'}
      </Button>}
    </div>

    {data.warnings.length > 0 && <Card className="mb-4 border-amber-300 bg-amber-50 dark:bg-amber-950/20">
      <CardContent className="p-4 flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
        <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{data.warnings.map(c => WARNING_LABELS[c] ?? c).join(' · ')}</span>
      </CardContent>
    </Card>}

    <div className="grid gap-4 lg:grid-cols-2">
      {/* A — Identity */}
      <Card>
        <CardHeader><CardTitle className="text-base">Rezervasyon Bilgisi</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div><label className="text-xs text-muted-foreground block mb-1">Lead Guest</label>
            <Input value={leadGuestName} onChange={e => setLeadGuestName(e.target.value)} disabled={!canEdit} /></div>
          <div><label className="text-xs text-muted-foreground block mb-1">Durum</label>
            <Select value={status} onValueChange={setStatus} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{allowedStatuses.map(s => <SelectItem key={s} value={s}>{RESERVATION_STATUS_LABELS[s] ?? s}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><label className="text-xs text-muted-foreground block mb-1">Booking Referansı</label>
            <Input value={bookingReference} onChange={e => setBookingReference(e.target.value)} disabled={!canEdit} placeholder="Advisory — benzersizlik zorunlu değil" /></div>
          {data.reservation.reservationType && <p className="text-xs text-muted-foreground">Tip: {data.reservation.reservationType}</p>}
          <p className="text-xs text-muted-foreground">Oluşturulma: {new Date(data.reservation.createdAt).toLocaleString('tr-TR')}</p>
        </CardContent>
      </Card>

      {/* B — BookingParty */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Yolcu / Booking Detayı</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data.bookingParty ? <>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground block mb-1">Yetişkin</label>
                <Input type="number" min={0} value={adultCount} onChange={e => setAdultCount(e.target.value)} disabled={!canEdit} /></div>
              <div><label className="text-xs text-muted-foreground block mb-1">Çocuk</label>
                <Input type="number" min={0} value={childCount} onChange={e => setChildCount(e.target.value)} disabled={!canEdit} /></div>
            </div>
            <p className="text-xs text-muted-foreground">
              Toplam PAX: {data.bookingParty.totalPax ?? 'Eksik (Y veya Ç boş)'} — kayıtlı misafir sayısından değil, Yetişkin+Çocuk toplamından hesaplanır.
            </p>
            <div><label className="text-xs text-muted-foreground block mb-1">Dil</label>
              <Input value={passengerLanguage} onChange={e => setPassengerLanguage(e.target.value)} disabled={!canEdit} /></div>
            <div><label className="text-xs text-muted-foreground block mb-1">Pickup Noktası</label>
              <Input value={pickupPoint} onChange={e => setPickupPoint(e.target.value)} disabled={!canEdit} /></div>
            <div><label className="text-xs text-muted-foreground block mb-1">Tur / İtinerary</label>
              <Input value={itineraryRaw} onChange={e => setItineraryRaw(e.target.value)} disabled={!canEdit} /></div>
            <p className="text-xs text-muted-foreground">
              Pickup saati Operasyon üzerinden yönetilir (bkz. bağlı Operasyon sayfası) — burada tekrar düzenlenmez.
            </p>
            {(data.bookingParty.externalOperator || data.bookingParty.netAmount) && <div className="text-xs text-muted-foreground pt-2 border-t space-y-0.5">
              {data.bookingParty.externalOperator && <p>Operatör: {data.bookingParty.externalOperator}</p>}
              {data.bookingParty.netAmount && <p>Net Tutar: {data.bookingParty.netAmount} {data.bookingParty.currency ?? ''}</p>}
            </div>}
          </> : <p className="text-muted-foreground">Bu rezervasyona ait booking party kaydı yok.</p>}
        </CardContent>
      </Card>

      {/* C — Customer (PII-cautious: id + name only, rest lives on the Customer page) */}
      <Card>
        <CardHeader><CardTitle className="text-base">Müşteri</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {data.customer ? <Link href={`/customers/${data.customer.id}`} className="underline font-medium">{data.customer.name}</Link>
            : <p className="text-muted-foreground">Müşteri kaydı bağlı değil.</p>}
        </CardContent>
      </Card>

      {/* D — Operation association: link out only, never embedded. */}
      <Card>
        <CardHeader><CardTitle className="text-base">Operasyon</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.operation ? <>
            <p>
              <Link href={`/operations/${(data.operation as { id: number }).id}`} className="underline font-medium">
                Operasyon #{(data.operation as { id: number }).id}
              </Link>
              {' · '}{OPERATION_STATUS_LABELS[(data.operation as { status: string }).status] ?? (data.operation as { status: string }).status}
            </p>
            <p className="text-xs text-muted-foreground">
              Bu rezervasyon, bu operasyonun gerçekleştirdiği rezervasyonlardan biridir — operasyon rezervasyonun
              kendisi değil, uygulanmasıdır.
            </p>
            {data.siblingReservations.length > 0 && <div className="text-xs text-muted-foreground pt-2 border-t">
              Aynı operasyondaki diğer rezervasyonlar:
              <ul className="mt-1 space-y-0.5">
                {data.siblingReservations.map(s => <li key={s.id}>
                  <Link href={`/reservation-records/${s.id}`} className="underline">{s.leadGuestName}</Link>
                  {' — '}{RESERVATION_STATUS_LABELS[s.status] ?? s.status}
                </li>)}
              </ul>
            </div>}
          </> : <p className="text-muted-foreground">Operasyona Atanmamış.</p>}
        </CardContent>
      </Card>

      {/* E — Guests: only real records, never synthesized to match PAX. */}
      <Card>
        <CardHeader><CardTitle className="text-base">Misafirler</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {data.bookingParty?.guests.length ? <ul className="space-y-1">
            {data.bookingParty.guests.map(g => <li key={g.id}>{g.name}{g.age != null ? ` · Yaş: ${g.age}` : ''}</li>)}
          </ul> : <p className="text-muted-foreground">Kayıtlı misafir yok — bu, PAX sayısının yanlış olduğu anlamına gelmez.</p>}
        </CardContent>
      </Card>

      {/* F — Provenance: human-readable, no opaque IDs. */}
      <Card>
        <CardHeader><CardTitle className="text-base">Kaynak</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>{data.reservation.sourceType ? SOURCE_TYPE_LABELS[data.reservation.sourceType] ?? data.reservation.sourceType : 'Bilinmiyor'}</p>
          {data.activity.activity.length > 0 && <div className="text-xs text-muted-foreground pt-2 border-t">
            Son etkinlik:
            <ul className="mt-1 space-y-0.5">
              {data.activity.activity.slice(0, 5).map(a => <li key={a.id}>{new Date(a.createdAt).toLocaleString('tr-TR')} — {a.actorName ?? 'Sistem'}</li>)}
            </ul>
          </div>}
        </CardContent>
      </Card>
    </div>
  </AppShell>;
}

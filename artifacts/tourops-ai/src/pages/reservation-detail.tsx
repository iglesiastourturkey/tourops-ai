import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationApi, type ReservationData } from '@/lib/reservation-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, FileText, RefreshCw, Save, Sparkles, XCircle } from 'lucide-react';

const FIELDS: Array<[key: string, label: string, type?: string]> = [
  ['agencyName', 'Acente'], ['bookingReference', 'Rezervasyon Referansı'], ['customerName', 'Müşteri Adı'], ['customerEmail', 'Müşteri E-postası'], ['customerPhone', 'Müşteri Telefonu'],
  ['tourName', 'Tur Adı'], ['tourDate', 'Tur Tarihi', 'date'], ['guestCount', 'Toplam Misafir', 'number'], ['adultCount', 'Yetişkin', 'number'], ['childCount', 'Çocuk', 'number'],
  ['hotelName', 'Otel'], ['pickupLocation', 'Alış Noktası'], ['pickupTime', 'Alış Saati'], ['dropoffLocation', 'Bırakış Noktası'], ['flightNumber', 'Uçuş Numarası'],
  ['guideLanguage', 'Rehber Dili'], ['vehicleType', 'Araç Tipi'], ['amount', 'Tutar', 'number'], ['currency', 'Para Birimi'],
];

function normalize(data: ReservationData | null | undefined): ReservationData {
  return Object.fromEntries(FIELDS.map(([key]) => [key, data?.[key] ?? null]).concat([['transferRequired', data?.transferRequired ?? null], ['specialRequests', data?.specialRequests ?? null], ['internalNotes', data?.internalNotes ?? null]]));
}

export default function ReservationDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<ReservationData>({});
  const [confirmDraft, setConfirmDraft] = useState(false);
  const detail = useQuery({ queryKey: ['reservation', id], queryFn: () => reservationApi.get(id), enabled: Boolean(id) });
  useEffect(() => { if (detail.data?.extraction) setForm(normalize(detail.data.extraction.approvedData ?? detail.data.extraction.extractedData)); }, [detail.data]);
  const refresh = () => { client.invalidateQueries({ queryKey: ['reservation', id] }); client.invalidateQueries({ queryKey: ['reservations'] }); };
  const analyze = useMutation({ mutationFn: () => reservationApi.analyze(id), onSuccess: () => { toast({ title: 'AI analizi tamamlandı' }); refresh(); }, onError: error => toast({ title: 'Analiz başarısız', description: error.message, variant: 'destructive' }) });
  const save = useMutation({ mutationFn: () => reservationApi.review(id, form), onSuccess: () => { toast({ title: 'İnceleme kaydedildi' }); refresh(); }, onError: error => toast({ title: 'Kayıt başarısız', description: error.message, variant: 'destructive' }) });
  const reject = useMutation({ mutationFn: () => reservationApi.reject(id), onSuccess: () => { toast({ title: 'Rezervasyon reddedildi' }); refresh(); }, onError: () => toast({ title: 'İşlem başarısız', variant: 'destructive' }) });
  const draft = useMutation({ mutationFn: () => reservationApi.createDraft(id), onSuccess: result => { toast({ title: result.duplicate ? 'Mevcut taslak açıldı' : 'Operasyon taslağı oluşturuldu' }); navigate(`/operations/${result.operation.id}`); }, onError: error => toast({ title: 'Taslak oluşturulamadı', description: error.message, variant: 'destructive' }) });
  const item = detail.data;
  if (detail.isLoading) return <AppShell title="Rezervasyon"><div className="space-y-4"><div className="h-24 bg-muted animate-pulse rounded-xl" /><div className="h-96 bg-muted animate-pulse rounded-xl" /></div></AppShell>;
  if (!item) return <AppShell title="Rezervasyon"><Card><CardContent className="py-12 text-center">Rezervasyon bulunamadı.</CardContent></Card></AppShell>;
  const extraction = item.extraction;
  return <AppShell title="Rezervasyon İncelemesi">
    <div className="flex flex-wrap justify-between gap-2 mb-5">
      <Link href="/reservations"><Button variant="ghost" className="gap-1"><ArrowLeft className="w-4 h-4" />Gelen Rezervasyonlar</Button></Link>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="gap-1"><RefreshCw className={`w-4 h-4 ${analyze.isPending ? 'animate-spin' : ''}`} />Yeniden Analiz Et</Button>
        {extraction && <><Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending} className="gap-1"><Save className="w-4 h-4" />Kaydet</Button><Button variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending} className="gap-1"><XCircle className="w-4 h-4" />Reddet</Button><Button onClick={() => setConfirmDraft(true)} className="gap-1"><CheckCircle2 className="w-4 h-4" />Taslak Oluştur</Button></>}
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        {!extraction ? <Card><CardContent className="py-12 text-center"><Sparkles className="w-8 h-8 mx-auto mb-3 text-primary" /><p className="mb-3">Bu e-posta henüz analiz edilmedi.</p><Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>{analyze.isPending ? 'Analiz Ediliyor...' : 'AI ile Analiz Et'}</Button></CardContent></Card> :
          <Card><CardHeader><CardTitle className="flex items-center justify-between text-base"><span>Çıkarılan Bilgiler</span><span className="text-xs text-muted-foreground">Güven: %{extraction.confidenceScore ?? 0}</span></CardTitle></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">
            {FIELDS.map(([key, label, type]) => <label key={key} className="text-sm"><span className="block text-xs text-muted-foreground mb-1">{label}</span><Input type={type ?? 'text'} value={String(form[key] ?? '')} onChange={e => setForm(current => ({ ...current, [key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null) }))} /></label>)}
            <label className="text-sm flex gap-2 items-center md:col-span-2"><input type="checkbox" checked={form.transferRequired === true} onChange={e => setForm(current => ({ ...current, transferRequired: e.target.checked }))} />Transfer gerekli</label>
            <label className="text-sm md:col-span-2"><span className="block text-xs text-muted-foreground mb-1">Özel İstekler</span><Textarea value={String(form.specialRequests ?? '')} onChange={e => setForm(current => ({ ...current, specialRequests: e.target.value || null }))} /></label>
            <label className="text-sm md:col-span-2"><span className="block text-xs text-muted-foreground mb-1">İç Notlar</span><Textarea value={String(form.internalNotes ?? '')} onChange={e => setForm(current => ({ ...current, internalNotes: e.target.value || null }))} /></label>
          </CardContent></Card>}
      </div>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">E-posta Özeti</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p><strong>Konu:</strong> {item.subject ?? '-'}</p><p><strong>Gönderen:</strong> {item.sender ?? '-'}</p><p><strong>Tarih:</strong> {item.receivedAt ? new Date(item.receivedAt).toLocaleString('tr-TR') : '-'}</p>{item.attachments?.length ? <p><strong>Ekler:</strong> {item.attachments.map(file => file.name).join(', ')}</p> : null}</CardContent></Card>
        {extraction && <Card><CardHeader><CardTitle className="text-base">AI Değerlendirmesi</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{extraction.summaryTr}</p><p><strong>Eksik:</strong> {extraction.missingFields?.join(', ') || 'Yok'}</p><p><strong>Belirsiz:</strong> {extraction.uncertainFields?.join(', ') || 'Yok'}</p></CardContent></Card>}
        <Card><CardHeader><CardTitle className="text-base flex gap-2 items-center"><FileText className="w-4 h-4" />Orijinal İçerik</CardTitle></CardHeader><CardContent><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{item.plainTextBody ?? '(Düz metin içeriği yok)'}</pre></CardContent></Card>
      </div>
    </div>
    <AlertDialog open={confirmDraft} onOpenChange={setConfirmDraft}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Operasyon taslağı oluşturulsun mu?</AlertDialogTitle><AlertDialogDescription>Bu işlem onaylanmış alanları kullanarak müşteriyi güvenilir iletişim bilgileriyle eşleştirir veya oluşturur. Bu e-posta için yalnızca bir taslak operasyon oluşturulabilir.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>İptal</AlertDialogCancel><AlertDialogAction onClick={() => draft.mutate()} disabled={draft.isPending}>{draft.isPending ? 'Oluşturuluyor...' : 'Taslak Oluştur'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppShell>;
}
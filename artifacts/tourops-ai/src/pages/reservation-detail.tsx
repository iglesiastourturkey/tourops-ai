import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationApi, createDraftError, type ReservationData } from '@/lib/reservation-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, FileText, Quote, RefreshCw, Save, Sparkles, XCircle } from 'lucide-react';

const FIELDS: Array<[key: string, label: string, type?: string]> = [
  ['agencyName', 'Acente'], ['bookingReference', 'Rezervasyon Referansı'], ['customerName', 'Müşteri Adı'], ['customerEmail', 'Müşteri E-postası'], ['customerPhone', 'Müşteri Telefonu'],
  ['tourName', 'Tur Adı'], ['tourDate', 'Tur Tarihi', 'date'], ['guestCount', 'Toplam Misafir', 'number'], ['adultCount', 'Yetişkin', 'number'], ['childCount', 'Çocuk', 'number'],
  ['hotelName', 'Otel'], ['pickupLocation', 'Alış Noktası'], ['pickupTime', 'Alış Saati'], ['dropoffLocation', 'Bırakış Noktası'], ['flightNumber', 'Uçuş Numarası'],
  ['guideLanguage', 'Rehber Dili'], ['vehicleType', 'Araç Tipi'], ['amount', 'Tutar', 'number'], ['currency', 'Para Birimi'],
];

const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(FIELDS.map(([key, label]) => [key, label])),
  transferRequired: 'Transfer Gerekli', specialRequests: 'Özel İstekler', internalNotes: 'İç Notlar',
};

/**
 * Turns a create-draft pre-condition failure into a message that names the
 * failing check, instead of a generic "hata oluştu".
 */
function draftErrorDescription(error: Error): string {
  const body = createDraftError(error);
  if (!body) return error.message;
  if (body.code === 'missing_fields' && body.missingFields?.length) {
    const labels = body.missingFields.map(field => FIELD_LABELS[field] ?? field).join(', ');
    return `${body.error ?? 'Zorunlu alanlar eksik.'} Eksik alanlar: ${labels}.`;
  }
  return body.error ?? error.message;
}

/**
 * Source quote the AI attributed to one extracted field, shown on demand next
 * to that field's label.
 *
 * A popover rather than a tooltip: the reviewer works on tablet/mobile too, and
 * a hover-only affordance would be unreachable on touch. The quote is plain text
 * from an untrusted email body — rendered as a React text node, never as HTML.
 *
 * The trigger keeps a 28x28 hit area (project convention for icon-only actions)
 * pulled back vertically, so it stays tappable without changing the row height.
 */
function EvidenceHint({ fieldLabel, quote }: { fieldLabel: string; quote?: string | null }) {
  if (typeof quote !== 'string' || !quote.trim()) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${fieldLabel}: AI'ın dayandığı kaynak metni göster`}
          className="shrink-0 inline-flex h-7 w-7 -my-1.5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
        >
          <Quote className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] text-xs">
        <p className="font-medium mb-1.5">{fieldLabel} — kaynak metin</p>
        <p className="text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-auto">
          “{quote.trim()}”
        </p>
      </PopoverContent>
    </Popover>
  );
}

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
  const draft = useMutation({ mutationFn: () => reservationApi.createDraft(id), onSuccess: result => { toast({ title: result.duplicate ? 'Mevcut taslak açıldı' : 'Operasyon taslağı oluşturuldu' }); navigate(`/operations/${result.operation.id}`); }, onError: error => toast({ title: 'Taslak oluşturulamadı', description: draftErrorDescription(error), variant: 'destructive' }) });
  const item = detail.data;
  if (detail.isLoading) return <AppShell title="Rezervasyon"><div className="space-y-4"><div className="h-24 bg-muted animate-pulse rounded-xl" /><div className="h-96 bg-muted animate-pulse rounded-xl" /></div></AppShell>;
  if (!item) return <AppShell title="Rezervasyon"><Card><CardContent className="py-12 text-center">Rezervasyon bulunamadı.</CardContent></Card></AppShell>;
  const extraction = item.extraction;
  const evidence: Record<string, string> = extraction?.evidence ?? {};
  // The extraction prompt does not constrain the evidence keys, so a quote may
  // arrive under a name that matches no input. Those cannot be anchored to a
  // field — list them in the summary panel rather than dropping them silently.
  const unanchoredEvidence = Object.entries(evidence).filter(
    ([key, quote]) => !(key in FIELD_LABELS) && typeof quote === 'string' && quote.trim(),
  );
  const anchoredEvidenceCount = Object.keys(FIELD_LABELS)
    .filter(key => typeof evidence[key] === 'string' && evidence[key].trim()).length;
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
            {FIELDS.map(([key, label, type]) => <div key={key} className="text-sm"><div className="flex items-center gap-1 mb-1"><label htmlFor={`field-${key}`} className="text-xs text-muted-foreground">{label}</label><EvidenceHint fieldLabel={label} quote={evidence[key]} /></div><Input id={`field-${key}`} type={type ?? 'text'} value={String(form[key] ?? '')} onChange={e => setForm(current => ({ ...current, [key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null) }))} /></div>)}
            <div className="text-sm flex gap-2 items-center md:col-span-2"><label className="flex gap-2 items-center"><input type="checkbox" checked={form.transferRequired === true} onChange={e => setForm(current => ({ ...current, transferRequired: e.target.checked }))} />Transfer gerekli</label><EvidenceHint fieldLabel="Transfer Gerekli" quote={evidence.transferRequired} /></div>
            <div className="text-sm md:col-span-2"><div className="flex items-center gap-1 mb-1"><label htmlFor="field-specialRequests" className="text-xs text-muted-foreground">Özel İstekler</label><EvidenceHint fieldLabel="Özel İstekler" quote={evidence.specialRequests} /></div><Textarea id="field-specialRequests" value={String(form.specialRequests ?? '')} onChange={e => setForm(current => ({ ...current, specialRequests: e.target.value || null }))} /></div>
            <div className="text-sm md:col-span-2"><div className="flex items-center gap-1 mb-1"><label htmlFor="field-internalNotes" className="text-xs text-muted-foreground">İç Notlar</label><EvidenceHint fieldLabel="İç Notlar" quote={evidence.internalNotes} /></div><Textarea id="field-internalNotes" value={String(form.internalNotes ?? '')} onChange={e => setForm(current => ({ ...current, internalNotes: e.target.value || null }))} /></div>
          </CardContent></Card>}
      </div>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle className="text-base">E-posta Özeti</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p><strong>Konu:</strong> {item.subject ?? '-'}</p><p><strong>Gönderen:</strong> {item.sender ?? '-'}</p><p><strong>Tarih:</strong> {item.receivedAt ? new Date(item.receivedAt).toLocaleString('tr-TR') : '-'}</p>{item.attachments?.length ? <p><strong>Ekler:</strong> {item.attachments.map(file => file.name).join(', ')}</p> : null}</CardContent></Card>
        {extraction && <Card><CardHeader><CardTitle className="text-base">AI Değerlendirmesi</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>{extraction.summaryTr}</p><p><strong>Eksik:</strong> {extraction.missingFields?.join(', ') || 'Yok'}</p><p><strong>Belirsiz:</strong> {extraction.uncertainFields?.join(', ') || 'Yok'}</p>
          {/* Without this the reviewer cannot tell an evidence-free extraction
              apart from a broken UI, since no quote icons would appear either way. */}
          <p><strong>Kaynak metni olan alan:</strong> {anchoredEvidenceCount || 'Yok'}</p>
          {unanchoredEvidence.length > 0 && <div><strong>Alana bağlanamayan kanıtlar:</strong><ul className="mt-1 space-y-1.5">{unanchoredEvidence.map(([key, quote]) => <li key={key} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{key}:</span> <span className="break-words">“{quote.trim()}”</span></li>)}</ul></div>}
        </CardContent></Card>}
        <Card><CardHeader><CardTitle className="text-base flex gap-2 items-center"><FileText className="w-4 h-4" />Orijinal İçerik</CardTitle></CardHeader><CardContent><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{item.plainTextBody ?? '(Düz metin içeriği yok)'}</pre></CardContent></Card>
      </div>
    </div>
    <AlertDialog open={confirmDraft} onOpenChange={setConfirmDraft}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Operasyon taslağı oluşturulsun mu?</AlertDialogTitle><AlertDialogDescription>Bu işlem onaylanmış alanları kullanarak müşteriyi güvenilir iletişim bilgileriyle eşleştirir veya oluşturur. Bu e-posta için yalnızca bir taslak operasyon oluşturulabilir.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>İptal</AlertDialogCancel><AlertDialogAction onClick={() => draft.mutate()} disabled={draft.isPending}>{draft.isPending ? 'Oluşturuluyor...' : 'Taslak Oluştur'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </AppShell>;
}
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationApi, createDraftError, type ReservationData } from '@/lib/reservation-api';
import {
  ReservationFieldsForm, FIELD_LABELS, normalizeReservationData,
} from '@/components/reservations/reservation-fields-form';
import { canRunAction } from '@/lib/reservation-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, RefreshCw, RotateCcw, Save, Sparkles, XCircle } from 'lucide-react';

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

export default function ReservationDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const client = useQueryClient();
  const [form, setForm] = useState<ReservationData>({});
  const [confirmDraft, setConfirmDraft] = useState(false);
  const detail = useQuery({ queryKey: ['reservation', id], queryFn: () => reservationApi.get(id), enabled: Boolean(id) });
  useEffect(() => { if (detail.data?.extraction) setForm(normalizeReservationData(detail.data.extraction.approvedData ?? detail.data.extraction.extractedData)); }, [detail.data]);
  const refresh = () => { client.invalidateQueries({ queryKey: ['reservation', id] }); client.invalidateQueries({ queryKey: ['reservations'] }); };
  const analyze = useMutation({ mutationFn: () => reservationApi.analyze(id), onSuccess: () => { toast({ title: 'AI analizi tamamlandı' }); refresh(); }, onError: error => toast({ title: 'Analiz başarısız', description: error.message, variant: 'destructive' }) });
  const save = useMutation({ mutationFn: () => reservationApi.review(id, form), onSuccess: () => { toast({ title: 'İnceleme kaydedildi' }); refresh(); }, onError: error => toast({ title: 'Kayıt başarısız', description: error.message, variant: 'destructive' }) });
  const reject = useMutation({ mutationFn: () => reservationApi.reject(id), onSuccess: () => { toast({ title: 'Rezervasyon reddedildi' }); refresh(); }, onError: () => toast({ title: 'İşlem başarısız', variant: 'destructive' }) });
  const draft = useMutation({ mutationFn: () => reservationApi.createDraft(id), onSuccess: result => { toast({ title: result.duplicate ? 'Mevcut taslak açıldı' : 'Operasyon taslağı oluşturuldu' }); navigate(`/operations/${result.operation.id}`); }, onError: error => toast({ title: 'Taslak oluşturulamadı', description: draftErrorDescription(error), variant: 'destructive' }) });
  const reopen = useMutation({ mutationFn: () => reservationApi.reopen(id), onSuccess: () => { toast({ title: 'Rezervasyon yeniden incelemeye alındı' }); refresh(); }, onError: error => toast({ title: 'Yeniden açılamadı', description: draftErrorDescription(error), variant: 'destructive' }) });
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
  // approvedData is nulled by every re-analysis; editedAt is not, so the pair
  // tells "never approved" apart from "approval invalidated by fresh AI output".
  const needsApproval = Boolean(extraction) && extraction?.approvedData == null && canRunAction('review', item.status);
  const approvalInvalidated = needsApproval && Boolean(extraction?.editedAt);
  return <AppShell title="Rezervasyon İncelemesi">
    <div className="flex flex-wrap justify-between gap-2 mb-5">
      <Link href="/reservations"><Button variant="ghost" className="gap-1"><ArrowLeft className="w-4 h-4" />Gelen Rezervasyonlar</Button></Link>
      {/* Actions follow the inbox state machine; the server enforces the same
          rules, this only keeps invalid actions out of reach. */}
      <div className="flex flex-wrap gap-2">
        {canRunAction('analyze', item.status) && (
          <Button variant="outline" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="gap-1"><RefreshCw className={`w-4 h-4 ${analyze.isPending ? 'animate-spin' : ''}`} />Yeniden Analiz Et</Button>
        )}
        {canRunAction('review', item.status) && extraction && (
          <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending} className="gap-1"><Save className="w-4 h-4" />Kaydet</Button>
        )}
        {canRunAction('reject', item.status) && (
          <Button variant="destructive" onClick={() => reject.mutate()} disabled={reject.isPending} className="gap-1"><XCircle className="w-4 h-4" />Reddet</Button>
        )}
        {canRunAction('create-draft', item.status) && extraction && (
          <Button onClick={() => setConfirmDraft(true)} className="gap-1"><CheckCircle2 className="w-4 h-4" />Taslak Oluştur</Button>
        )}
        {canRunAction('reopen', item.status) && (
          <Button variant="outline" onClick={() => reopen.mutate()} disabled={reopen.isPending} className="gap-1"><RotateCcw className="w-4 h-4" />Yeniden Aç</Button>
        )}
        {item.operationId && (
          <Button variant="outline" onClick={() => navigate(`/operations/${item.operationId}`)} className="gap-1"><FileText className="w-4 h-4" />Operasyonu Aç</Button>
        )}
      </div>
    </div>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-4">
        {!extraction ? <Card><CardContent className="py-12 text-center"><Sparkles className="w-8 h-8 mx-auto mb-3 text-primary" /><p className="mb-3">Bu kayıt henüz analiz edilmedi.</p><Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>{analyze.isPending ? 'Analiz Ediliyor...' : 'AI ile Analiz Et'}</Button></CardContent></Card> :
          <Card><CardHeader><CardTitle className="flex items-center justify-between text-base"><span>Çıkarılan Bilgiler</span>{extraction.confidenceScore !== null && <span className="text-xs text-muted-foreground">Güven: %{extraction.confidenceScore}</span>}</CardTitle></CardHeader><CardContent className="space-y-4">
            {/* A re-analysis clears approvedData, so a previously approved record
                silently loses its approval. Say so instead of letting the reviewer
                discover it as a 400 on "Taslak Oluştur". editedAt survives the
                reset and is what separates this from a never-approved record. */}
            {needsApproval && (
              <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2.5 flex gap-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 dark:text-amber-400" />
                <p className="text-sm text-amber-900 leading-relaxed dark:text-amber-200">
                  {approvalInvalidated
                    ? 'Yeni AI analizi yapıldı ve önceki onayınız geçersiz kılındı. Alanları inceleyip “Kaydet” ile tekrar onaylayın.'
                    : 'Bu veriler henüz onaylanmadı. Alanları inceleyip “Kaydet” ile onaylayın.'}
                  {' '}Onay olmadan operasyon taslağı oluşturulamaz.
                </p>
              </div>
            )}
            <ReservationFieldsForm value={form} onChange={setForm} evidence={evidence} disabled={!canRunAction('review', item.status)} />
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
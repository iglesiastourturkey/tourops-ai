import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { reservationApi, createDraftError, type DraftWarning, type ReservationData } from '@/lib/reservation-api';
import {
  ReservationFieldsForm, FIELD_LABELS, normalizeReservationData,
} from '@/components/reservations/reservation-fields-form';
import { canRunAction } from '@/lib/reservation-status';
import { OPERATION_STATUS_LABELS } from '@/lib/labels';
import { DestructiveConfirmDialog } from '@/components/destructive-confirm-dialog';
import { usePermission } from '@/hooks/usePermission';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, RefreshCw, RotateCcw, Save, Sparkles, Trash2, XCircle } from 'lucide-react';

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
  // Soft checks the server returned with 409. Present means the next attempt has
  // to carry the reviewer's acknowledgement.
  const [draftWarnings, setDraftWarnings] = useState<DraftWarning[]>([]);
  const detail = useQuery({ queryKey: ['reservation', id], queryFn: () => reservationApi.get(id), enabled: Boolean(id) });
  useEffect(() => { if (detail.data?.extraction) setForm(normalizeReservationData(detail.data.extraction.approvedData ?? detail.data.extraction.extractedData)); }, [detail.data]);
  const refresh = () => { client.invalidateQueries({ queryKey: ['reservation', id] }); client.invalidateQueries({ queryKey: ['reservations'] }); };
  const analyze = useMutation({ mutationFn: () => reservationApi.analyze(id), onSuccess: () => { toast({ title: 'AI analizi tamamlandı' }); refresh(); }, onError: error => toast({ title: 'Analiz başarısız', description: error.message, variant: 'destructive' }) });
  const save = useMutation({ mutationFn: () => reservationApi.review(id, form), onSuccess: () => { toast({ title: 'İnceleme kaydedildi' }); refresh(); }, onError: error => toast({ title: 'Kayıt başarısız', description: error.message, variant: 'destructive' }) });
  const reject = useMutation({ mutationFn: () => reservationApi.reject(id), onSuccess: () => { toast({ title: 'Rezervasyon reddedildi' }); refresh(); }, onError: () => toast({ title: 'İşlem başarısız', variant: 'destructive' }) });
  const draft = useMutation({
    mutationFn: (acknowledgedWarnings: DraftWarning['code'][]) => reservationApi.createDraft(id, acknowledgedWarnings),
    onSuccess: result => { setDraftWarnings([]); toast({ title: result.duplicate ? 'Mevcut taslak açıldı' : 'Operasyon taslağı oluşturuldu' }); navigate(`/operations/${result.operation.id}`); },
    onError: error => {
      const body = createDraftError(error);
      // Soft checks: nothing was created. Re-open the dialog with the warnings
      // so the reviewer decides, instead of burying them in a toast.
      if (body?.code === 'draft_confirmation_required' && body.warnings?.length) {
        setDraftWarnings(body.warnings);
        setConfirmDraft(true);
        return;
      }
      setDraftWarnings([]);
      toast({ title: 'Taslak oluşturulamadı', description: draftErrorDescription(error), variant: 'destructive' });
    },
  });
  const canDelete = usePermission('reservations', 'delete');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => reservationApi.remove(id),
    onSuccess: () => { toast({ title: 'Rezervasyon silindi' }); client.invalidateQueries({ queryKey: ['reservations'] }); navigate('/reservations'); },
    onError: error => { setConfirmDelete(false); toast({ title: 'Silinemedi', description: draftErrorDescription(error), variant: 'destructive' }); },
  });
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
        {canDelete && !item.operationId && (
          <Button variant="outline" onClick={() => setConfirmDelete(true)} className="gap-1 text-destructive hover:text-destructive" data-testid="button-delete-reservation"><Trash2 className="w-4 h-4" />Sil</Button>
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
    <DestructiveConfirmDialog
      open={confirmDelete}
      onOpenChange={open => { if (!remove.isPending) setConfirmDelete(open); }}
      title="Rezervasyon kalıcı olarak silinsin mi?"
      description={<><strong>{item.subject ?? '(Konu yok)'}</strong> kaydı ve AI analiz sonucu veritabanından tamamen kaldırılacak. Bu işlem geri alınamaz.</>}
      consequences={[
        'Rezervasyon kaydı, çıkarılan ve onaylanan alanlar birlikte silinir.',
        'Gmail’den gelen bir kayıtsa, aynı e-posta yeniden taramada tekrar içe aktarılabilir.',
        'İşlem denetim kaydına (audit log) yazılır.',
      ]}
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
    />

    {/* Cancelling drops the warnings: the next attempt re-runs the checks
        server-side, so a stale acknowledgement can never be carried forward. */}
    <AlertDialog open={confirmDraft} onOpenChange={open => { setConfirmDraft(open); if (!open) setDraftWarnings([]); }}>
      <AlertDialogContent className="max-h-[80vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{draftWarnings.length ? 'Devam etmeden önce kontrol edin' : 'Operasyon taslağı oluşturulsun mu?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {draftWarnings.length
              ? 'Aşağıdaki uyarılar taslak oluşturmayı engellemiyor, ancak devam etmeden önce onaylamanız gerekiyor. Henüz hiçbir kayıt oluşturulmadı.'
              : 'Bu işlem onaylanmış alanları kullanarak müşteriyi güvenilir iletişim bilgileriyle eşleştirir veya oluşturur. Bu e-posta için yalnızca bir taslak operasyon oluşturulabilir.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {draftWarnings.length > 0 && (
          <ul className="space-y-2">
            {draftWarnings.map(warning => (
              <li key={warning.code} className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2.5 flex gap-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 dark:text-amber-400" />
                <div className="text-sm text-amber-900 leading-relaxed dark:text-amber-200 min-w-0">
                  <p>{warning.message}</p>
                  {/* "There is a duplicate" is not actionable on its own — the
                      reviewer has to see which operation, from when, in what
                      state. Opened in a new tab so the review in progress and
                      its acknowledgement are not lost. */}
                  {warning.detail?.operations?.length ? (
                    <ul className="mt-1.5 space-y-1">
                      {warning.detail.operations.map(operation => (
                        <li key={operation.id}>
                          <a href={`/operations/${operation.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-words">
                            #{operation.id}
                          </a>
                          <span className="text-xs"> · {OPERATION_STATUS_LABELS[operation.status] ?? operation.status}
                            {operation.startDate ? ` · ${new Date(operation.startDate).toLocaleDateString('tr-TR')}` : ''}
                            {operation.sameSource ? '' : ' · farklı kaynak'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>İptal</AlertDialogCancel>
          {/* Only the codes on screen are acknowledged — the server rejects the
              request again if it finds a warning that is not among them. */}
          <AlertDialogAction onClick={() => draft.mutate(draftWarnings.map(warning => warning.code))} disabled={draft.isPending}>
            {draft.isPending ? 'Oluşturuluyor...' : draftWarnings.length ? 'Yine de Oluştur' : 'Taslak Oluştur'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>;
}
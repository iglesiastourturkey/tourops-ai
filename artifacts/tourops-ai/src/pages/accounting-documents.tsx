import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import {
  CheckCircle, XCircle, AlertCircle, FileText, Camera, CameraOff,
  RefreshCw, AlertTriangle, Plus, ExternalLink, Search,
} from 'lucide-react';
import { useAuth } from '@clerk/react';

import { API_BASE } from '@/lib/api-base';

const BASE = import.meta.env.BASE_URL ?? '/';

interface Receipt {
  id: number; _source: string; operationId: number;
  amount: number; currency: string; supplierName?: string;
  date?: string; guideNote?: string; photoObjectPath?: string;
  reviewStatus: string; reviewNotes?: string; createdAt: string;
  tourName?: string; guideName?: string;
  ocrStatus?: string; linkedTransactionId?: number | null;
}
interface ADocument {
  id: number; _source: string; operationId?: number;
  documentType: string; objectPath: string; originalFileName: string;
  reviewStatus: string; notes?: string;
  ocrStatus?: string; transactionId?: number | null; createdAt: string;
}

const REVIEW_LABELS: Record<string, string> = {
  pending_review: 'İnceleme Bekliyor', pending: 'İnceleme Bekliyor',
  approved: 'Onaylandı', rejected: 'Reddedildi', missing_information: 'Eksik Bilgi',
};
const REVIEW_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800', pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  missing_information: 'bg-orange-100 text-orange-800',
};
const OCR_STATUS_LABELS: Record<string, string> = {
  not_started: 'OCR Yok', processed: 'OCR ✓', failed: 'OCR Hata',
};
const OCR_STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  processed: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
};
const DOC_TYPE_LABELS: Record<string, string> = {
  receipt: 'Makbuz', invoice: 'Fatura', expense_note: 'Harcama Notu', other: 'Diğer',
};

type ReviewAction = 'approved' | 'rejected' | 'missing_information';
type ReviewTarget = { type: 'receipt' | 'document'; id: number };

const ACTION_LABELS: Record<ReviewAction, string> = {
  approved: 'Onayla', rejected: 'Reddet', missing_information: 'Eksik Bilgi İşaretle',
};
const ACTION_DESCRIPTIONS: Record<ReviewAction, string> = {
  approved: 'Bu belge onaylanacak ve muhasebe kaydı oluşturulmaya hazır hale gelecektir. İşlemi onaylamak istiyor musunuz?',
  rejected: 'Bu belge reddedilecektir. Red gerekçesi zorunludur.',
  missing_information: 'Bu belge eksik bilgi olarak işaretlenecektir. Not giriniz (zorunlu).',
};
const ACTION_VARIANTS: Record<ReviewAction, 'default' | 'destructive'> = {
  approved: 'default', rejected: 'destructive', missing_information: 'default',
};
const ACTION_CLASSES: Record<ReviewAction, string> = {
  approved: 'bg-emerald-600 hover:bg-emerald-700 text-white',
  rejected: '',
  missing_information: 'bg-orange-500 hover:bg-orange-600 text-white',
};

export default function AccountingDocumentsPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'documents'],
    queryFn: () => customFetch<{ receipts: Receipt[]; documents: ADocument[] }>(`${API_BASE}/accounting/documents`),
  });

  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewAction, setReviewAction] = useState<ReviewAction>('approved');
  const [reviewNotes, setReviewNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [creatingTx, setCreatingTx] = useState<number | null>(null);
  const [createTxTarget, setCreateTxTarget] = useState<Receipt | null>(null);

  async function authFetch(url: string, opts: RequestInit = {}) {
    const token = await getToken();
    const resp = await fetch(url, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Hata' }));
      throw new Error(err.error ?? 'İşlem başarısız');
    }
    return resp.json();
  }

  function openReview(type: 'receipt' | 'document', id: number, action: ReviewAction, e: React.MouseEvent) {
    e.stopPropagation();
    setReviewTarget({ type, id });
    setReviewAction(action);
    setReviewNotes('');
  }

  async function handleReview() {
    if (!reviewTarget) return;
    setActionLoading(true);
    try {
      const endpoint = reviewTarget.type === 'receipt'
        ? `${API_BASE}/accounting/receipts/${reviewTarget.id}/review`
        : `${API_BASE}/accounting/documents/${reviewTarget.id}/review`;
      await authFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action: reviewAction, notes: reviewNotes }),
      });
      toast({ title: ACTION_LABELS[reviewAction] + ' başarılı' });
      setReviewTarget(null);
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'dashboard'] });
    } catch (e: unknown) {
      toast({ title: 'İnceleme başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setActionLoading(false); }
  }

  async function handleCreateTransaction(receipt: Receipt) {
    setCreatingTx(receipt.id);
    try {
      await authFetch(`${API_BASE}/accounting/receipts/${receipt.id}/create-transaction`, { method: 'POST' });
      toast({ title: 'Gider işlemi oluşturuldu' });
      setCreateTxTarget(null);
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem oluşturulamadı', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setCreatingTx(null); }
  }

  const receipts = data?.receipts ?? [];
  const documents = data?.documents ?? [];
  const pendingCount =
    receipts.filter(r => r.reviewStatus === 'pending_review').length +
    documents.filter(d => d.reviewStatus === 'pending').length;

  const noteRequired = reviewAction === 'rejected' || reviewAction === 'missing_information';

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#1e3a5f]">Belge İnceleme Kuyruğu</h1>
            {pendingCount > 0 && (
              <p className="text-sm text-amber-600 mt-0.5">{pendingCount} belge inceleme bekliyor</p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Yenile
          </Button>
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Belgeler yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">Yeniden Dene</Button>
          </div>
        )}

        <Tabs defaultValue="receipts">
          <TabsList>
            <TabsTrigger value="receipts">
              Makbuzlar{receipts.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] h-4">{receipts.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Belgeler{documents.length > 0 && <Badge variant="secondary" className="ml-1.5 text-[10px] h-4">{documents.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Receipts tab ──────────────────────────────────────────────── */}
          <TabsContent value="receipts" className="mt-4">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1e3a5f]/5 border-b">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium w-16">Görsel</th>
                      <th className="px-4 py-3 font-medium">Tarih</th>
                      <th className="px-4 py-3 font-medium">Tedarikçi</th>
                      <th className="px-4 py-3 font-medium">Tur / Rehber</th>
                      <th className="px-4 py-3 font-medium text-right">Tutar</th>
                      <th className="px-4 py-3 font-medium">OCR</th>
                      <th className="px-4 py-3 font-medium">İşlem</th>
                      <th className="px-4 py-3 font-medium">Durum</th>
                      <th className="px-4 py-3 font-medium">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}><td colSpan={9} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                    )) : receipts.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">Makbuz bulunamadı</td></tr>
                    ) : receipts.map(r => (
                      <tr key={r.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => { window.location.href = `${BASE.replace(/\/$/, '')}/accounting/documents/receipt/${r.id}`; }}>
                        {/* Thumbnail */}
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="w-10 h-10 rounded border bg-gray-50 flex items-center justify-center shrink-0">
                                {r.photoObjectPath
                                  ? <Camera className="h-5 w-5 text-emerald-500" />
                                  : <CameraOff className="h-4 w-4 text-gray-400" />}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>{r.photoObjectPath ? 'Fotoğraf var — detayda görüntüle' : 'Fotoğraf yok'}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.date ?? '—'}</td>
                        <td className="px-4 py-3 text-xs">{r.supplierName ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div>{r.tourName ?? `Op. #${r.operationId}`}</div>
                          {r.guideName && <div className="text-[10px]">{r.guideName}</div>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-sm whitespace-nowrap">
                          {formatCurrency(r.amount, r.currency)}
                        </td>
                        {/* OCR status */}
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${OCR_STATUS_COLORS[r.ocrStatus ?? 'not_started'] ?? 'bg-gray-100'}`}>
                                {OCR_STATUS_LABELS[r.ocrStatus ?? 'not_started'] ?? r.ocrStatus}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>OCR (Optik Karakter Tanıma) Durumu</TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Linked transaction */}
                        <td className="px-4 py-3">
                          {r.linkedTransactionId
                            ? <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">İşlem #{r.linkedTransactionId}</span>
                            : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${REVIEW_COLORS[r.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}>
                            {REVIEW_LABELS[r.reviewStatus] ?? r.reviewStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link href={`/accounting/documents/receipt/${r.id}`}>
                                  <Button size="sm" variant="outline"
                                    className="h-7 px-2 text-xs text-[#0d7377] border-[#0d7377]/30 hover:bg-[#0d7377]/5"
                                    aria-label="Makbuz detayını aç">
                                    <Search className="h-3 w-3 mr-1" />İncele
                                  </Button>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>Detay sayfasını aç</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  className="h-7 px-2 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                  onClick={e => openReview('receipt', r.id, 'approved', e)}
                                  aria-label="Makbuzu onayla">
                                  <CheckCircle className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Onayla</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  className="h-7 px-2 text-xs text-red-700 border-red-200 hover:bg-red-50"
                                  onClick={e => openReview('receipt', r.id, 'rejected', e)}
                                  aria-label="Makbuzu reddet">
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reddet</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  className="h-7 px-2 text-xs text-orange-700 border-orange-200 hover:bg-orange-50"
                                  onClick={e => openReview('receipt', r.id, 'missing_information', e)}
                                  aria-label="Eksik bilgi olarak işaretle">
                                  <AlertCircle className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Eksik Bilgi</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  className="h-7 px-2 text-xs text-[#0d7377] border-[#0d7377]/30 hover:bg-[#0d7377]/5"
                                  disabled={creatingTx === r.id || !!r.linkedTransactionId}
                                  onClick={e => { e.stopPropagation(); setCreateTxTarget(r); }}
                                  aria-label="Gider işlemi oluştur">
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{r.linkedTransactionId ? 'Zaten bağlı işlem var' : 'Gider işlemi oluştur'}</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          {/* ── Documents tab ─────────────────────────────────────────────── */}
          <TabsContent value="documents" className="mt-4">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1e3a5f]/5 border-b">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Dosya</th>
                      <th className="px-4 py-3 font-medium">Tür</th>
                      <th className="px-4 py-3 font-medium">OCR</th>
                      <th className="px-4 py-3 font-medium">İşlem</th>
                      <th className="px-4 py-3 font-medium">Notlar</th>
                      <th className="px-4 py-3 font-medium">Durum</th>
                      <th className="px-4 py-3 font-medium">İşlemler</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                    )) : documents.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Belge bulunamadı</td></tr>
                    ) : documents.map(doc => (
                      <tr key={doc.id}
                        className="hover:bg-muted/30 cursor-pointer transition-colors"
                        onClick={() => { window.location.href = `${BASE.replace(/\/$/, '')}/accounting/documents/document/${doc.id}`; }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-xs truncate max-w-[180px]">{doc.originalFileName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {DOC_TYPE_LABELS[doc.documentType] ?? doc.documentType}
                        </td>
                        {/* OCR status */}
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${OCR_STATUS_COLORS[doc.ocrStatus ?? 'not_started'] ?? 'bg-gray-100'}`}>
                                {OCR_STATUS_LABELS[doc.ocrStatus ?? 'not_started'] ?? doc.ocrStatus}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>OCR Durumu</TooltipContent>
                          </Tooltip>
                        </td>
                        {/* Linked transaction */}
                        <td className="px-4 py-3">
                          {doc.transactionId
                            ? <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">İşlem #{doc.transactionId}</span>
                            : <span className="text-[10px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{doc.notes ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${REVIEW_COLORS[doc.reviewStatus] ?? 'bg-gray-100'}`}>
                            {REVIEW_LABELS[doc.reviewStatus] ?? doc.reviewStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link href={`/accounting/documents/document/${doc.id}`}>
                                  <Button size="sm" variant="outline"
                                    className="h-7 px-2 text-xs text-[#0d7377] border-[#0d7377]/30 hover:bg-[#0d7377]/5"
                                    aria-label="Belge detayını aç">
                                    <Search className="h-3 w-3 mr-1" />İncele
                                  </Button>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>Detay sayfasını aç</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  className="h-7 px-2 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                                  onClick={e => openReview('document', doc.id, 'approved', e)}
                                  aria-label="Belgeyi onayla">
                                  <CheckCircle className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Onayla</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="outline"
                                  className="h-7 px-2 text-xs text-red-700 border-red-200 hover:bg-red-50"
                                  onClick={e => openReview('document', doc.id, 'rejected', e)}
                                  aria-label="Belgeyi reddet">
                                  <XCircle className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reddet</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        </Tabs>

        {/* ── Review dialog ─────────────────────────────────────────────── */}
        <Dialog open={reviewTarget !== null} onOpenChange={open => { if (!open) setReviewTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {reviewAction === 'approved' ? 'Belgeyi Onayla' :
                 reviewAction === 'rejected' ? 'Belgeyi Reddet' : 'Eksik Bilgi İşaretle'}
              </DialogTitle>
              <DialogDescription>{ACTION_DESCRIPTIONS[reviewAction]}</DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-xs">
                {reviewAction === 'approved' ? 'Not (isteğe bağlı)' : 'Gerekçe / Not *'}
              </Label>
              <Textarea
                rows={3}
                placeholder={reviewAction === 'approved' ? 'Onay notu…' : 'Açıklama giriniz…'}
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewTarget(null)}>İptal</Button>
              <Button
                variant={ACTION_VARIANTS[reviewAction]}
                className={ACTION_CLASSES[reviewAction]}
                onClick={handleReview}
                disabled={actionLoading || (noteRequired && !reviewNotes.trim())}>
                {actionLoading ? 'Kaydediliyor…' : ACTION_LABELS[reviewAction]}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Create transaction dialog ─────────────────────────────────── */}
        <Dialog open={createTxTarget !== null} onOpenChange={open => { if (!open) setCreateTxTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Gider İşlemi Oluştur</DialogTitle>
              <DialogDescription>
                Bu makbuza dayanarak bir gider işlemi oluşturulacaktır.
                {createTxTarget && (
                  <span className="block mt-1 font-medium">
                    Tutar: {formatCurrency(createTxTarget.amount, createTxTarget.currency)}
                    {createTxTarget.supplierName ? ` — ${createTxTarget.supplierName}` : ''}
                  </span>
                )}
                <br />Devam etmek istiyor musunuz?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateTxTarget(null)}>İptal</Button>
              <Button
                className="bg-[#0d7377] hover:bg-[#0a5e62] text-white"
                disabled={creatingTx !== null}
                onClick={() => createTxTarget && handleCreateTransaction(createTxTarget)}>
                {creatingTx !== null ? 'Oluşturuluyor…' : 'İşleme Dönüştür'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

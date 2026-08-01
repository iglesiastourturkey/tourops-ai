import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import { CheckCircle, XCircle, AlertCircle, FileText, Camera, CameraOff, RefreshCw, AlertTriangle, Plus } from 'lucide-react';
import { useAuth } from '@clerk/react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

interface Receipt {
  id: number; _source: string; operationId: number;
  amount: number; currency: string; supplierName?: string;
  date?: string; guideNote?: string; photoObjectPath?: string;
  reviewStatus: string; reviewNotes?: string; createdAt: string;
  tourName?: string; guideName?: string;
}
interface ADocument {
  id: number; _source: string; operationId?: number;
  documentType: string; objectPath: string; originalFileName: string;
  reviewStatus: string; notes?: string; transactionId?: number; createdAt: string;
}

const REVIEW_LABELS: Record<string, string> = {
  pending_review: 'Bekliyor', pending: 'Bekliyor', approved: 'Onaylandı',
  rejected: 'Reddedildi', missing_information: 'Eksik Bilgi',
};
const REVIEW_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800', pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800', rejected: 'bg-red-100 text-red-800',
  missing_information: 'bg-orange-100 text-orange-800',
};

type ReviewAction = 'approved' | 'rejected' | 'missing_information';
type ReviewTarget = { type: 'receipt' | 'document'; id: number };

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

  function openReview(type: 'receipt' | 'document', id: number, action: ReviewAction) {
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
      const actionLabel = reviewAction === 'approved' ? 'Onaylandı' : reviewAction === 'rejected' ? 'Reddedildi' : 'Eksik bilgi işaretlendi';
      toast({ title: actionLabel });
      setReviewTarget(null);
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'dashboard'] });
    } catch (e: unknown) {
      toast({ title: 'İnceleme başarısız', description: (e instanceof Error ? e.message : ''), variant: 'destructive' });
    } finally { setActionLoading(false); }
  }

  async function handleCreateTransaction(receiptId: number) {
    setCreatingTx(receiptId);
    try {
      await authFetch(`${API_BASE}/accounting/receipts/${receiptId}/create-transaction`, { method: 'POST' });
      toast({ title: 'Gider işlemi oluşturuldu' });
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem oluşturulamadı', description: (e instanceof Error ? e.message : ''), variant: 'destructive' });
    } finally { setCreatingTx(null); }
  }

  const receipts = data?.receipts ?? [];
  const documents = data?.documents ?? [];
  const pendingCount = receipts.filter(r => r.reviewStatus === 'pending_review').length + documents.filter(d => d.reviewStatus === 'pending').length;

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

          <TabsContent value="receipts" className="mt-4">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1e3a5f]/5 border-b">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Tarih</th>
                      <th className="px-4 py-3 font-medium">Tedarikçi</th>
                      <th className="px-4 py-3 font-medium">Tur / Rehber</th>
                      <th className="px-4 py-3 font-medium text-right">Tutar</th>
                      <th className="px-4 py-3 font-medium">Fotoğraf</th>
                      <th className="px-4 py-3 font-medium">Durum</th>
                      <th className="px-4 py-3 font-medium">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                    )) : receipts.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">Makbuz bulunamadı</td></tr>
                    ) : receipts.map(r => (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{r.date ?? '—'}</td>
                        <td className="px-4 py-3 text-xs">{r.supplierName ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div>{r.tourName ?? `Op. #${r.operationId}`}</div>
                          {r.guideName && <div className="text-[10px]">{r.guideName}</div>}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-sm whitespace-nowrap">
                          {formatCurrency(r.amount, r.currency)}
                        </td>
                        <td className="px-4 py-3">
                          {r.photoObjectPath
                            ? <Camera className="h-4 w-4 text-emerald-500" />
                            : <CameraOff className="h-4 w-4 text-red-400" />}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${REVIEW_COLORS[r.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}>
                            {REVIEW_LABELS[r.reviewStatus] ?? r.reviewStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-emerald-600"
                              onClick={() => openReview('receipt', r.id, 'approved')}>
                              <CheckCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-red-600"
                              onClick={() => openReview('receipt', r.id, 'rejected')}>
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-orange-500"
                              onClick={() => openReview('receipt', r.id, 'missing_information')}>
                              <AlertCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-[#0d7377]"
                              disabled={creatingTx === r.id} onClick={() => handleCreateTransaction(r.id)}>
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="documents" className="mt-4">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1e3a5f]/5 border-b">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Dosya</th>
                      <th className="px-4 py-3 font-medium">Tür</th>
                      <th className="px-4 py-3 font-medium">Notlar</th>
                      <th className="px-4 py-3 font-medium">Durum</th>
                      <th className="px-4 py-3 font-medium">İşlem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {isLoading ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}><td colSpan={5} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                    )) : documents.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">Belge bulunamadı</td></tr>
                    ) : documents.map(doc => (
                      <tr key={doc.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-xs truncate max-w-[200px]">{doc.originalFileName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">{doc.documentType}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{doc.notes ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${REVIEW_COLORS[doc.reviewStatus] ?? 'bg-gray-100'}`}>
                            {REVIEW_LABELS[doc.reviewStatus] ?? doc.reviewStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-emerald-600"
                              onClick={() => openReview('document', doc.id, 'approved')}>
                              <CheckCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-1.5 text-red-600"
                              onClick={() => openReview('document', doc.id, 'rejected')}>
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
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

        {/* Review dialog */}
        <Dialog open={reviewTarget !== null} onOpenChange={open => { if (!open) setReviewTarget(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                {reviewAction === 'approved' ? 'Belgeyi Onayla' :
                 reviewAction === 'rejected' ? 'Belgeyi Reddet' : 'Eksik Bilgi İşaretle'}
              </DialogTitle>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-xs">
                {reviewAction === 'approved' ? 'Not (isteğe bağlı)' : 'Gerekçe *'}
              </Label>
              <Textarea rows={3} placeholder={reviewAction === 'approved' ? 'Onay notu...' : 'Açıklama...'} value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewTarget(null)}>İptal</Button>
              <Button
                variant={reviewAction === 'rejected' ? 'destructive' : 'default'}
                className={reviewAction === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : reviewAction === 'missing_information' ? 'bg-orange-500 hover:bg-orange-600' : ''}
                onClick={handleReview}
                disabled={actionLoading || (reviewAction === 'rejected' && !reviewNotes)}>
                {actionLoading ? 'Kaydediliyor…' :
                  reviewAction === 'approved' ? 'Onayla' :
                  reviewAction === 'rejected' ? 'Reddet' : 'İşaretle'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

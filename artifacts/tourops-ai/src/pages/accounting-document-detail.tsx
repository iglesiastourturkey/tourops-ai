import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import {
  ChevronLeft, ZoomIn, ZoomOut, RotateCw, Maximize2, Download, Printer,
  CheckCircle, XCircle, AlertCircle, Plus, Save, AlertTriangle,
  RefreshCw, FileText, Camera, CameraOff, Info, Building2, Calendar,
  User, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

import { API_BASE } from '@/lib/api-base';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CorrectedFields {
  supplierName?: string;
  receiptDate?: string;
  documentDate?: string;
  documentTime?: string;
  documentType?: string;
  amount?: number | string;
  currency?: string;
  taxRate?: number | string;
  taxAmount?: number | string;
  netAmount?: number | string;
  paymentMethod?: string;
  category?: string;
  documentNumber?: string;
  notes?: string;
}

interface DetailData {
  type: 'receipt' | 'document';
  id: number;
  // receipt fields
  amount?: number;
  currency?: string;
  supplierName?: string;
  receiptDate?: string;
  guideNote?: string;
  photoObjectPath?: string;
  // document fields
  documentType?: string;
  originalFileName?: string;
  mimeType?: string;
  fileSize?: number;
  notes?: string;
  transactionId?: number;
  // shared
  ocrStatus: string;
  reviewStatus: string;
  reviewNotes?: string;
  reviewedAt?: string;
  reviewerName?: string;
  correctedFields?: string;
  operationId?: number;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  creatorName?: string;
  // joined
  tourName?: string;
  customerName?: string;
  guideName?: string;
  driverName?: string;
  startDate?: string;
  endDate?: string;
  linkedTransaction?: { id: number; accountingStatus: string; paymentStatus: string } | null;
  operationExpenses?: number;
}

// ── Label maps ────────────────────────────────────────────────────────────────

const OCR_STATUS_LABELS: Record<string, string> = {
  not_started: 'OCR Yapılmadı', processed: 'OCR Tamamlandı', failed: 'OCR Başarısız',
};
const OCR_STATUS_COLORS: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-700',
  processed: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
};
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
const DOC_TYPE_LABELS: Record<string, string> = {
  receipt: 'Makbuz', invoice: 'Fatura', expense_note: 'Harcama Notu', other: 'Diğer',
};
const ACCT_STATUS_LABELS: Record<string, string> = {
  pending_review: 'İnceleme Bekliyor', approved: 'Onaylandı',
  rejected: 'Reddedildi', missing_information: 'Eksik Bilgi',
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor', paid: 'Ödendi', partially_paid: 'Kısmi Ödendi', cancelled: 'İptal',
};
const CATEGORIES = [
  { value: 'supplier', label: 'Tedarikçi' },
  { value: 'guide', label: 'Rehber' },
  { value: 'driver', label: 'Sürücü' },
  { value: 'hotel', label: 'Otel' },
  { value: 'restaurant', label: 'Restoran' },
  { value: 'entrance_ticket', label: 'Giriş Bileti' },
  { value: 'fuel', label: 'Yakıt' },
  { value: 'parking', label: 'Otopark' },
  { value: 'commission', label: 'Komisyon' },
  { value: 'tax', label: 'Vergi' },
  { value: 'office', label: 'Ofis' },
  { value: 'other', label: 'Diğer' },
];
const PAYMENT_METHODS = ['Nakit', 'Kredi Kartı', 'Havale/EFT', 'Çek', 'Döviz'];
const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildInitialEdit(detail: DetailData): CorrectedFields {
  const cf: CorrectedFields = detail.correctedFields ? JSON.parse(detail.correctedFields) : {};
  if (detail.type === 'receipt') {
    return {
      supplierName: cf.supplierName ?? detail.supplierName ?? '',
      receiptDate: cf.receiptDate ?? detail.receiptDate ?? '',
      amount: cf.amount ?? detail.amount ?? '',
      currency: cf.currency ?? detail.currency ?? 'TRY',
      taxRate: cf.taxRate ?? '',
      taxAmount: cf.taxAmount ?? '',
      netAmount: cf.netAmount ?? '',
      paymentMethod: cf.paymentMethod ?? '',
      category: cf.category ?? '',
      documentNumber: cf.documentNumber ?? '',
    };
  }
  return {
    documentType: cf.documentType ?? detail.documentType ?? 'receipt',
    supplierName: cf.supplierName ?? '',
    documentDate: cf.documentDate ?? '',
    documentTime: cf.documentTime ?? '',
    amount: cf.amount ?? '',
    currency: cf.currency ?? 'TRY',
    taxRate: cf.taxRate ?? '',
    taxAmount: cf.taxAmount ?? '',
    netAmount: cf.netAmount ?? '',
    paymentMethod: cf.paymentMethod ?? '',
    category: cf.category ?? '',
    documentNumber: cf.documentNumber ?? '',
    notes: cf.notes ?? detail.notes ?? '',
  };
}

function FieldOriginBadge({ fieldKey, cf, originalVal }: {
  fieldKey: keyof CorrectedFields;
  cf: CorrectedFields;
  originalVal: string | number | null | undefined;
}) {
  const hasOverride = cf[fieldKey] !== undefined && String(cf[fieldKey]) !== '';
  const hasOriginal = originalVal !== null && originalVal !== undefined && originalVal !== '';
  if (hasOverride && hasOriginal && String(cf[fieldKey]) !== String(originalVal)) {
    return <span className="ml-1.5 text-[9px] bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium">✏ Düzeltildi</span>;
  }
  if (!hasOverride && !hasOriginal) {
    return <span className="ml-1.5 text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">Eksik</span>;
  }
  if (!hasOverride && hasOriginal) {
    return <span className="ml-1.5 text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">OCR/Orijinal</span>;
  }
  return null;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AccountingDocumentDetailPage() {
  const { type, id: idStr } = useParams<{ type: string; id: string }>();
  const id = parseInt(idStr ?? '0');
  const { getToken } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  // Image viewer state
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(true);
  const [fileError, setFileError] = useState(false);
  const [fileErrorMsg, setFileErrorMsg] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editState, setEditState] = useState<CorrectedFields>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Action dialog state
  type ReviewAction = 'approved' | 'rejected' | 'missing_information';
  const [actionDialog, setActionDialog] = useState<{ open: boolean; action: ReviewAction }>({ open: false, action: 'approved' });
  const [actionNotes, setActionNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [creatingTx, setCreatingTx] = useState(false);
  const [createTxDialog, setCreateTxDialog] = useState(false);

  // Fetch detail data
  const { data: detail, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'document-detail', type, id],
    queryFn: () => customFetch<DetailData>(`${API_BASE}/accounting/documents/${type}/${id}`),
    enabled: !!type && !!id && ['receipt', 'document'].includes(type),
  });

  // Init edit state when detail loads
  useEffect(() => {
    if (detail && !dirty) {
      setEditState(buildInitialEdit(detail));
    }
  }, [detail, dirty]);

  // Load file blob
  useEffect(() => {
    if (!detail) return;
    const hasFile = detail.type === 'receipt' ? !!detail.photoObjectPath : !!detail.id;
    if (!hasFile && detail.type === 'receipt') {
      setFileLoading(false);
      setFileError(true);
      setFileErrorMsg('Bu makbuzda fotoğraf bulunmamaktadır.');
      return;
    }
    let url: string | null = null;
    setFileLoading(true);
    setFileError(false);
    (async () => {
      try {
        const token = await getToken();
        const resp = await fetch(`${API_BASE}/accounting/documents/${type}/${id}/file`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: '' }));
          throw new Error(err.error || 'Dosya yüklenemedi');
        }
        const blob = await resp.blob();
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch (e: unknown) {
        setFileError(true);
        setFileErrorMsg(e instanceof Error ? e.message : 'Dosya yüklenemedi');
      } finally {
        setFileLoading(false);
      }
    })();
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [detail?.id, type, id]);

  async function authFetch(url: string, opts: RequestInit = {}) {
    const token = await getToken();
    const resp = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Hata' }));
      throw new Error(err.error ?? 'İşlem başarısız');
    }
    return resp.json();
  }

  function setField(key: keyof CorrectedFields, value: string) {
    setEditState(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { correctedFields: editState };
      if (detail?.type === 'document' && editState.notes !== undefined) {
        body.notes = editState.notes;
      }
      await authFetch(`${API_BASE}/accounting/documents/${type}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      toast({ title: 'Düzenlemeler kaydedildi' });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['accounting', 'document-detail', type, id] });
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
    } catch (e: unknown) {
      toast({ title: 'Kaydetme başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function handleAction() {
    if (!detail) return;
    const { action } = actionDialog;
    setActionLoading(true);
    try {
      const endpoint = detail.type === 'receipt'
        ? `${API_BASE}/accounting/receipts/${id}/review`
        : `${API_BASE}/accounting/documents/${id}/review`;
      await authFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action, notes: actionNotes }),
      });
      toast({ title: ACTION_LABELS[action] + ' başarılı' });
      setActionDialog({ open: false, action: 'approved' });
      setActionNotes('');
      qc.invalidateQueries({ queryKey: ['accounting', 'document-detail', type, id] });
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'dashboard'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setActionLoading(false); }
  }

  async function handleCreateTransaction() {
    setCreatingTx(true);
    try {
      await authFetch(`${API_BASE}/accounting/receipts/${id}/create-transaction`, { method: 'POST' });
      toast({ title: 'Gider işlemi oluşturuldu' });
      setCreateTxDialog(false);
      qc.invalidateQueries({ queryKey: ['accounting', 'document-detail', type, id] });
      qc.invalidateQueries({ queryKey: ['accounting', 'documents'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem oluşturulamadı', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setCreatingTx(false); }
  }

  function handleDownload() {
    if (!blobUrl) return;
    const a = document.createElement('a');
    const fileName = detail?.type === 'receipt'
      ? `makbuz-${id}.jpg`
      : (detail?.originalFileName ?? `belge-${id}`);
    a.href = blobUrl;
    a.download = fileName;
    a.click();
  }

  function handlePrint() {
    if (!blobUrl) return;
    const w = window.open(blobUrl, '_blank');
    w?.addEventListener('load', () => w.print());
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      viewerRef.current?.requestFullscreen();
    }
  }

  const cf: CorrectedFields = detail?.correctedFields ? JSON.parse(detail.correctedFields) : {};

  const ACTION_LABELS: Record<ReviewAction, string> = {
    approved: 'Onayla', rejected: 'Reddet', missing_information: 'Eksik Bilgi',
  };
  const ACTION_DESCRIPTIONS: Record<ReviewAction, string> = {
    approved: 'Bu belge onaylanacak. İşlemi onaylamak istiyor musunuz?',
    rejected: 'Bu belge reddedilecektir. Red gerekçesi zorunludur.',
    missing_information: 'Eksik bilgi olarak işaretlenecektir. Not giriniz.',
  };

  const isApproved = detail?.reviewStatus === 'approved';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-5 pb-28">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/accounting/documents" className="flex items-center gap-1 hover:text-[#0d7377] transition-colors">
            <ChevronLeft className="h-4 w-4" />Belge Kuyruğu
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">
            {type === 'receipt' ? `Makbuz #${id}` : `Belge #${id}`}
          </span>
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">Belge detayı yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />Yeniden Dene
            </Button>
          </div>
        )}

        {/* Status header */}
        {isLoading ? (
          <Skeleton className="h-10 w-64" />
        ) : detail && (
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-[#1e3a5f]">
              {detail.type === 'receipt' ? `Makbuz #${detail.id}` : `Belge #${detail.id}`}
              {detail.type === 'receipt' && detail.supplierName && ` — ${detail.supplierName}`}
              {detail.type === 'document' && detail.originalFileName && ` — ${detail.originalFileName}`}
            </h1>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${REVIEW_COLORS[detail.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}>
              {REVIEW_LABELS[detail.reviewStatus] ?? detail.reviewStatus}
            </span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${OCR_STATUS_COLORS[detail.ocrStatus] ?? 'bg-gray-100'}`}>
              {OCR_STATUS_LABELS[detail.ocrStatus] ?? detail.ocrStatus}
            </span>
            {detail.linkedTransaction && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                İşlem #{detail.linkedTransaction.id} · {ACCT_STATUS_LABELS[detail.linkedTransaction.accountingStatus] ?? detail.linkedTransaction.accountingStatus}
              </span>
            )}
          </div>
        )}

        {/* Main 3-column grid */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,2.2fr)_minmax(0,1.6fr)] gap-5">

          {/* ── Left: Document preview ──────────────────────────────────── */}
          <Card className="self-start">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-[#1e3a5f]">Belge Önizlemesi</CardTitle>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(z + 0.25, 3))} disabled={!blobUrl}>
                        <ZoomIn className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Yakınlaştır</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))} disabled={!blobUrl}>
                        <ZoomOut className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Uzaklaştır</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRotation(r => (r + 90) % 360)} disabled={!blobUrl}>
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Döndür</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleFullscreen} disabled={!blobUrl}>
                        <Maximize2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Tam Ekran</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div
                ref={viewerRef}
                className="relative overflow-hidden bg-gray-50 flex items-center justify-center"
                style={{ minHeight: '300px', maxHeight: '500px' }}
              >
                {fileLoading && (
                  <div className="flex flex-col items-center gap-3 p-8">
                    <Skeleton className="h-40 w-full rounded" />
                    <p className="text-xs text-muted-foreground">Dosya yükleniyor…</p>
                  </div>
                )}
                {!fileLoading && fileError && (
                  <div className="flex flex-col items-center gap-3 p-8 text-center">
                    <CameraOff className="h-10 w-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">{fileErrorMsg || 'Dosya görüntülenemiyor'}</p>
                    <p className="text-xs text-muted-foreground">İndirmek için aşağıdaki butonu kullanın.</p>
                  </div>
                )}
                {!fileLoading && blobUrl && detail && (
                  detail.type === 'document' && (detail.mimeType?.includes('pdf') || detail.originalFileName?.endsWith('.pdf')) ? (
                    <iframe
                      src={blobUrl}
                      className="w-full"
                      style={{ height: '480px', border: 'none', transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center center' }}
                      title="Belge önizlemesi"
                    />
                  ) : (
                    <img
                      src={blobUrl}
                      alt="Belge"
                      className="max-w-full object-contain transition-transform duration-200"
                      style={{ maxHeight: '480px', transform: `scale(${zoom}) rotate(${rotation}deg)`, transformOrigin: 'center center' }}
                    />
                  )
                )}
              </div>
              {/* Viewer controls */}
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t bg-gray-50/50">
                <span className="text-xs text-muted-foreground">{Math.round(zoom * 100)}% · {rotation}°</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleDownload} disabled={!blobUrl} aria-label="Belgeyi indir">
                    <Download className="h-3 w-3" />İndir
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handlePrint} disabled={!blobUrl} aria-label="Belgeyi yazdır">
                    <Printer className="h-3 w-3" />Yazdır
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Center: Editable fields ──────────────────────────────────── */}
          <Card className="self-start">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-[#1e3a5f]">Alan Bilgileri</CardTitle>
                {isApproved && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <Info className="h-3.5 w-3.5" />Onaylı kayıt düzenlenemez
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : detail && (
                <div className="space-y-3">
                  {/* Shared fields */}
                  {detail.type === 'receipt' && (
                    <>
                      <FieldRow label={<>Tedarikçi <FieldOriginBadge fieldKey="supplierName" cf={cf} originalVal={detail.supplierName} /></>}>
                        <Input value={editState.supplierName ?? ''} onChange={e => setField('supplierName', e.target.value)}
                          disabled={isApproved} className="h-8 text-sm" placeholder="Tedarikçi adı…" />
                      </FieldRow>
                      <FieldRow label={<>Tarih <FieldOriginBadge fieldKey="receiptDate" cf={cf} originalVal={detail.receiptDate} /></>}>
                        <Input type="date" value={editState.receiptDate ?? ''} onChange={e => setField('receiptDate', e.target.value)}
                          disabled={isApproved} className="h-8 text-sm" />
                      </FieldRow>
                    </>
                  )}
                  {detail.type === 'document' && (
                    <>
                      <FieldRow label="Belge Türü">
                        <Select value={editState.documentType ?? 'receipt'} onValueChange={v => setField('documentType', v)} disabled={isApproved}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Object.entries(DOC_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </FieldRow>
                      <div className="grid grid-cols-2 gap-2">
                        <FieldRow label={<>Tarih <FieldOriginBadge fieldKey="documentDate" cf={cf} originalVal={undefined} /></>}>
                          <Input type="date" value={editState.documentDate ?? ''} onChange={e => setField('documentDate', e.target.value)}
                            disabled={isApproved} className="h-8 text-sm" />
                        </FieldRow>
                        <FieldRow label="Saat">
                          <Input type="time" value={editState.documentTime ?? ''} onChange={e => setField('documentTime', e.target.value)}
                            disabled={isApproved} className="h-8 text-sm" />
                        </FieldRow>
                      </div>
                    </>
                  )}

                  {/* Belge No */}
                  <FieldRow label={<>Belge No <FieldOriginBadge fieldKey="documentNumber" cf={cf} originalVal={undefined} /></>}>
                    <Input value={editState.documentNumber ?? ''} onChange={e => setField('documentNumber', e.target.value)}
                      disabled={isApproved} className="h-8 text-sm" placeholder="Fatura/belge no…" />
                  </FieldRow>

                  {/* Amount + Currency */}
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <FieldRow label={<>Tutar <FieldOriginBadge fieldKey="amount" cf={cf} originalVal={detail.amount} /></>}>
                      <Input type="number" value={editState.amount ?? ''} onChange={e => setField('amount', e.target.value)}
                        disabled={isApproved} className="h-8 text-sm" placeholder="0.00" />
                    </FieldRow>
                    <FieldRow label="Para Birimi">
                      <Select value={editState.currency ?? 'TRY'} onValueChange={v => setField('currency', v)} disabled={isApproved}>
                        <SelectTrigger className="h-8 text-sm w-[90px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FieldRow>
                  </div>

                  {/* VAT fields */}
                  <div className="grid grid-cols-3 gap-2">
                    <FieldRow label="KDV Oranı (%)">
                      <Select value={String(editState.taxRate ?? '')} onValueChange={v => setField('taxRate', v)} disabled={isApproved}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="%" /></SelectTrigger>
                        <SelectContent>
                          {['0', '1', '8', '10', '20'].map(r => <SelectItem key={r} value={r}>{r}%</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FieldRow>
                    <FieldRow label="KDV Tutarı">
                      <Input type="number" value={editState.taxAmount ?? ''} onChange={e => setField('taxAmount', e.target.value)}
                        disabled={isApproved} className="h-8 text-sm" placeholder="0.00" />
                    </FieldRow>
                    <FieldRow label="Net Tutar">
                      <Input type="number" value={editState.netAmount ?? ''} onChange={e => setField('netAmount', e.target.value)}
                        disabled={isApproved} className="h-8 text-sm" placeholder="0.00" />
                    </FieldRow>
                  </div>

                  {/* Category */}
                  <FieldRow label={<>Kategori <FieldOriginBadge fieldKey="category" cf={cf} originalVal={undefined} /></>}>
                    <Select value={editState.category ?? ''} onValueChange={v => setField('category', v)} disabled={isApproved}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Kategori seçin…" /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FieldRow>

                  {/* Payment method */}
                  <FieldRow label={<>Ödeme Yöntemi <FieldOriginBadge fieldKey="paymentMethod" cf={cf} originalVal={undefined} /></>}>
                    <Select value={editState.paymentMethod ?? ''} onValueChange={v => setField('paymentMethod', v)} disabled={isApproved}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Yöntem seçin…" /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FieldRow>

                  {/* Guide note (receipt-only) */}
                  {detail.type === 'receipt' && detail.guideNote && (
                    <FieldRow label="Rehber Notu">
                      <p className="text-sm text-muted-foreground bg-gray-50 rounded p-2">{detail.guideNote}</p>
                    </FieldRow>
                  )}

                  {/* Notes (document) */}
                  {detail.type === 'document' && (
                    <FieldRow label="Notlar">
                      <Textarea rows={2} value={editState.notes ?? ''} onChange={e => setField('notes', e.target.value)}
                        disabled={isApproved} className="text-sm resize-none" placeholder="Belge notu…" />
                    </FieldRow>
                  )}

                  {/* OCR / original info bar */}
                  <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 mt-2">
                    <p className="text-[11px] text-blue-700 font-medium mb-1 flex items-center gap-1">
                      <Info className="h-3 w-3" />Alan kaynakları
                    </p>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">OCR/Orijinal — rehber tarafından girildi</span>
                      <span className="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">✏ Düzeltildi — muhasebe düzeltmesi</span>
                      <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">Eksik — bilgi girilmedi</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Right: Context + comparison ─────────────────────────────── */}
          <div className="space-y-4">
            {/* Review history */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-[#1e3a5f]">İnceleme Durumu</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? <Skeleton className="h-16 w-full" /> : detail && (
                  <>
                    <div className="flex items-start gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${REVIEW_COLORS[detail.reviewStatus]}`}>
                        {REVIEW_LABELS[detail.reviewStatus]}
                      </span>
                    </div>
                    {detail.reviewedAt && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(detail.reviewedAt).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {detail.reviewerName && ` · ${detail.reviewerName}`}
                      </p>
                    )}
                    {detail.reviewNotes && (
                      <p className="text-xs text-muted-foreground bg-gray-50 rounded p-2 mt-1">{detail.reviewNotes}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Yüklenme: {new Date(detail.createdAt).toLocaleDateString('tr-TR')}
                      {detail.creatorName && ` · ${detail.creatorName}`}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Related operation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-[#1e3a5f] flex items-center gap-1.5">
                  <Building2 className="h-4 w-4" />İlgili Operasyon
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? <Skeleton className="h-24 w-full" /> : detail && (
                  detail.operationId ? (
                    <div className="space-y-1.5 text-sm">
                      {detail.tourName && <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label="Tur" value={detail.tourName} />}
                      {detail.customerName && <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Müşteri" value={detail.customerName} />}
                      {detail.guideName && <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Rehber" value={detail.guideName} />}
                      {detail.driverName && <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Sürücü" value={detail.driverName} />}
                      {(detail.startDate || detail.endDate) && (
                        <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label="Tarih"
                          value={`${detail.startDate ?? '?'} – ${detail.endDate ?? '?'}`} />
                      )}
                      <Link href={`/accounting/operations/${detail.operationId}`}
                        className="text-xs text-[#0d7377] hover:underline mt-1 block">
                        Operasyon Muhasebe Dosyası →
                      </Link>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Operasyon bilgisi bulunamadı.</p>
                  )
                )}
              </CardContent>
            </Card>

            {/* Cost comparison — receipts only */}
            {(isLoading || (detail?.type === 'receipt' && detail.operationId)) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#1e3a5f] flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4" />Maliyet Karşılaştırması
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {isLoading ? <Skeleton className="h-20 w-full" /> : detail && (
                    <div className="space-y-2 text-sm">
                      <CostRow label="Bu belge tutarı" value={formatCurrency(detail.amount ?? 0, detail.currency ?? 'TRY')} />
                      {detail.operationExpenses !== undefined && detail.operationExpenses > 0 ? (
                        <>
                          <CostRow label="Onaylı op. giderleri" value={formatCurrency(detail.operationExpenses, 'TRY')} />
                          {(() => {
                            const diff = (detail.amount ?? 0) - detail.operationExpenses;
                            const pct = detail.operationExpenses > 0
                              ? Math.abs(diff / detail.operationExpenses * 100).toFixed(1) : null;
                            return (
                              <div className={`flex items-center justify-between rounded-lg p-2 text-xs font-medium ${diff > 0 ? 'bg-red-50 text-red-700' : diff < 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'}`}>
                                <span className="flex items-center gap-1">
                                  {diff > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : diff < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                                  Fark
                                </span>
                                <span>{diff > 0 ? '+' : ''}{formatCurrency(diff, 'TRY')}{pct ? ` (${pct}%)` : ''}</span>
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Bu operasyon için onaylı gider kaydı bulunamadı.</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">* Yalnızca onaylı işlemler dahildir.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Linked transaction */}
            {detail?.linkedTransaction && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#1e3a5f]">Bağlı İşlem</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 text-sm">
                    <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label="ID" value={`#${detail.linkedTransaction.id}`} />
                    <InfoRow icon={<Info className="h-3.5 w-3.5" />} label="Muhasebe Durumu"
                      value={ACCT_STATUS_LABELS[detail.linkedTransaction.accountingStatus] ?? detail.linkedTransaction.accountingStatus} />
                    <InfoRow icon={<Info className="h-3.5 w-3.5" />} label="Ödeme Durumu"
                      value={PAYMENT_STATUS_LABELS[detail.linkedTransaction.paymentStatus] ?? detail.linkedTransaction.paymentStatus} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ── Sticky action bar ────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur border-t shadow-lg">
        <div className="max-w-[1400px] mx-auto px-4 py-3">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Left: review actions */}
            {!isApproved && (
              <>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                  onClick={() => { setActionDialog({ open: true, action: 'approved' }); setActionNotes(''); }}
                  disabled={isLoading}>
                  <CheckCircle className="h-3.5 w-3.5" />Onayla
                </Button>
                <Button size="sm" variant="destructive" className="gap-1.5"
                  onClick={() => { setActionDialog({ open: true, action: 'rejected' }); setActionNotes(''); }}
                  disabled={isLoading}>
                  <XCircle className="h-3.5 w-3.5" />Reddet
                </Button>
                <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5"
                  onClick={() => { setActionDialog({ open: true, action: 'missing_information' }); setActionNotes(''); }}
                  disabled={isLoading}>
                  <AlertCircle className="h-3.5 w-3.5" />Eksik Bilgi
                </Button>
              </>
            )}

            {/* Convert to transaction — receipt only */}
            {detail?.type === 'receipt' && !detail.linkedTransaction && (
              <Button size="sm" className="bg-[#1e3a5f] hover:bg-[#162d4a] text-white gap-1.5"
                onClick={() => setCreateTxDialog(true)}
                disabled={isLoading || creatingTx}>
                <Plus className="h-3.5 w-3.5" />Muhasebe İşlemine Dönüştür
              </Button>
            )}

            <div className="flex-1" />

            {/* Right: save + file actions */}
            <Button size="sm" className="bg-[#0d7377] hover:bg-[#0a5e62] text-white gap-1.5"
              onClick={handleSave} disabled={!dirty || saving || isApproved}>
              <Save className="h-3.5 w-3.5" />{saving ? 'Kaydediliyor…' : 'Düzenlemeleri Kaydet'}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleDownload} disabled={!blobUrl} aria-label="Belgeyi indir">
              <Download className="h-3.5 w-3.5" />Belgeyi İndir
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrint} disabled={!blobUrl} aria-label="Belgeyi yazdır">
              <Printer className="h-3.5 w-3.5" />Yazdır
            </Button>
          </div>
        </div>
      </div>

      {/* ── Review action dialog ─────────────────────────────────────────── */}
      <Dialog open={actionDialog.open} onOpenChange={open => { if (!open) setActionDialog(d => ({ ...d, open: false })); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.action === 'approved' ? 'Belgeyi Onayla' :
               actionDialog.action === 'rejected' ? 'Belgeyi Reddet' : 'Eksik Bilgi İşaretle'}
            </DialogTitle>
            <DialogDescription>{ACTION_DESCRIPTIONS[actionDialog.action]}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs">
              {actionDialog.action === 'approved' ? 'Not (isteğe bağlı)' : 'Gerekçe / Not *'}
            </Label>
            <Textarea rows={3} value={actionNotes} onChange={e => setActionNotes(e.target.value)}
              placeholder={actionDialog.action === 'approved' ? 'Onay notu…' : 'Açıklama giriniz…'} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionDialog(d => ({ ...d, open: false }))}>İptal</Button>
            <Button
              className={actionDialog.action === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700 text-white' :
                         actionDialog.action === 'rejected' ? '' : 'bg-orange-500 hover:bg-orange-600 text-white'}
              variant={actionDialog.action === 'rejected' ? 'destructive' : 'default'}
              onClick={handleAction}
              disabled={actionLoading ||
                (actionDialog.action === 'rejected' && !actionNotes.trim()) ||
                (actionDialog.action === 'missing_information' && !actionNotes.trim())}>
              {actionLoading ? 'İşleniyor…' : ACTION_LABELS[actionDialog.action]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Convert to transaction dialog ────────────────────────────────── */}
      <Dialog open={createTxDialog} onOpenChange={setCreateTxDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Gider İşlemi Oluştur</DialogTitle>
            <DialogDescription>
              Bu makbuza dayanarak bir gider işlemi oluşturulacaktır.
              {detail && (
                <span className="block mt-1 font-medium">
                  Tutar: {formatCurrency(detail.amount ?? 0, detail.currency ?? 'TRY')}
                  {detail.supplierName ? ` — ${detail.supplierName}` : ''}
                </span>
              )}
              <br />Mevcut bir işlem varsa tekrar oluşturulamaz (HTTP 409). Devam etmek istiyor musunuz?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateTxDialog(false)}>İptal</Button>
            <Button className="bg-[#0d7377] hover:bg-[#0a5e62] text-white"
              disabled={creatingTx} onClick={handleCreateTransaction}>
              {creatingTx ? 'Oluşturuluyor…' : 'İşleme Dönüştür'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-muted-foreground text-xs shrink-0">{label}:</span>
      <span className="text-xs font-medium truncate">{value}</span>
    </div>
  );
}

function CostRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useParams } from 'wouter';
import { useAuth } from '@clerk/react';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  useGetOperation, useUpdateOperation,
  useListOperationTasks, useUpdateOperationTask, useCreateOperationTask, useDeleteOperationTask,
  useListOperationReceipts, useCreateOperationReceipt, useDeleteOperationReceipt,
  useGetAgencySettings, useGetTour, useListTourDays, useGetCustomer, useGetQuotation,
  useListProfiles,
} from '@workspace/api-client-react';
import {
  getGetOperationQueryKey, getListOperationTasksQueryKey, getListOperationReceiptsQueryKey, getListOperationsQueryKey,
  getGetTourQueryKey, getListTourDaysQueryKey, getGetCustomerQueryKey, getListProfilesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Plus, Trash2, User, Car, AlertTriangle,
  FileDown, Receipt, Camera, AlertCircle, MoreHorizontal, ScanLine, CheckCheck, Loader2, FileText,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, TASK_STATUS_LABELS, formatDate } from '@/lib/labels';
import { uploadFile, getStorageObjectUrl } from '@/lib/storage-service';
import { generateOperationPdf } from '@/lib/operation-pdf-export';
import { ocrReceiptImage, OCR_LOW_CONFIDENCE_THRESHOLD, type OcrReceiptResult } from '@/lib/ocr-service';
import { useProfile } from '@/contexts/ProfileContext';

// ─── AuthenticatedImage ───────────────────────────────────────────────────────
// Fetches a protected storage object with a Clerk Bearer token and renders it
// as a blob URL. Necessary because plain <img> tags cannot attach auth headers.

function AuthenticatedImage({ objectPath, alt, className }: {
  objectPath: string;
  alt: string;
  className?: string;
}) {
  const { getToken } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      try {
        const token = await getToken();
        const url = getStorageObjectUrl(objectPath);
        const res = await fetch(url, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) { if (!cancelled) setFetchError(true); return; }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setFetchError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  // objectPath and getToken are stable refs; re-run only when path changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectPath]);

  if (fetchError || !blobUrl) return <Camera className="w-5 h-5 text-muted-foreground/50" />;
  return <img src={blobUrl} alt={alt} className={className} />;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuideForm {
  guideName: string;
  guidePhone: string;
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  emergencyContact1Name: string;
  emergencyContact1Phone: string;
  emergencyContact2Name: string;
  emergencyContact2Phone: string;
  assignedGuideUserId: string | null;
}

interface ReceiptForm {
  amount: string;
  currency: string;
  supplierName: string;
  receiptDate: string;
  guideNote: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const { role } = useProfile();
  /** Can create/delete tasks and edit whole operation (admin or operations) */
  const canEdit = ['admin', 'operations'].includes(role ?? '');
  /** Can add/delete receipts (admin, operations, guide) */
  const canManageReceipts = ['admin', 'operations', 'guide'].includes(role ?? '');

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'medium', dueDate: '', assignedTo: '' });

  const [guideEditOpen, setGuideEditOpen] = useState(false);
  const [guideForm, setGuideForm] = useState<GuideForm>({
    guideName: '', guidePhone: '', driverName: '', driverPhone: '', vehiclePlate: '',
    emergencyContact1Name: '', emergencyContact1Phone: '',
    emergencyContact2Name: '', emergencyContact2Phone: '',
    assignedGuideUserId: null,
  });
  const [isSavingGuide, setIsSavingGuide] = useState(false);

  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({
    amount: '', currency: 'TRY', supplierName: '', receiptDate: '', guideNote: '',
  });
  const [receiptPhoto, setReceiptPhoto] = useState<File | null>(null);
  const [receiptPhotoPreview, setReceiptPhotoPreview] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  // Two separate inputs so each button reliably opens the intended picker on mobile.
  // capture="environment" alone causes Chrome Android to skip the gallery; a second
  // input without capture is the only cross-browser way to offer both options.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: operation, isLoading: opLoading } = useGetOperation(id, {
    query: { enabled: !!id, queryKey: getGetOperationQueryKey(id) },
  });
  const { data: tasks, isLoading: tasksLoading } = useListOperationTasks(id, {
    query: { enabled: !!id, queryKey: getListOperationTasksQueryKey(id) },
  });
  const { data: receipts, isLoading: receiptsLoading } = useListOperationReceipts(id, {
    query: { enabled: !!id, queryKey: getListOperationReceiptsQueryKey(id) },
  });
  // Agency settings only needed for PDF export; accounting/guide will get 403 so skip the call
  const { data: agencySettings } = useGetAgencySettings({ query: { enabled: canEdit, queryKey: ['agencySettings'] } });
  const tourId = operation?.tourId ?? null;
  const customerId = operation?.customerId ?? null;
  const { data: tour } = useGetTour(tourId!, { query: { enabled: !!tourId, queryKey: getGetTourQueryKey(tourId!) } });
  const { data: tourDays } = useListTourDays(tourId!, { query: { enabled: !!tourId, queryKey: getListTourDaysQueryKey(tourId!) } });
  const { data: customer } = useGetCustomer(customerId!, { query: { enabled: !!customerId, queryKey: getGetCustomerQueryKey(customerId!) } });
  const sourceQuoteId = operation?.sourceQuoteId ?? operation?.quotationId ?? null;
  const { data: sourceQuotation } = useGetQuotation(sourceQuoteId!, { query: { enabled: !!sourceQuoteId, queryKey: ['sourceQuotation', sourceQuoteId] } });

  // ── Delete receipt state ──────────────────────────────────────────────────
  const [deleteReceiptTarget, setDeleteReceiptTarget] = useState<number | null>(null);

  // ── OCR state ─────────────────────────────────────────────────────────────
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  /** Per-field confidence scores (0–1) from the last OCR run. */
  const [ocrConfidence, setOcrConfidence] = useState<Partial<OcrReceiptResult['confidence']>>({});
  /**
   * OCR-suggested values for fields that were already manually filled.
   * The user can choose to accept or ignore these.
   */
  const [ocrConflicts, setOcrConflicts] = useState<Record<string, string>>({});

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateTaskMutation = useUpdateOperationTask();
  const createTaskMutation = useCreateOperationTask();
  const deleteTaskMutation = useDeleteOperationTask();
  const updateOperationMutation = useUpdateOperation();
  const createReceiptMutation = useCreateOperationReceipt();
  const deleteReceiptMutation = useDeleteOperationReceipt();

  // ── Guide profiles (for assignment dropdown) ────────────────────────────
  const { data: guideProfiles } = useListProfiles(
    { role: 'guide' },
    { query: { enabled: canEdit, queryKey: getListProfilesQueryKey({ role: 'guide' }) } },
  );

  // ── Sync guide form when operation loads ────────────────────────────────
  useEffect(() => {
    if (operation) {
      setGuideForm({
        guideName: operation.guideName ?? '',
        guidePhone: operation.guidePhone ?? '',
        driverName: operation.driverName ?? '',
        driverPhone: operation.driverPhone ?? '',
        vehiclePlate: operation.vehiclePlate ?? '',
        emergencyContact1Name: operation.emergencyContact1Name ?? '',
        emergencyContact1Phone: operation.emergencyContact1Phone ?? '',
        emergencyContact2Name: operation.emergencyContact2Name ?? '',
        emergencyContact2Phone: operation.emergencyContact2Phone ?? '',
        assignedGuideUserId: operation.assignedGuideUserId ?? null,
      });
    }
  }, [operation]);

  // ── Cleanup photo preview URL ────────────────────────────────────────────
  useEffect(() => {
    return () => { if (receiptPhotoPreview) URL.revokeObjectURL(receiptPhotoPreview); };
  }, [receiptPhotoPreview]);

  // ── Task handlers ─────────────────────────────────────────────────────────
  function handleToggleTask(taskId: number, currentStatus: string) {
    const newStatus = currentStatus === 'completed' ? 'not_started' : 'completed';
    updateTaskMutation.mutate({ id, taskId, data: { status: newStatus } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListOperationTasksQueryKey(id) }),
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleCreateTask() {
    if (!taskForm.title.trim()) { toast({ title: 'Başlık zorunludur', variant: 'destructive' }); return; }
    createTaskMutation.mutate({ id, data: { ...taskForm, status: 'not_started' } }, {
      onSuccess: () => {
        toast({ title: 'Görev eklendi' });
        qc.invalidateQueries({ queryKey: getListOperationTasksQueryKey(id) });
        qc.invalidateQueries({ queryKey: getGetOperationQueryKey(id) });
        setTaskDialogOpen(false);
        setTaskForm({ title: '', priority: 'medium', dueDate: '', assignedTo: '' });
      },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleDeleteTask(taskId: number) {
    if (!confirm('Bu görevi silmek istiyor musunuz?')) return;
    deleteTaskMutation.mutate({ id, taskId }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListOperationTasksQueryKey(id) }),
      onError: () => toast({ title: 'Hata', description: 'Görev silinemedi', variant: 'destructive' }),
    });
  }

  // ── Guide/driver handlers ─────────────────────────────────────────────────
  async function handleSaveGuide() {
    setIsSavingGuide(true);
    try {
      await new Promise<void>((resolve, reject) => {
        updateOperationMutation.mutate({ id, data: guideForm }, {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getGetOperationQueryKey(id) });
            toast({ title: 'Rehber / Şoför bilgileri kaydedildi' });
            setGuideEditOpen(false);
            resolve();
          },
          onError: () => { toast({ title: 'Kayıt hatası', variant: 'destructive' }); reject(); },
        });
      });
    } finally {
      setIsSavingGuide(false);
    }
  }

  // ── Receipt handlers ──────────────────────────────────────────────────────
  const MAX_PHOTO_SIZE_MB = 10;

  function clearPhotoInputs() {
    if (cameraInputRef.current)  cameraInputRef.current.value = '';
    if (galleryInputRef.current) galleryInputRef.current.value = '';
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPhotoUploadError(null);
    if (!file) {
      setReceiptPhoto(null);
      if (receiptPhotoPreview) URL.revokeObjectURL(receiptPhotoPreview);
      setReceiptPhotoPreview(null);
      return;
    }
    // Validate type
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Geçersiz dosya türü', description: 'Lütfen bir fotoğraf seçin (JPEG, PNG, vb.)', variant: 'destructive' });
      clearPhotoInputs();
      return;
    }
    // Validate size
    if (file.size > MAX_PHOTO_SIZE_MB * 1024 * 1024) {
      toast({ title: 'Dosya çok büyük', description: `Maksimum ${MAX_PHOTO_SIZE_MB} MB yüklenebilir.`, variant: 'destructive' });
      clearPhotoInputs();
      return;
    }
    setReceiptPhoto(file);
    if (receiptPhotoPreview) URL.revokeObjectURL(receiptPhotoPreview);
    setReceiptPhotoPreview(URL.createObjectURL(file));
  }

  async function handleCreateReceipt() {
    const amountNum = parseFloat(receiptForm.amount);
    if (!receiptForm.amount || isNaN(amountNum)) {
      toast({ title: 'Tutar zorunludur', variant: 'destructive' }); return;
    }
    setIsUploadingReceipt(true);
    setUploadProgress(0);
    setPhotoUploadError(null);

    let photoObjectPath: string | undefined;

    // Upload photo if selected — failure does NOT block receipt save
    if (receiptPhoto) {
      try {
        setUploadProgress(30);
        const token = await getToken();
        setUploadProgress(60);
        photoObjectPath = await uploadFile(receiptPhoto, token);
        setUploadProgress(100);
      } catch {
        // Photo upload failed — save receipt without photo, warn user
        setPhotoUploadError('Fotoğraf yüklenemedi. Makbuz fotoğrafsız kaydedilecek.');
        setUploadProgress(0);
      }
    }

    createReceiptMutation.mutate({
      id,
      data: {
        amount: amountNum,
        currency: receiptForm.currency,
        supplierName: receiptForm.supplierName || undefined,
        receiptDate: receiptForm.receiptDate || undefined,
        guideNote: receiptForm.guideNote || undefined,
        photoObjectPath,
      },
    }, {
      onSuccess: () => {
        if (photoUploadError || (!photoObjectPath && receiptPhoto)) {
          toast({ title: 'Makbuz eklendi', description: 'Fotoğraf yüklenemedi; makbuz fotoğrafsız kaydedildi.', variant: 'default' });
        } else {
          toast({ title: 'Makbuz eklendi' });
        }
        qc.invalidateQueries({ queryKey: getListOperationReceiptsQueryKey(id) });
        setReceiptDialogOpen(false);
        setReceiptForm({ amount: '', currency: 'TRY', supplierName: '', receiptDate: '', guideNote: '' });
        setReceiptPhoto(null);
        setReceiptPhotoPreview(null);
        setUploadProgress(0);
        setPhotoUploadError(null);
        clearOcrState();
      },
      onError: () => toast({ title: 'Makbuz eklenemedi', variant: 'destructive' }),
      onSettled: () => setIsUploadingReceipt(false),
    });
  }

  // ── OCR handler ───────────────────────────────────────────────────────────
  function clearOcrState() {
    setOcrConfidence({});
    setOcrConflicts({});
  }

  async function handleOcrScan() {
    if (!receiptPhoto || isOcrLoading) return;
    setIsOcrLoading(true);
    clearOcrState();
    try {
      const token = await getToken();
      const result = await ocrReceiptImage(receiptPhoto, token);

      setOcrConfidence(result.confidence);

      // Fill empty fields; record conflicts for already-filled fields
      const newForm = { ...receiptForm };
      const conflicts: typeof ocrConflicts = {};

      // Amount
      if (result.amount !== null) {
        const strVal = String(result.amount);
        if (!receiptForm.amount) {
          newForm.amount = strVal;
        } else if (receiptForm.amount !== strVal) {
          conflicts.amount = strVal;
        }
      }

      // Currency (only override the default TRY if OCR says something different)
      if (result.currency && result.currency !== receiptForm.currency) {
        if (receiptForm.currency === 'TRY') {
          newForm.currency = result.currency;
        }
        // If user already chose a non-TRY currency, don't override silently
      }

      // Supplier name
      if (result.supplierName) {
        if (!receiptForm.supplierName) {
          newForm.supplierName = result.supplierName;
        } else if (receiptForm.supplierName !== result.supplierName) {
          conflicts.supplierName = result.supplierName;
        }
      }

      // Receipt date
      if (result.receiptDate) {
        if (!receiptForm.receiptDate) {
          newForm.receiptDate = result.receiptDate;
        } else if (receiptForm.receiptDate !== result.receiptDate) {
          conflicts.receiptDate = result.receiptDate;
        }
      }

      // Compose extra fields into the note (only if note is empty)
      if (!receiptForm.guideNote) {
        const parts: string[] = [];
        if (result.receiptTime) parts.push(`Saat: ${result.receiptTime}`);
        if (result.taxAmount != null) parts.push(`KDV: ${result.taxAmount}`);
        if (result.invoiceNumber) parts.push(`Fiş No: ${result.invoiceNumber}`);
        if (result.paymentMethod) parts.push(`Ödeme: ${result.paymentMethod}`);
        if (result.expenseCategory) parts.push(`Kategori: ${result.expenseCategory}`);
        if (parts.length > 0) newForm.guideNote = parts.join(' | ');
      }

      setReceiptForm(newForm);
      setOcrConflicts(conflicts);
      toast({ title: 'Makbuz okundu', description: 'Veriler forma aktarıldı. Lütfen kontrol edin.' });
    } catch (err) {
      toast({
        title: 'Okuma başarısız',
        description: (err as Error).message || 'Makbuz okunamadı. Lütfen tekrar deneyin.',
        variant: 'destructive',
      });
    } finally {
      setIsOcrLoading(false);
    }
  }

  // ── PDF handler ───────────────────────────────────────────────────────────
  async function handleGeneratePdf() {
    if (!operation) return;
    setIsPdfLoading(true);
    try {
      await generateOperationPdf(
        operation,
        agencySettings ?? null,
        tour ?? null,
        tourDays ?? [],
        customer ?? null,
      );
    } catch {
      toast({ title: 'PDF oluşturulamadı', description: 'Lütfen tekrar deneyin.', variant: 'destructive' });
    } finally {
      setIsPdfLoading(false);
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const allTasks = tasks ?? [];
  const completedCount = allTasks.filter(t => t.status === 'completed').length;
  const progressPercent = allTasks.length === 0 ? 0 : Math.round((completedCount / allTasks.length) * 100);
  const allReceipts = receipts ?? [];
  const missingPhotoCount = allReceipts.filter(r => !r.photoObjectPath).length;

  // ── Not found state ───────────────────────────────────────────────────────
  if (!opLoading && !operation) {
    return (
      <AppShell title="Operasyon Bulunamadı">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/operations"><Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="w-4 h-4" />Operasyon Planlama</Button></Link>
        </div>
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">Operasyon bulunamadı.</CardContent></Card>
      </AppShell>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <AppShell title={operation ? `OP-${operation.id}` : 'Operasyon'}>
      {/* ── Top action bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-5">
        <Link href="/operations">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="w-4 h-4" />Operasyon Planlama
          </Button>
        </Link>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={handleGeneratePdf}
          disabled={isPdfLoading || opLoading}
          data-testid="button-operation-pdf"
        >
          <FileDown className="w-4 h-4" />
          {isPdfLoading ? 'Hazırlanıyor...' : 'Operasyon Dosyası Oluştur'}
        </Button>
      </div>

      {/* ── Operation header ───────────────────────────────────────────────── */}
      {opLoading ? (
        <Skeleton className="h-28 w-full rounded-xl mb-4" />
      ) : operation && (
        <Card className="mb-4">
          <CardContent className="pt-5 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono font-semibold text-lg">OP-{operation.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OPERATION_STATUS_COLORS[operation.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {OPERATION_STATUS_LABELS[operation.status] ?? operation.status}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  {(operation.startDate || operation.endDate) && (
                    <p>📅 {formatDate(operation.startDate)}{operation.endDate ? ` → ${formatDate(operation.endDate)}` : ''}</p>
                  )}
                  {customer && <p>👤 {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</p>}
                  {tour && <p>🗺️ {tour.name}</p>}
                  {operation.sourceType === 'quotation' && sourceQuoteId ? (
                    <p>🔗 Kaynak: <Link href={`/quotations/${sourceQuoteId}`} className="text-primary hover:underline">Teklif {sourceQuotation?.number ?? `#${sourceQuoteId}`}</Link></p>
                  ) : (
                    <p>✦ Kaynak: Manuel Operasyon</p>
                  )}
                </div>
              </div>
              {operation.sourceType === 'gmail' && operation.sourceEmailImportId && (
                <Link href={`/reservations/${operation.sourceEmailImportId}`}>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <FileText className="w-3.5 h-3.5" />Gmail Rezervasyonu{operation.sourceBookingReference ? ` · ${operation.sourceBookingReference}` : ''}
                  </Button>
                </Link>
              )}
              <div className="flex flex-col items-end gap-1 min-w-[120px]">
                <span className="text-xs text-muted-foreground">Tamamlanma</span>
                <div className="flex items-center gap-2">
                  <Progress value={progressPercent} className="h-2 w-24" />
                  <span className="text-sm font-medium">%{progressPercent}</span>
                </div>
                <span className="text-xs text-muted-foreground">{completedCount}/{allTasks.length} görev</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Guide & driver card ────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              Rehber & Şoför
            </CardTitle>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setGuideEditOpen(true)} data-testid="button-edit-guide">
                Düzenle
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {opLoading ? (
            <div className="space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-40" /></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rehber</p>
                <p className="text-sm font-medium">{operation?.guideName || <span className="text-muted-foreground italic">Atanmadı</span>}</p>
                {operation?.guidePhone && <p className="text-sm text-muted-foreground">📞 {operation.guidePhone}</p>}
                {operation?.assignedGuideUserId && (() => {
                  const gp = (guideProfiles ?? []).find(p => p.clerkUserId === operation.assignedGuideUserId);
                  return gp ? (
                    <p className="text-xs text-primary flex items-center gap-1">
                      <User className="w-3 h-3" />{gp.name || gp.email}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" />Hesap atandı
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Car className="w-3.5 h-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Şoför</p>
                </div>
                <p className="text-sm font-medium">{operation?.driverName || <span className="text-muted-foreground italic">Atanmadı</span>}</p>
                {operation?.driverPhone && <p className="text-sm text-muted-foreground">📞 {operation.driverPhone}</p>}
                {operation?.vehiclePlate && (
                  <p className="text-xs font-mono bg-muted px-2 py-0.5 rounded inline-block">{operation.vehiclePlate}</p>
                )}
              </div>
              {(operation?.emergencyContact1Name || operation?.emergencyContact1Phone ||
                operation?.emergencyContact2Name || operation?.emergencyContact2Phone) && (
                <div className="col-span-full pt-2 border-t">
                  <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />Acil İrtibat
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(operation?.emergencyContact1Name || operation?.emergencyContact1Phone) && (
                      <p className="text-sm">
                        <span className="font-medium">{operation?.emergencyContact1Name || '-'}</span>
                        {operation?.emergencyContact1Phone && <span className="text-muted-foreground"> · {operation.emergencyContact1Phone}</span>}
                      </p>
                    )}
                    {(operation?.emergencyContact2Name || operation?.emergencyContact2Phone) && (
                      <p className="text-sm">
                        <span className="font-medium">{operation?.emergencyContact2Name || '-'}</span>
                        {operation?.emergencyContact2Phone && <span className="text-muted-foreground"> · {operation.emergencyContact2Phone}</span>}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Tasks card ─────────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Görevler</CardTitle>
            {canEdit && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTaskDialogOpen(true)} data-testid="button-add-task">
                <Plus className="w-3.5 h-3.5" />Görev Ekle
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {tasksLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : allTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Henüz görev eklenmemiş.</p>
          ) : (
            <div className="space-y-2">
              {allTasks.map(task => (
                <div key={task.id} className={`flex items-start gap-3 p-3 rounded-lg border bg-card transition-opacity ${task.status === 'completed' ? 'opacity-60' : ''}`} data-testid={`task-${task.id}`}>
                  <Checkbox
                    checked={task.status === 'completed'}
                    onCheckedChange={() => handleToggleTask(task.id, task.status)}
                    className="mt-0.5 flex-shrink-0"
                    data-testid={`checkbox-task-${task.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>{task.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority ?? 'medium'] ?? 'bg-gray-100 text-gray-600'}`}>{PRIORITY_LABELS[task.priority ?? 'medium']}</span>
                      <span className="text-xs text-muted-foreground">{TASK_STATUS_LABELS[task.status] ?? task.status}</span>
                      {task.dueDate && <span className="text-xs text-muted-foreground">Son: {formatDate(task.dueDate)}</span>}
                      {task.assignedTo && <span className="text-xs text-muted-foreground">Sorumlu: {task.assignedTo}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0" onClick={() => handleDeleteTask(task.id)} data-testid={`button-delete-task-${task.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Receipts card ──────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4 text-muted-foreground" />
                Masraf Makbuzları
              </CardTitle>
              {allReceipts.length > 0 && (
                <Badge variant="secondary" className="text-xs">{allReceipts.length}</Badge>
              )}
            </div>
            {canManageReceipts && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setReceiptDialogOpen(true)}
                data-testid="button-add-receipt"
              >
                <Plus className="w-3.5 h-3.5" />Makbuz Ekle
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Missing photo warning */}
          {missingPhotoCount > 0 && (
            <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{missingPhotoCount} makbuzun fotoğrafı eksik.</span>
            </div>
          )}

          {receiptsLoading ? (
            <div className="space-y-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : allReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Henüz makbuz eklenmemiş.</p>
          ) : (
            <div className="space-y-2">
              {allReceipts.map(r => (
                <div key={r.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card" data-testid={`receipt-${r.id}`}>
                  {/* Photo thumbnail */}
                  <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-muted flex items-center justify-center">
                    {r.photoObjectPath ? (
                      <AuthenticatedImage
                        objectPath={r.photoObjectPath}
                        alt="Makbuz"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Camera className="w-5 h-5 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">
                        {new Intl.NumberFormat('tr-TR', { style: 'currency', currency: r.currency ?? 'TRY', maximumFractionDigits: 2 }).format(r.amount)}
                      </span>
                      {!r.photoObjectPath && (
                        <span className="text-xs text-amber-600 flex items-center gap-0.5">
                          <AlertCircle className="w-3 h-3" />Fotoğraf yok
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                      {r.supplierName && <p>🏪 {r.supplierName}</p>}
                      {r.receiptDate && <p>📅 {r.receiptDate}</p>}
                      {r.guideNote && <p className="italic">"{r.guideNote}"</p>}
                    </div>
                  </div>
                  {/* Receipt actions — only for roles that can manage receipts */}
                  {canManageReceipts && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" data-testid={`button-menu-receipt-${r.id}`}>
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="gap-2 text-destructive focus:text-destructive"
                          onClick={() => setDeleteReceiptTarget(r.id)}
                          data-testid={`button-delete-receipt-${r.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />Makbuzu Sil
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Task dialog ────────────────────────────────────────────────────── */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Görev Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Başlık *</label><Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Görev başlığı..." data-testid="input-task-title" /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Öncelik</label>
              <Select value={taskForm.priority} onValueChange={v => setTaskForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PRIORITY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Son Tarih</label><Input type="date" value={taskForm.dueDate} onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-task-dueDate" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Sorumlu</label><Input value={taskForm.assignedTo} onChange={e => setTaskForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Ad Soyad" data-testid="input-task-assignedTo" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateTask} disabled={createTaskMutation.isPending} data-testid="button-save-task">
              {createTaskMutation.isPending ? 'Ekleniyor...' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Guide edit dialog ──────────────────────────────────────────────── */}
      <Dialog open={guideEditOpen} onOpenChange={setGuideEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rehber & Şoför Bilgileri</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />Rehber
              </p>
              {/* ── Assigned guide user account ─────────────────────────────── */}
              <div className="mb-2">
                <label className="text-xs text-muted-foreground mb-1 block">Kullanıcı Hesabı</label>
                <Select
                  value={guideForm.assignedGuideUserId ?? '__none__'}
                  onValueChange={v => setGuideForm(f => ({ ...f, assignedGuideUserId: v === '__none__' ? null : v }))}
                >
                  <SelectTrigger data-testid="select-assigned-guide-user">
                    <SelectValue placeholder="Rehber hesabı seç..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Atanmadı —</SelectItem>
                    {(guideProfiles ?? []).map(p => (
                      <SelectItem key={p.clerkUserId} value={p.clerkUserId}>
                        {p.name || p.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground mb-1 block">Ad Soyad</label><Input value={guideForm.guideName} onChange={e => setGuideForm(f => ({ ...f, guideName: e.target.value }))} placeholder="Rehber adı" data-testid="input-guide-name" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Telefon</label><Input value={guideForm.guidePhone} onChange={e => setGuideForm(f => ({ ...f, guidePhone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-guide-phone" /></div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5" />Şoför & Araç
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground mb-1 block">Ad Soyad</label><Input value={guideForm.driverName} onChange={e => setGuideForm(f => ({ ...f, driverName: e.target.value }))} placeholder="Şoför adı" data-testid="input-driver-name" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">Telefon</label><Input value={guideForm.driverPhone} onChange={e => setGuideForm(f => ({ ...f, driverPhone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-driver-phone" /></div>
                <div className="col-span-2"><label className="text-xs text-muted-foreground mb-1 block">Plaka</label><Input value={guideForm.vehiclePlate} onChange={e => setGuideForm(f => ({ ...f, vehiclePlate: e.target.value }))} placeholder="35 AA 000" data-testid="input-vehicle-plate" /></div>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />Acil İrtibat
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground mb-1 block">1. Kişi Adı</label><Input value={guideForm.emergencyContact1Name} onChange={e => setGuideForm(f => ({ ...f, emergencyContact1Name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-emergency1-name" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">1. Kişi Tel.</label><Input value={guideForm.emergencyContact1Phone} onChange={e => setGuideForm(f => ({ ...f, emergencyContact1Phone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-emergency1-phone" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">2. Kişi Adı</label><Input value={guideForm.emergencyContact2Name} onChange={e => setGuideForm(f => ({ ...f, emergencyContact2Name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-emergency2-name" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">2. Kişi Tel.</label><Input value={guideForm.emergencyContact2Phone} onChange={e => setGuideForm(f => ({ ...f, emergencyContact2Phone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-emergency2-phone" /></div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuideEditOpen(false)}>İptal</Button>
            <Button onClick={handleSaveGuide} disabled={isSavingGuide} data-testid="button-save-guide">
              {isSavingGuide ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Receipt delete confirm ─────────────────────────────────────────── */}
      <AlertDialog open={deleteReceiptTarget !== null} onOpenChange={open => { if (!open) setDeleteReceiptTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Makbuzu sil</AlertDialogTitle>
            <AlertDialogDescription>
              Bu makbuz ve varsa fotoğrafı kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteReceiptTarget === null) return;
                const receiptId = deleteReceiptTarget;
                deleteReceiptMutation.mutate({ id, receiptId }, {
                  onSuccess: () => {
                    toast({ title: 'Makbuz silindi' });
                    qc.invalidateQueries({ queryKey: getListOperationReceiptsQueryKey(id) });
                    setDeleteReceiptTarget(null);
                  },
                  onError: () => {
                    setDeleteReceiptTarget(null);
                    toast({ title: 'Silme başarısız', variant: 'destructive' });
                  },
                });
              }}
              data-testid="button-confirm-delete-receipt"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Receipt add dialog ─────────────────────────────────────────────── */}
      <Dialog open={receiptDialogOpen} onOpenChange={v => {
        setReceiptDialogOpen(v);
        if (!v) {
          setReceiptPhoto(null);
          setReceiptPhotoPreview(null);
          setUploadProgress(0);
          setPhotoUploadError(null);
          clearOcrState();
        }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Makbuz Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">

            {/* ── Amount + currency ─────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs text-muted-foreground">Tutar *</label>
                  {ocrConfidence.amount !== undefined && ocrConfidence.amount < OCR_LOW_CONFIDENCE_THRESHOLD && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium leading-none">Kontrol Et</span>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={receiptForm.amount}
                  onChange={e => setReceiptForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  data-testid="input-receipt-amount"
                />
                {ocrConflicts.amount && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-muted-foreground">OCR önerisi: <strong>{ocrConflicts.amount}</strong></span>
                    <button type="button" className="text-xs text-primary underline" onClick={() => { setReceiptForm(f => ({ ...f, amount: ocrConflicts.amount! })); setOcrConflicts(c => { const n = { ...c }; delete n.amount; return n; }); }}>Kabul Et</button>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="text-xs text-muted-foreground">Para Birimi</label>
                  {ocrConfidence.currency !== undefined && ocrConfidence.currency < OCR_LOW_CONFIDENCE_THRESHOLD && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium leading-none">Kontrol Et</span>
                  )}
                </div>
                <Select value={receiptForm.currency} onValueChange={v => setReceiptForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger data-testid="select-receipt-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRY">TRY ₺</SelectItem>
                    <SelectItem value="USD">USD $</SelectItem>
                    <SelectItem value="EUR">EUR €</SelectItem>
                    <SelectItem value="GBP">GBP £</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ── Supplier ──────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs text-muted-foreground">Tedarikçi / Dükkan</label>
                {ocrConfidence.supplierName !== undefined && ocrConfidence.supplierName < OCR_LOW_CONFIDENCE_THRESHOLD && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium leading-none">Kontrol Et</span>
                )}
              </div>
              <Input value={receiptForm.supplierName} onChange={e => setReceiptForm(f => ({ ...f, supplierName: e.target.value }))} placeholder="Tedarikçi adı" data-testid="input-receipt-supplier" />
              {ocrConflicts.supplierName && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-xs text-muted-foreground">OCR önerisi: <strong>{ocrConflicts.supplierName}</strong></span>
                  <button type="button" className="text-xs text-primary underline" onClick={() => { setReceiptForm(f => ({ ...f, supplierName: ocrConflicts.supplierName! })); setOcrConflicts(c => { const n = { ...c }; delete n.supplierName; return n; }); }}>Kabul Et</button>
                </div>
              )}
            </div>

            {/* ── Date ─────────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs text-muted-foreground">Tarih</label>
                {ocrConfidence.receiptDate !== undefined && ocrConfidence.receiptDate < OCR_LOW_CONFIDENCE_THRESHOLD && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium leading-none">Kontrol Et</span>
                )}
              </div>
              <Input type="date" value={receiptForm.receiptDate} onChange={e => setReceiptForm(f => ({ ...f, receiptDate: e.target.value }))} data-testid="input-receipt-date" />
              {ocrConflicts.receiptDate && (
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="text-xs text-muted-foreground">OCR önerisi: <strong>{ocrConflicts.receiptDate}</strong></span>
                  <button type="button" className="text-xs text-primary underline" onClick={() => { setReceiptForm(f => ({ ...f, receiptDate: ocrConflicts.receiptDate! })); setOcrConflicts(c => { const n = { ...c }; delete n.receiptDate; return n; }); }}>Kabul Et</button>
                </div>
              )}
            </div>

            {/* ── Guide note ────────────────────────────────────────────── */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Rehber Notu</label>
              <Textarea value={receiptForm.guideNote} onChange={e => setReceiptForm(f => ({ ...f, guideNote: e.target.value }))} rows={2} placeholder="Makbuz hakkında not..." data-testid="textarea-receipt-note" />
            </div>

            {/* ── Photo upload ──────────────────────────────────────────── */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Makbuz Fotoğrafı</label>
              {receiptPhotoPreview ? (
                /* Preview + remove/retake + OCR scan */
                <div>
                  <div className="relative">
                    <img src={receiptPhotoPreview} alt="Önizleme" className="w-full h-36 object-cover rounded-lg border" />
                    <button
                      type="button"
                      onClick={() => {
                        setReceiptPhoto(null);
                        if (receiptPhotoPreview) URL.revokeObjectURL(receiptPhotoPreview);
                        setReceiptPhotoPreview(null);
                        clearPhotoInputs();
                        clearOcrState();
                        setIsOcrLoading(false);
                      }}
                      className="absolute top-1.5 right-1.5 bg-background/90 border rounded-full p-1 leading-none text-xs hover:bg-background"
                      aria-label="Fotoğrafı kaldır"
                    >
                      ✕
                    </button>
                  </div>
                  {/* "Makbuzu Tara" — only visible after photo is selected */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2 mt-2"
                    onClick={handleOcrScan}
                    disabled={isOcrLoading || isUploadingReceipt || createReceiptMutation.isPending}
                    data-testid="button-ocr-scan"
                  >
                    {isOcrLoading ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" />Makbuz okunuyor...</>
                    ) : (
                      <><ScanLine className="w-3.5 h-3.5" />Makbuzu Tara</>
                    )}
                  </Button>
                </div>
              ) : (
                /* Two-button picker */
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary/70 transition-colors"
                    data-testid="button-take-photo"
                  >
                    <Camera className="w-5 h-5" />
                    <span className="text-xs font-medium">Fotoğraf Çek</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary/50 hover:text-primary/70 transition-colors"
                    data-testid="button-choose-from-gallery"
                  >
                    <Receipt className="w-5 h-5" />
                    <span className="text-xs font-medium">Galeriden Seç</span>
                  </button>
                </div>
              )}

              {/* Camera input — opens rear camera on mobile */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoChange}
                data-testid="input-receipt-camera"
              />
              {/* Gallery input — shows file/gallery picker without forcing camera */}
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                data-testid="input-receipt-gallery"
              />
            </div>
          </div>
          {/* Upload progress bar */}
          {isUploadingReceipt && uploadProgress > 0 && uploadProgress < 100 && (
            <div className="px-1 pb-1">
              <p className="text-xs text-muted-foreground mb-1">Fotoğraf yükleniyor...</p>
              <Progress value={uploadProgress} className="h-1.5" />
            </div>
          )}

          {/* Photo upload error (non-blocking) */}
          {photoUploadError && (
            <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{photoUploadError}</span>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptDialogOpen(false)} disabled={isUploadingReceipt || createReceiptMutation.isPending}>İptal</Button>
            <Button onClick={handleCreateReceipt} disabled={isUploadingReceipt || createReceiptMutation.isPending} data-testid="button-save-receipt">
              {isUploadingReceipt ? 'Fotoğraf yükleniyor...' : createReceiptMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

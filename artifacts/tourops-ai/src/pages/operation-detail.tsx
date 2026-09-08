import { OperationDomainWorkspace } from "@/components/OperationDomainWorkspace";
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
  useListOperationDocuments, useCreateOperationDocument, useDeleteOperationDocument, useListOperationActivity,
  useGetAgencySettings, useGetTour, useListTourDays, useGetCustomer, useGetQuotation,
  useListProfiles, useListSuppliers, useListResources, useUpdateOperationReceipt, customFetch,
} from '@workspace/api-client-react';
import type { OperationReceipt } from '@workspace/api-client-react';
import {
  getGetOperationQueryKey, getListOperationTasksQueryKey, getListOperationReceiptsQueryKey, getListOperationsQueryKey,
  getGetTourQueryKey, getListTourDaysQueryKey, getGetCustomerQueryKey, getListProfilesQueryKey,
  getListOperationDocumentsQueryKey, getListOperationActivityQueryKey, getListSuppliersQueryKey, getListResourcesQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/usePermission';
import {
  ArrowLeft, Plus, Trash2, User, Car, AlertTriangle, IdCard,
  FileDown, Receipt, Camera, AlertCircle, MoreHorizontal, ScanLine, CheckCheck, Loader2, FileText, Pencil, Upload, History, ExternalLink, CalendarDays, ClipboardList,
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, TASK_STATUS_LABELS, formatDate } from '@/lib/labels';
import { uploadFile, getStorageObjectUrl } from '@/lib/storage-service';
import { generateOperationPdf } from '@/lib/operation-pdf-export';
import { ocrReceiptImage, OCR_LOW_CONFIDENCE_THRESHOLD, type OcrReceiptResult } from '@/lib/ocr-service';
import { useProfile } from '@/contexts/ProfileContext';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

/** Greys out an input that mirrors a selected record instead of accepting input. */
function readOnlyFieldClass(readOnly: boolean): string {
  return readOnly ? 'bg-muted text-muted-foreground cursor-default focus-visible:ring-0' : '';
}

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
  // Phase 2C: canonical Personnel/Resource identity (independent of
  // assignedGuideUserId, which is login access, and of driverSupplierId,
  // which is the pre-existing supplier-based driver record).
  guideResourceId: number | null;
  driverResourceId: number | null;
}

interface ReceiptForm {
  amount: string;
  currency: string;
  supplierName: string;
  receiptDate: string;
  receiptTime: string;
  taxAmount: string;
  taxRate: string;
  documentNumber: string;
  paymentMethod: string;
  category: string;
  guideNote: string;
}

const EMPTY_RECEIPT_FORM: ReceiptForm = {
  amount: '', currency: 'TRY', supplierName: '', receiptDate: '', receiptTime: '',
  taxAmount: '', taxRate: '', documentNumber: '', paymentMethod: '', category: '', guideNote: '',
};

interface GeneralForm {
  startDate: string;
  endDate: string;
  status: string;
  assignedTo: string;
  notes: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OperationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { getToken } = useAuth();
  const { role, allPermissions } = useProfile();
  /** Can create/delete tasks and edit whole operation (admin, operations, or super_admin/all-permission users) */
  const canEdit = allPermissions || ['admin', 'operations'].includes(role ?? '');
  /** Can add/delete receipts (admin, operations, guide) */
  const canManageReceipts = allPermissions || ['admin', 'operations', 'guide'].includes(role ?? '');
  /**
   * Phase 2C: canonical Resource assignment is gated on the dedicated
   * operations.assign permission (not the canEdit role list above), matching
   * the same permission the backend's PATCH /field/operations/:id/assignments
   * now enforces server-side whenever guideResourceId/driverResourceId are
   * present in the request body.
   */
  const canAssignPersonnel = usePermission('operations', 'assign');

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'medium', dueDate: '', assignedTo: '', status: 'not_started' });
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [generalEditOpen, setGeneralEditOpen] = useState(false);
  const [generalForm, setGeneralForm] = useState<GeneralForm>({ startDate: '', endDate: '', status: 'active', assignedTo: '', notes: '' });
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('other');
  const [documentTitle, setDocumentTitle] = useState('');
  const documentInputRef = useRef<HTMLInputElement>(null);

  const [guideEditOpen, setGuideEditOpen] = useState(false);
  const [guideForm, setGuideForm] = useState<GuideForm>({
    guideName: '', guidePhone: '', driverName: '', driverPhone: '', vehiclePlate: '',
    emergencyContact1Name: '', emergencyContact1Phone: '',
    emergencyContact2Name: '', emergencyContact2Phone: '',
    assignedGuideUserId: null,
    guideResourceId: null, driverResourceId: null,
  });
  const [isSavingGuide, setIsSavingGuide] = useState(false);
  const [assignmentWarnings, setAssignmentWarnings] = useState<string[]>([]);
  // Assignment dialog mode. Name/phone/plate are auto-filled and read-only when
  // a registered record is picked; they only become editable under the explicit
  // "kayıtlı olmayan birini elle gir" option, so the same person is never both
  // selected from a list and retyped by hand.
  const [guideManual, setGuideManual] = useState(false);
  const [driverSupplierId, setDriverSupplierId] = useState<number | null>(null);
  const [driverManual, setDriverManual] = useState(false);

  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>(EMPTY_RECEIPT_FORM);
  /** Verbatim OCR output for the currently-selected photo, saved alongside the receipt for audit. */
  const [ocrRawResult, setOcrRawResult] = useState<OcrReceiptResult | null>(null);
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
  const { data: documents, isLoading: documentsLoading } = useListOperationDocuments(id, {
    query: { enabled: !!id, queryKey: getListOperationDocumentsQueryKey(id) },
  });
  const { data: activity, isLoading: activityLoading } = useListOperationActivity(id, {
    query: { enabled: !!id, queryKey: getListOperationActivityQueryKey(id), staleTime: 30_000 },
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

  // ── Receipt detail/edit state ─────────────────────────────────────────────
  const [receiptDetailTarget, setReceiptDetailTarget] = useState<OperationReceipt | null>(null);
  const [receiptEditForm, setReceiptEditForm] = useState<ReceiptForm>(EMPTY_RECEIPT_FORM);
  const [isSavingReceiptEdit, setIsSavingReceiptEdit] = useState(false);

  function openReceiptDetail(r: OperationReceipt) {
    setReceiptDetailTarget(r);
    setReceiptEditForm({
      amount: String(r.amount),
      currency: r.currency,
      supplierName: r.supplierName ?? '',
      receiptDate: r.receiptDate ?? '',
      receiptTime: r.receiptTime ?? '',
      taxAmount: r.taxAmount != null ? String(r.taxAmount) : '',
      taxRate: r.taxRate != null ? String(r.taxRate) : '',
      documentNumber: r.documentNumber ?? '',
      paymentMethod: r.paymentMethod ?? '',
      category: r.category ?? '',
      guideNote: r.guideNote ?? '',
    });
  }

  function saveReceiptEdit() {
    if (!receiptDetailTarget) return;
    const amountNum = parseFloat(receiptEditForm.amount);
    if (!receiptEditForm.amount || isNaN(amountNum)) {
      toast({ title: 'Tutar zorunludur', variant: 'destructive' }); return;
    }
    setIsSavingReceiptEdit(true);
    updateReceiptMutation.mutate({
      id,
      receiptId: receiptDetailTarget.id,
      data: {
        amount: amountNum,
        currency: receiptEditForm.currency,
        supplierName: receiptEditForm.supplierName || undefined,
        receiptDate: receiptEditForm.receiptDate || undefined,
        receiptTime: receiptEditForm.receiptTime || undefined,
        taxAmount: receiptEditForm.taxAmount ? parseFloat(receiptEditForm.taxAmount) : undefined,
        taxRate: receiptEditForm.taxRate ? parseFloat(receiptEditForm.taxRate) : undefined,
        documentNumber: receiptEditForm.documentNumber || undefined,
        paymentMethod: receiptEditForm.paymentMethod || undefined,
        category: receiptEditForm.category || undefined,
        guideNote: receiptEditForm.guideNote || undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Makbuz güncellendi' });
        qc.invalidateQueries({ queryKey: getListOperationReceiptsQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListOperationActivityQueryKey(id) });
        setReceiptDetailTarget(null);
      },
      onError: (err) => {
        const status = (err as { status?: number } | null)?.status;
        toast({
          title: status === 409 ? 'Makbuz kilitli' : 'Kaydedilemedi',
          description: status === 409
            ? 'Bu makbuz muhasebe tarafında onaylanmış/ödenmiş; artık düzenlenemez.'
            : (err instanceof Error ? err.message : 'Lütfen tekrar deneyin.'),
          variant: 'destructive',
        });
      },
      onSettled: () => setIsSavingReceiptEdit(false),
    });
  }

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
  const updateReceiptMutation = useUpdateOperationReceipt();
  const createDocumentMutation = useCreateOperationDocument();
  const deleteDocumentMutation = useDeleteOperationDocument();

  // ── Guide profiles (for assignment dropdown) ────────────────────────────
  const { data: guideProfiles } = useListProfiles(
    { role: 'guide' },
    { query: { enabled: canEdit, queryKey: getListProfilesQueryKey({ role: 'guide' }) } },
  );

  // ── Driver suppliers (for assignment dropdown) ──────────────────────────
  // No dedicated driver/personnel model exists — drivers are external
  // contacts, modeled the same way freelance guides already are: as
  // suppliers with a category tag.
  const { data: driverSuppliers } = useListSuppliers(
    { category: 'driver', isActive: true },
    { query: { enabled: canEdit, queryKey: getListSuppliersQueryKey({ category: 'driver', isActive: true }) } },
  );

  // ── Canonical Personnel/Resource lists (Phase 2C) ───────────────────────
  // Independent of guideProfiles/driverSuppliers above — these are the
  // canonical GUIDE/DRIVER identities from Personel (Phase 2D.1/2D.2), only
  // fetched when the user can actually use the picker.
  const guideResourceParams = { type: 'GUIDE' as const, active: true };
  const { data: guideResources } = useListResources(guideResourceParams, {
    query: { enabled: canAssignPersonnel, queryKey: getListResourcesQueryKey(guideResourceParams) },
  });
  const driverResourceParams = { type: 'DRIVER' as const, active: true };
  const { data: driverResources } = useListResources(driverResourceParams, {
    query: { enabled: canAssignPersonnel, queryKey: getListResourcesQueryKey(driverResourceParams) },
  });

  // ── Assignment dialog mode ──────────────────────────────────────────────
  // The operation stores only the resulting name/phone/plate, not which record
  // they came from, so the mode is re-derived on load: a guide name without a
  // linked account, or a driver whose name+phone matches no registered driver,
  // must stay editable rather than silently locking existing free-text data.
  useEffect(() => {
    if (!operation) return;
    setGuideManual(!operation.assignedGuideUserId && !!operation.guideName);
  }, [operation]);

  useEffect(() => {
    if (!operation) return;
    const name = operation.driverName ?? '';
    if (!name) { setDriverSupplierId(null); setDriverManual(false); return; }
    const match = (driverSuppliers ?? []).find(
      s => (s.contactPerson || s.name) === name && (s.phone ?? '') === (operation.driverPhone ?? ''),
    );
    setDriverSupplierId(match?.id ?? null);
    setDriverManual(!match);
  }, [operation, driverSuppliers]);

  const guideSelectValue = guideForm.assignedGuideUserId ?? (guideManual ? '__manual__' : '__none__');
  const guideIsManual = guideManual;
  const guideAccountSelected = !!guideForm.assignedGuideUserId;

  const driverSelectValue =
    driverSupplierId != null ? String(driverSupplierId) : (driverManual ? '__manual__' : '__none__');
  const driverIsManual = driverManual;
  const driverSupplierSelected = driverSupplierId != null;

  function handleGuideSelect(value: string) {
    if (value === '__manual__') {
      setGuideManual(true);
      setGuideForm(f => ({ ...f, assignedGuideUserId: null }));
      return;
    }
    if (value === '__none__') {
      setGuideManual(false);
      setGuideForm(f => ({ ...f, assignedGuideUserId: null, guideName: '', guidePhone: '' }));
      return;
    }
    const profile = (guideProfiles ?? []).find(p => p.clerkUserId === value);
    setGuideManual(false);
    setGuideForm(f => ({
      ...f,
      assignedGuideUserId: value,
      guideName: profile?.name || profile?.email || '',
    }));
  }

  function handleDriverSelect(value: string) {
    if (value === '__manual__') {
      setDriverManual(true);
      setDriverSupplierId(null);
      return;
    }
    if (value === '__none__') {
      setDriverManual(false);
      setDriverSupplierId(null);
      setGuideForm(f => ({ ...f, driverName: '', driverPhone: '', vehiclePlate: '' }));
      return;
    }
    const supplier = (driverSuppliers ?? []).find(s => String(s.id) === value);
    if (!supplier) return;
    setDriverManual(false);
    setDriverSupplierId(supplier.id);
    setGuideForm(f => ({
      ...f,
      driverName:   supplier.contactPerson || supplier.name,
      driverPhone:  supplier.phone ?? '',
      vehiclePlate: supplier.vehiclePlate ?? '',
    }));
  }

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
        guideResourceId: operation.guideResourceId ?? null,
        driverResourceId: operation.driverResourceId ?? null,
      });
    }
  }, [operation]);

  useEffect(() => {
    if (operation) {
      setGeneralForm({
        startDate: operation.startDate ?? '',
        endDate: operation.endDate ?? '',
        status: operation.status ?? 'active',
        assignedTo: operation.assignedTo ?? '',
        notes: operation.notes ?? '',
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
    const taskData = {
      ...taskForm,
      title: taskForm.title.trim(),
      description: taskForm.description || undefined,
      dueDate: taskForm.dueDate || undefined,
      assignedTo: taskForm.assignedTo || undefined,
    };
    const onSuccess = () => {
      toast({ title: editingTaskId ? 'Görev güncellendi' : 'Görev eklendi' });
      qc.invalidateQueries({ queryKey: getListOperationTasksQueryKey(id) });
      qc.invalidateQueries({ queryKey: getGetOperationQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListOperationActivityQueryKey(id) });
      setTaskDialogOpen(false);
      setEditingTaskId(null);
      setTaskForm({ title: '', description: '', priority: 'medium', dueDate: '', assignedTo: '', status: 'not_started' });
    };
    if (editingTaskId) {
      updateTaskMutation.mutate({ id, taskId: editingTaskId, data: taskData }, {
        onSuccess,
        onError: () => toast({ title: 'Görev güncellenemedi', variant: 'destructive' }),
      });
      return;
    }
    createTaskMutation.mutate({ id, data: taskData }, {
      onSuccess,
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function openTaskEditor(task?: typeof allTasks[number]) {
    setEditingTaskId(task?.id ?? null);
    setTaskForm(task ? {
      title: task.title,
      description: task.description ?? '',
      priority: task.priority ?? 'medium',
      dueDate: task.dueDate ?? '',
      assignedTo: task.assignedTo ?? '',
      status: task.status,
    } : { title: '', description: '', priority: 'medium', dueDate: '', assignedTo: '', status: 'not_started' });
    setTaskDialogOpen(true);
  }

  function saveGeneralInformation() {
    updateOperationMutation.mutate({ id, data: {
      startDate: generalForm.startDate || undefined,
      endDate: generalForm.endDate || undefined,
      status: generalForm.status,
      assignedTo: generalForm.assignedTo || undefined,
      notes: generalForm.notes || undefined,
    } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetOperationQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
        qc.invalidateQueries({ queryKey: getListOperationActivityQueryKey(id) });
        setGeneralEditOpen(false);
        toast({ title: 'Genel bilgiler kaydedildi' });
      },
      onError: () => toast({ title: 'Kayıt hatası', variant: 'destructive' }),
    });
  }

  async function handleCreateDocument() {
    if (!documentFile) { toast({ title: 'Dosya seçin', variant: 'destructive' }); return; }
    if (documentFile.size > 25 * 1024 * 1024) { toast({ title: 'Dosya çok büyük', description: 'En fazla 25 MB yükleyebilirsiniz.', variant: 'destructive' }); return; }
    try {
      const objectPath = await uploadFile(documentFile, await getToken());
      createDocumentMutation.mutate({ id, data: {
        title: documentTitle.trim() || documentFile.name,
        documentType,
        objectPath,
        fileMimeType: documentFile.type || undefined,
        fileSize: documentFile.size,
      } }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListOperationDocumentsQueryKey(id) });
          qc.invalidateQueries({ queryKey: getListOperationActivityQueryKey(id) });
          setDocumentDialogOpen(false);
          setDocumentFile(null); setDocumentTitle(''); setDocumentType('other');
          toast({ title: 'Belge eklendi' });
        },
        onError: () => toast({ title: 'Belge kaydedilemedi', variant: 'destructive' }),
      });
    } catch {
      toast({ title: 'Dosya yüklenemedi', variant: 'destructive' });
    }
  }

  function deleteDocument(documentId: number) {
    if (!confirm('Bu belgeyi silmek istiyor musunuz?')) return;
    deleteDocumentMutation.mutate({ id, documentId }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListOperationTasksQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListOperationDocumentsQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListOperationActivityQueryKey(id) });
        toast({ title: 'Belge silindi' });
      },
      onError: () => toast({ title: 'Belge silinemedi', variant: 'destructive' }),
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
    setAssignmentWarnings([]);
    try {
      const assignment = await customFetch<{ warnings?: string[] }>(`${API_BASE}/field/operations/${id}/assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guideName: guideForm.guideName || undefined,
          guidePhone: guideForm.guidePhone || undefined,
          assignedGuideUserId: guideForm.assignedGuideUserId ?? null,
          driverName: guideForm.driverName || undefined,
          driverPhone: guideForm.driverPhone || undefined,
          vehiclePlate: guideForm.vehiclePlate.trim().toUpperCase() || undefined,
          // Phase 2C: canonical Resource assignment, independent of the
          // fields above. Only sent when the user can actually assign
          // personnel — omitting the keys entirely (rather than sending
          // null) means the backend leaves any existing assignment
          // untouched for users without operations.assign.
          ...(canAssignPersonnel ? {
            guideResourceId: guideForm.guideResourceId,
            driverResourceId: guideForm.driverResourceId,
          } : {}),
        }),
      });
      await new Promise<void>((resolve, reject) => {
        updateOperationMutation.mutate({ id, data: {
          emergencyContact1Name: guideForm.emergencyContact1Name || undefined,
          emergencyContact1Phone: guideForm.emergencyContact1Phone || undefined,
          emergencyContact2Name: guideForm.emergencyContact2Name || undefined,
          emergencyContact2Phone: guideForm.emergencyContact2Phone || undefined,
        } }, {
          onSuccess: () => resolve(),
          onError: () => reject(new Error('Acil irtibat bilgileri kaydedilemedi')),
        });
      });
      const warnings = assignment.warnings ?? [];
      setAssignmentWarnings(warnings);
      qc.invalidateQueries({ queryKey: getGetOperationQueryKey(id) });
      qc.invalidateQueries({ queryKey: getListOperationsQueryKey() });
      qc.invalidateQueries({ queryKey: getListOperationActivityQueryKey(id) });
      if (warnings.length) {
        toast({ title: 'Atama kaydedildi — çakışma uyarısı', description: warnings[0], variant: 'destructive' });
      } else {
        toast({ title: 'Rehber / Şoför bilgileri kaydedildi' });
      }
      setGuideEditOpen(false);
    } catch (error) {
      toast({
        title: 'Atama kaydedilemedi',
        description: error instanceof Error ? error.message : 'Lütfen tekrar deneyin.',
        variant: 'destructive',
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
        receiptTime: receiptForm.receiptTime || undefined,
        taxAmount: receiptForm.taxAmount ? parseFloat(receiptForm.taxAmount) : undefined,
        taxRate: receiptForm.taxRate ? parseFloat(receiptForm.taxRate) : undefined,
        documentNumber: receiptForm.documentNumber || undefined,
        paymentMethod: receiptForm.paymentMethod || undefined,
        category: receiptForm.category || undefined,
        guideNote: receiptForm.guideNote || undefined,
        photoObjectPath,
        ocrRawResult: ocrRawResult ?? undefined,
      },
    }, {
      onSuccess: (created) => {
        if (photoUploadError || (!photoObjectPath && receiptPhoto)) {
          toast({ title: 'Makbuz eklendi', description: 'Fotoğraf yüklenemedi; makbuz fotoğrafsız kaydedildi.', variant: 'default' });
        } else {
          toast({ title: 'Makbuz eklendi' });
        }
        if (created?.possibleDuplicateOf) {
          toast({
            title: 'Olası tekrar',
            description: `Bu belge daha önce yüklenmiş olabilir (Makbuz #${created.possibleDuplicateOf}).`,
          });
        }
        qc.invalidateQueries({ queryKey: getListOperationReceiptsQueryKey(id) });
        setReceiptDialogOpen(false);
        setReceiptForm(EMPTY_RECEIPT_FORM);
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
    setOcrRawResult(null);
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

      // Remaining string fields — same "fill if empty, else flag conflict" rule.
      const stringFields: Array<[keyof ReceiptForm, string | null]> = [
        ['receiptTime', result.receiptTime],
        ['documentNumber', result.invoiceNumber],
        ['paymentMethod', result.paymentMethod],
        ['category', result.expenseCategory],
      ];
      for (const [field, ocrValue] of stringFields) {
        if (!ocrValue) continue;
        if (!receiptForm[field]) {
          newForm[field] = ocrValue;
        } else if (receiptForm[field] !== ocrValue) {
          conflicts[field] = ocrValue;
        }
      }

      // Tax amount (numeric)
      if (result.taxAmount != null) {
        const strVal = String(result.taxAmount);
        if (!receiptForm.taxAmount) {
          newForm.taxAmount = strVal;
        } else if (receiptForm.taxAmount !== strVal) {
          conflicts.taxAmount = strVal;
        }
      }

      setReceiptForm(newForm);
      setOcrConflicts(conflicts);
      setOcrRawResult(result);
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

      <OperationDomainWorkspace operationId={id} />

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

      {/* ── General information ────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4 text-muted-foreground" />Genel Bilgiler</CardTitle>
            {canEdit && <Button variant="outline" size="sm" onClick={() => setGeneralEditOpen(true)} className="gap-1.5"><Pencil className="w-3.5 h-3.5" />Düzenle</Button>}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {opLoading ? <Skeleton className="h-16 w-full" /> : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground mb-1">Tarih</p><p>{formatDate(operation?.startDate)}{operation?.endDate ? ` → ${formatDate(operation.endDate)}` : ''}</p></div>
              <div><p className="text-xs text-muted-foreground mb-1">Durum</p><Badge variant="secondary">{OPERATION_STATUS_LABELS[operation?.status ?? ''] ?? operation?.status}</Badge></div>
              <div><p className="text-xs text-muted-foreground mb-1">Operasyon Sorumlusu</p><p>{operation?.assignedTo || <span className="italic text-muted-foreground">Atanmadı</span>}</p></div>
              {operation?.notes && <div className="sm:col-span-3 pt-1 border-t"><p className="text-xs text-muted-foreground mb-1">Notlar</p><p className="whitespace-pre-wrap">{operation.notes}</p></div>}
            </div>
          )}
        </CardContent>
      </Card>

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
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openTaskEditor()} data-testid="button-add-task">
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
                    {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[task.priority ?? 'medium'] ?? 'bg-gray-100 text-gray-600'}`}>{PRIORITY_LABELS[task.priority ?? 'medium']}</span>
                      <span className="text-xs text-muted-foreground">{TASK_STATUS_LABELS[task.status] ?? task.status}</span>
                      {task.dueDate && <span className="text-xs text-muted-foreground">Son: {formatDate(task.dueDate)}</span>}
                      {task.assignedTo && <span className="text-xs text-muted-foreground">Sorumlu: {task.assignedTo}</span>}
                    </div>
                  </div>
                  {canEdit && <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" onClick={() => openTaskEditor(task)} aria-label="Görevi düzenle"><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0" onClick={() => handleDeleteTask(task.id)} data-testid={`button-delete-task-${task.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Documents card ─────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4 text-muted-foreground" />Operasyon Belgeleri</CardTitle>{(documents ?? []).length > 0 && <Badge variant="secondary">{documents?.length}</Badge>}</div>
            {canEdit && <Button size="sm" variant="outline" onClick={() => setDocumentDialogOpen(true)} className="gap-1.5"><Upload className="w-3.5 h-3.5" />Belge Ekle</Button>}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {documentsLoading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : (documents ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-5">Henüz belge eklenmemiş.</p>
          ) : <div className="space-y-2">{documents?.map(document => (
            <div key={document.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <FileText className="w-5 h-5 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{document.title}</p><p className="text-xs text-muted-foreground">{document.documentType} · {formatDate(document.createdAt)}</p></div>
              <Button asChild size="icon" variant="ghost" className="h-8 w-8" aria-label="Belgeyi aç"><a href={getStorageObjectUrl(document.objectPath)} target="_blank" rel="noreferrer"><ExternalLink className="w-3.5 h-3.5" /></a></Button>
              {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteDocument(document.id)} aria-label="Belgeyi sil"><Trash2 className="w-3.5 h-3.5" /></Button>}
            </div>
          ))}</div>}
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
                      {r.ocrStatus === 'processed' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium leading-none">OCR Okundu</span>
                      )}
                      {r.ocrStatus === 'failed' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium leading-none">OCR Başarısız</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                      {r.supplierName && <p>🏪 {r.supplierName}</p>}
                      {r.receiptDate && <p>📅 {r.receiptDate}{r.receiptTime ? ` ${r.receiptTime}` : ''}</p>}
                      {r.category && <p>🏷️ {r.category}</p>}
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
                          className="gap-2"
                          onClick={() => openReceiptDetail(r)}
                          data-testid={`button-detail-receipt-${r.id}`}
                        >
                          <FileText className="w-3.5 h-3.5" />Detay / Düzenle
                        </DropdownMenuItem>
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

      {/* ── Permanent activity feed ────────────────────────────────────────── */}
      <Card className="mb-4">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4 text-muted-foreground" />Operasyon Geçmişi</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {activityLoading ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div> : (activity ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-5">Bu operasyon için henüz geçmiş kaydı bulunmuyor.</p>
          ) : <div className="space-y-3">{activity?.map(item => (
            <div key={item.id} className="flex gap-3 text-sm">
              <div className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
              <div><p className="font-medium">{item.description || item.eventType}</p><p className="text-xs text-muted-foreground">{item.actorName ? `${item.actorName} · ` : ''}{new Date(item.createdAt).toLocaleString('tr-TR')}</p></div>
            </div>
          ))}</div>}
        </CardContent>
      </Card>

      {/* ── General information edit dialog ───────────────────────────────── */}
      <Dialog open={generalEditOpen} onOpenChange={setGeneralEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Genel Bilgileri Düzenle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-muted-foreground mb-1 block">Başlangıç</label><Input type="date" value={generalForm.startDate} onChange={e => setGeneralForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Bitiş</label><Input type="date" value={generalForm.endDate} onChange={e => setGeneralForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Durum</label><Select value={generalForm.status} onValueChange={v => setGeneralForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(OPERATION_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Operasyon Sorumlusu</label><Input value={generalForm.assignedTo} onChange={e => setGeneralForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Ad Soyad" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Operasyon Notları</label><Textarea value={generalForm.notes} onChange={e => setGeneralForm(f => ({ ...f, notes: e.target.value }))} rows={4} placeholder="Planlama ve koordinasyon notları..." /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setGeneralEditOpen(false)}>İptal</Button><Button onClick={saveGeneralInformation} disabled={updateOperationMutation.isPending}>{updateOperationMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Document upload dialog ─────────────────────────────────────────── */}
      <Dialog open={documentDialogOpen} onOpenChange={open => {
        setDocumentDialogOpen(open);
        if (!open) { setDocumentFile(null); setDocumentTitle(''); setDocumentType('other'); }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Operasyon Belgesi Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs text-muted-foreground mb-1 block">Belge Türü</label><Select value={documentType} onValueChange={setDocumentType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="itinerary">Program / Rota</SelectItem><SelectItem value="voucher">Voucher</SelectItem><SelectItem value="contract">Sözleşme</SelectItem><SelectItem value="insurance">Sigorta</SelectItem><SelectItem value="other">Diğer</SelectItem></SelectContent></Select></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Başlık</label><Input value={documentTitle} onChange={e => setDocumentTitle(e.target.value)} placeholder={documentFile?.name ?? 'Belge başlığı'} /></div>
            <div>
              <input ref={documentInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={e => setDocumentFile(e.target.files?.[0] ?? null)} />
              <Button type="button" variant="outline" className="w-full gap-2" onClick={() => documentInputRef.current?.click()}><Upload className="w-4 h-4" />{documentFile ? documentFile.name : 'PDF veya görsel seç'}</Button>
              <p className="text-xs text-muted-foreground mt-1.5">PDF, JPG, PNG veya WEBP · en fazla 25 MB</p>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDocumentDialogOpen(false)}>İptal</Button><Button onClick={handleCreateDocument} disabled={!documentFile || createDocumentMutation.isPending}>{createDocumentMutation.isPending ? 'Yükleniyor...' : 'Belgeyi Kaydet'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Task dialog ────────────────────────────────────────────────────── */}
      <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTaskId ? 'Görevi Düzenle' : 'Görev Ekle'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Başlık *</label><Input value={taskForm.title} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} placeholder="Görev başlığı..." data-testid="input-task-title" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Açıklama</label><Textarea value={taskForm.description} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} placeholder="Görev detayları..." rows={2} /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Öncelik</label>
              <Select value={taskForm.priority} onValueChange={v => setTaskForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger data-testid="select-task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PRIORITY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Son Tarih</label><Input type="date" value={taskForm.dueDate} onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))} data-testid="input-task-dueDate" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Sorumlu</label><Input value={taskForm.assignedTo} onChange={e => setTaskForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Ad Soyad" data-testid="input-task-assignedTo" /></div>
            {editingTaskId && <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Durum</label><Select value={taskForm.status} onValueChange={v => setTaskForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTaskDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateTask} disabled={createTaskMutation.isPending || updateTaskMutation.isPending} data-testid="button-save-task">
              {createTaskMutation.isPending || updateTaskMutation.isPending ? 'Kaydediliyor...' : editingTaskId ? 'Kaydet' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Guide edit dialog ──────────────────────────────────────────────── */}
      <Dialog open={guideEditOpen} onOpenChange={open => { setGuideEditOpen(open); if (!open) setAssignmentWarnings([]); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Rehber & Şoför Bilgileri</DialogTitle></DialogHeader>
          <div className="space-y-5">
            {/* ── Guide ───────────────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />Rehber
              </p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Rehber Seç</label>
                  <Select
                    value={guideSelectValue}
                    onValueChange={handleGuideSelect}
                  >
                    <SelectTrigger data-testid="select-assigned-guide-user">
                      <SelectValue placeholder="Rehber seç..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Atanmadı —</SelectItem>
                      {(guideProfiles ?? []).map(p => (
                        <SelectItem key={p.clerkUserId} value={p.clerkUserId}>
                          {p.name || p.email}
                        </SelectItem>
                      ))}
                      <SelectItem value="__manual__">Kayıtlı olmayan birini elle gir…</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Ad Soyad</label>
                    <Input
                      value={guideForm.guideName}
                      onChange={e => setGuideForm(f => ({ ...f, guideName: e.target.value }))}
                      placeholder={guideIsManual ? 'Rehber adı' : 'Rehber seçin'}
                      readOnly={!guideIsManual}
                      className={readOnlyFieldClass(!guideIsManual)}
                      data-testid="input-guide-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">
                      Telefon
                      {guideAccountSelected && <span className="ml-1 normal-case font-normal">(hesapta kayıtlı değil)</span>}
                    </label>
                    <Input
                      value={guideForm.guidePhone}
                      onChange={e => setGuideForm(f => ({ ...f, guidePhone: e.target.value }))}
                      placeholder="+90 5xx..."
                      data-testid="input-guide-phone"
                    />
                  </div>
                </div>
                {guideAccountSelected && (
                  <p className="text-xs text-muted-foreground">
                    Ad, seçilen kullanıcı hesabından geliyor. Telefon numarası hesapta tutulmadığı için elle girilir.
                  </p>
                )}
              </div>
            </div>

            {/* ── Driver & vehicle ────────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5" />Şoför & Araç
              </p>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Şoför Seç</label>
                  <Select value={driverSelectValue} onValueChange={handleDriverSelect}>
                    <SelectTrigger data-testid="select-driver-supplier">
                      <SelectValue placeholder="Şoför seç..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Atanmadı —</SelectItem>
                      {(driverSuppliers ?? []).map(s => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {(s.contactPerson || s.name)}{s.vehiclePlate ? ` · ${s.vehiclePlate}` : ''}
                        </SelectItem>
                      ))}
                      <SelectItem value="__manual__">Kayıtlı olmayan birini elle gir…</SelectItem>
                    </SelectContent>
                  </Select>
                  {(driverSuppliers ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Kayıtlı aktif şoför yok — Tedarikçiler → Şoförler sekmesinden ekleyebilirsiniz.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Ad Soyad</label>
                    <Input
                      value={guideForm.driverName}
                      onChange={e => setGuideForm(f => ({ ...f, driverName: e.target.value }))}
                      placeholder={driverIsManual ? 'Şoför adı' : 'Şoför seçin'}
                      readOnly={!driverIsManual}
                      className={readOnlyFieldClass(!driverIsManual)}
                      data-testid="input-driver-name"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Telefon</label>
                    <Input
                      value={guideForm.driverPhone}
                      onChange={e => setGuideForm(f => ({ ...f, driverPhone: e.target.value }))}
                      placeholder="+90 5xx..."
                      readOnly={!driverIsManual}
                      className={readOnlyFieldClass(!driverIsManual)}
                      data-testid="input-driver-phone"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground mb-1 block">Plaka</label>
                    <Input
                      value={guideForm.vehiclePlate}
                      onChange={e => setGuideForm(f => ({ ...f, vehiclePlate: e.target.value }))}
                      placeholder="35 AA 000"
                      readOnly={!driverIsManual}
                      className={`font-mono ${readOnlyFieldClass(!driverIsManual)}`}
                      data-testid="input-vehicle-plate"
                    />
                  </div>
                </div>
                {driverSupplierSelected && (
                  <p className="text-xs text-muted-foreground">
                    Bilgiler kayıtlı şoför kaydından geliyor. Değiştirmek için Tedarikçiler → Şoförler sekmesini kullanın.
                  </p>
                )}
              </div>
            </div>

            {/* ── Canonical Personnel (Phase 2C) ───────────────────────────
                 Independent of the Rehber Seç / Şoför Seç pickers above:
                 those manage assignedGuideUserId (login access) and the
                 supplier-based driver record respectively. This links the
                 operation to the canonical Resource identity from Personel
                 (Phase 2D.1/2D.2) instead — a separate fact from either,
                 never inferred from name/text. Hidden entirely for users
                 without operations.assign, matching the server-side gate. */}
            {canAssignPersonnel && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <IdCard className="w-3.5 h-3.5" />Personel Kaydı (Sistem Kimliği)
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  Personel sayfasındaki kayıtlı rehber/şoför kimliğiyle eşleştirir. Yukarıdaki hesap/şoför bilgilerinden bağımsızdır.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Rehber Personeli</label>
                    <Select
                      value={guideForm.guideResourceId != null ? String(guideForm.guideResourceId) : '__none__'}
                      onValueChange={v => setGuideForm(f => ({ ...f, guideResourceId: v === '__none__' ? null : Number(v) }))}
                    >
                      <SelectTrigger data-testid="select-guide-resource">
                        <SelectValue placeholder="Personel seç..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Bağlantı yok —</SelectItem>
                        {(guideResources ?? []).map(r => (
                          <SelectItem key={r.id} value={String(r.id)}>{r.name}{r.company ? ` · ${r.company}` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Şoför Personeli</label>
                    <Select
                      value={guideForm.driverResourceId != null ? String(guideForm.driverResourceId) : '__none__'}
                      onValueChange={v => setGuideForm(f => ({ ...f, driverResourceId: v === '__none__' ? null : Number(v) }))}
                    >
                      <SelectTrigger data-testid="select-driver-resource">
                        <SelectValue placeholder="Personel seç..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Bağlantı yok —</SelectItem>
                        {(driverResources ?? []).map(r => (
                          <SelectItem key={r.id} value={String(r.id)}>{r.name}{r.company ? ` · ${r.company}` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* ── Emergency contacts ──────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />Acil İrtibat
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
                <div><label className="text-xs text-muted-foreground mb-1 block">1. Kişi Adı</label><Input value={guideForm.emergencyContact1Name} onChange={e => setGuideForm(f => ({ ...f, emergencyContact1Name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-emergency1-name" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">1. Kişi Tel.</label><Input value={guideForm.emergencyContact1Phone} onChange={e => setGuideForm(f => ({ ...f, emergencyContact1Phone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-emergency1-phone" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">2. Kişi Adı</label><Input value={guideForm.emergencyContact2Name} onChange={e => setGuideForm(f => ({ ...f, emergencyContact2Name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-emergency2-name" /></div>
                <div><label className="text-xs text-muted-foreground mb-1 block">2. Kişi Tel.</label><Input value={guideForm.emergencyContact2Phone} onChange={e => setGuideForm(f => ({ ...f, emergencyContact2Phone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-emergency2-phone" /></div>
              </div>
            </div>
            {assignmentWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />Araç çakışma uyarısı</p>
                {assignmentWarnings.map(warning => <p key={warning} className="mt-1 text-xs">{warning}</p>)}
              </div>
            )}
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

            {/* ── Verified data (OCR-extracted, editable before save) ─────── */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Saat</label>
                <Input type="time" value={receiptForm.receiptTime} onChange={e => setReceiptForm(f => ({ ...f, receiptTime: e.target.value }))} data-testid="input-receipt-time" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fiş / Fatura No</label>
                <Input value={receiptForm.documentNumber} onChange={e => setReceiptForm(f => ({ ...f, documentNumber: e.target.value }))} placeholder="EFT2024/1234" data-testid="input-receipt-document-number" />
                {ocrConflicts.documentNumber && (
                  <button type="button" className="text-xs text-primary underline mt-1" onClick={() => { setReceiptForm(f => ({ ...f, documentNumber: ocrConflicts.documentNumber! })); setOcrConflicts(c => { const n = { ...c }; delete n.documentNumber; return n; }); }}>OCR: {ocrConflicts.documentNumber} — Kabul Et</button>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">KDV Tutarı</label>
                <Input type="number" step="0.01" value={receiptForm.taxAmount} onChange={e => setReceiptForm(f => ({ ...f, taxAmount: e.target.value }))} placeholder="0.00" data-testid="input-receipt-tax-amount" />
                {ocrConflicts.taxAmount && (
                  <button type="button" className="text-xs text-primary underline mt-1" onClick={() => { setReceiptForm(f => ({ ...f, taxAmount: ocrConflicts.taxAmount! })); setOcrConflicts(c => { const n = { ...c }; delete n.taxAmount; return n; }); }}>OCR: {ocrConflicts.taxAmount} — Kabul Et</button>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">KDV Oranı (%)</label>
                <Input type="number" step="1" value={receiptForm.taxRate} onChange={e => setReceiptForm(f => ({ ...f, taxRate: e.target.value }))} placeholder="20" data-testid="input-receipt-tax-rate" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Ödeme Yöntemi</label>
                <Input value={receiptForm.paymentMethod} onChange={e => setReceiptForm(f => ({ ...f, paymentMethod: e.target.value }))} placeholder="Nakit, Kredi Kartı..." data-testid="input-receipt-payment-method" />
                {ocrConflicts.paymentMethod && (
                  <button type="button" className="text-xs text-primary underline mt-1" onClick={() => { setReceiptForm(f => ({ ...f, paymentMethod: ocrConflicts.paymentMethod! })); setOcrConflicts(c => { const n = { ...c }; delete n.paymentMethod; return n; }); }}>OCR: {ocrConflicts.paymentMethod} — Kabul Et</button>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Kategori</label>
                <Input value={receiptForm.category} onChange={e => setReceiptForm(f => ({ ...f, category: e.target.value }))} placeholder="Yemek, Ulaşım..." data-testid="input-receipt-category" />
                {ocrConflicts.category && (
                  <button type="button" className="text-xs text-primary underline mt-1" onClick={() => { setReceiptForm(f => ({ ...f, category: ocrConflicts.category! })); setOcrConflicts(c => { const n = { ...c }; delete n.category; return n; }); }}>OCR: {ocrConflicts.category} — Kabul Et</button>
                )}
              </div>
            </div>

            {/* ── Guide note ────────────────────────────────────────────── */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Açıklama / Rehber Notu</label>
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

      {/* ── Receipt detail / edit dialog ─────────────────────────────────── */}
      {/* ORIGINAL DOCUMENT (photo) / OCR RESULT (raw, read-only) / VERIFIED DATA
          (editable fields below) are kept visually distinct, per spec. */}
      <Dialog open={receiptDetailTarget !== null} onOpenChange={open => { if (!open) setReceiptDetailTarget(null); }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Makbuz Detayı</DialogTitle></DialogHeader>
          {receiptDetailTarget && (
            <div className="space-y-3">
              {/* Original document */}
              {receiptDetailTarget.photoObjectPath ? (
                <AuthenticatedImage
                  objectPath={receiptDetailTarget.photoObjectPath}
                  alt="Orijinal makbuz"
                  className="w-full h-40 object-cover rounded-lg border"
                />
              ) : (
                <div className="w-full h-20 rounded-lg border border-dashed flex items-center justify-center text-xs text-muted-foreground">
                  Fotoğraf yok
                </div>
              )}

              {/* Raw OCR result — read-only, kept distinct from verified data below */}
              {receiptDetailTarget.ocrRawResult != null && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground select-none">OCR Ham Sonucu</summary>
                  <pre className="mt-1.5 p-2 rounded-md bg-muted overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(receiptDetailTarget.ocrRawResult, null, 2)}
                  </pre>
                </details>
              )}

              {/* Verified data — editable */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tutar *</label>
                  <Input type="number" step="0.01" min="0" value={receiptEditForm.amount} onChange={e => setReceiptEditForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-edit-receipt-amount" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Para Birimi</label>
                  <Select value={receiptEditForm.currency} onValueChange={v => setReceiptEditForm(f => ({ ...f, currency: v }))}>
                    <SelectTrigger data-testid="select-edit-receipt-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TRY">TRY ₺</SelectItem>
                      <SelectItem value="USD">USD $</SelectItem>
                      <SelectItem value="EUR">EUR €</SelectItem>
                      <SelectItem value="GBP">GBP £</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Tedarikçi / Dükkan</label>
                  <Input value={receiptEditForm.supplierName} onChange={e => setReceiptEditForm(f => ({ ...f, supplierName: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tarih</label>
                  <Input type="date" value={receiptEditForm.receiptDate} onChange={e => setReceiptEditForm(f => ({ ...f, receiptDate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Saat</label>
                  <Input type="time" value={receiptEditForm.receiptTime} onChange={e => setReceiptEditForm(f => ({ ...f, receiptTime: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Fiş / Fatura No</label>
                  <Input value={receiptEditForm.documentNumber} onChange={e => setReceiptEditForm(f => ({ ...f, documentNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">KDV Tutarı</label>
                  <Input type="number" step="0.01" value={receiptEditForm.taxAmount} onChange={e => setReceiptEditForm(f => ({ ...f, taxAmount: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">KDV Oranı (%)</label>
                  <Input type="number" step="1" value={receiptEditForm.taxRate} onChange={e => setReceiptEditForm(f => ({ ...f, taxRate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Ödeme Yöntemi</label>
                  <Input value={receiptEditForm.paymentMethod} onChange={e => setReceiptEditForm(f => ({ ...f, paymentMethod: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Kategori</label>
                  <Input value={receiptEditForm.category} onChange={e => setReceiptEditForm(f => ({ ...f, category: e.target.value }))} data-testid="input-edit-receipt-category" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Açıklama</label>
                  <Textarea value={receiptEditForm.guideNote} onChange={e => setReceiptEditForm(f => ({ ...f, guideNote: e.target.value }))} rows={2} />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptDetailTarget(null)}>İptal</Button>
            <Button onClick={saveReceiptEdit} disabled={isSavingReceiptEdit} data-testid="button-save-receipt-edit">
              {isSavingReceiptEdit ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

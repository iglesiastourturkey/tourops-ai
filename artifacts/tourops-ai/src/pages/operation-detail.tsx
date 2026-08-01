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
  useListOperationReceipts, useCreateOperationReceipt,
  useGetAgencySettings, useGetTour, useListTourDays, useGetCustomer,
} from '@workspace/api-client-react';
import {
  getGetOperationQueryKey, getListOperationTasksQueryKey, getListOperationReceiptsQueryKey,
  getGetTourQueryKey, getListTourDaysQueryKey, getGetCustomerQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Plus, Trash2, User, Car, AlertTriangle,
  FileDown, Receipt, Camera, AlertCircle,
} from 'lucide-react';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, TASK_STATUS_LABELS, formatDate } from '@/lib/labels';
import { uploadFile, getStorageObjectUrl } from '@/lib/storage-service';
import { generateOperationPdf } from '@/lib/operation-pdf-export';

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

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'medium', dueDate: '', assignedTo: '' });

  const [guideEditOpen, setGuideEditOpen] = useState(false);
  const [guideForm, setGuideForm] = useState<GuideForm>({
    guideName: '', guidePhone: '', driverName: '', driverPhone: '', vehiclePlate: '',
    emergencyContact1Name: '', emergencyContact1Phone: '',
    emergencyContact2Name: '', emergencyContact2Phone: '',
  });
  const [isSavingGuide, setIsSavingGuide] = useState(false);

  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({
    amount: '', currency: 'TRY', supplierName: '', receiptDate: '', guideNote: '',
  });
  const [receiptPhoto, setReceiptPhoto] = useState<File | null>(null);
  const [receiptPhotoPreview, setReceiptPhotoPreview] = useState<string | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
  const { data: agencySettings } = useGetAgencySettings();
  const tourId = operation?.tourId ?? null;
  const customerId = operation?.customerId ?? null;
  const { data: tour } = useGetTour(tourId!, { query: { enabled: !!tourId, queryKey: getGetTourQueryKey(tourId!) } });
  const { data: tourDays } = useListTourDays(tourId!, { query: { enabled: !!tourId, queryKey: getListTourDaysQueryKey(tourId!) } });
  const { data: customer } = useGetCustomer(customerId!, { query: { enabled: !!customerId, queryKey: getGetCustomerQueryKey(customerId!) } });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateTaskMutation = useUpdateOperationTask();
  const createTaskMutation = useCreateOperationTask();
  const deleteTaskMutation = useDeleteOperationTask();
  const updateOperationMutation = useUpdateOperation();
  const createReceiptMutation = useCreateOperationReceipt();

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
  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setReceiptPhoto(file);
    if (receiptPhotoPreview) URL.revokeObjectURL(receiptPhotoPreview);
    setReceiptPhotoPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleCreateReceipt() {
    const amountNum = parseFloat(receiptForm.amount);
    if (!receiptForm.amount || isNaN(amountNum)) {
      toast({ title: 'Tutar zorunludur', variant: 'destructive' }); return;
    }
    setIsUploadingReceipt(true);
    try {
      let photoObjectPath: string | undefined;
      if (receiptPhoto) {
        const token = await getToken();
        photoObjectPath = await uploadFile(receiptPhoto, token);
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
          toast({ title: 'Makbuz eklendi' });
          qc.invalidateQueries({ queryKey: getListOperationReceiptsQueryKey(id) });
          setReceiptDialogOpen(false);
          setReceiptForm({ amount: '', currency: 'TRY', supplierName: '', receiptDate: '', guideNote: '' });
          setReceiptPhoto(null);
          setReceiptPhotoPreview(null);
        },
        onError: () => toast({ title: 'Makbuz eklenemedi', variant: 'destructive' }),
      });
    } catch {
      toast({ title: 'Fotoğraf yüklenemedi', description: 'Lütfen tekrar deneyin.', variant: 'destructive' });
    } finally {
      setIsUploadingReceipt(false);
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
  const allReceipts = receipts ?? [];
  const missingPhotoCount = allReceipts.filter(r => !r.photoObjectPath).length;

  // ── Not found state ───────────────────────────────────────────────────────
  if (!opLoading && !operation) {
    return (
      <AppShell title="Operasyon Bulunamadı">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/operations"><Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="w-4 h-4" />Operasyonlar</Button></Link>
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
            <ArrowLeft className="w-4 h-4" />Operasyonlar
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
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 min-w-[120px]">
                <span className="text-xs text-muted-foreground">Tamamlanma</span>
                <div className="flex items-center gap-2">
                  <Progress value={operation.completionRate} className="h-2 w-24" />
                  <span className="text-sm font-medium">%{Math.round(operation.completionRate)}</span>
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
            <Button variant="outline" size="sm" onClick={() => setGuideEditOpen(true)} data-testid="button-edit-guide">
              Düzenle
            </Button>
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
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setTaskDialogOpen(true)} data-testid="button-add-task">
              <Plus className="w-3.5 h-3.5" />Görev Ekle
            </Button>
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
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0" onClick={() => handleDeleteTask(task.id)} data-testid={`button-delete-task-${task.id}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
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
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setReceiptDialogOpen(true)}
              data-testid="button-add-receipt"
            >
              <Plus className="w-3.5 h-3.5" />Makbuz Ekle
            </Button>
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

      {/* ── Receipt add dialog ─────────────────────────────────────────────── */}
      <Dialog open={receiptDialogOpen} onOpenChange={v => { setReceiptDialogOpen(v); if (!v) { setReceiptPhoto(null); setReceiptPhotoPreview(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Makbuz Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Tutar *</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={receiptForm.amount}
                  onChange={e => setReceiptForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  data-testid="input-receipt-amount"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Para Birimi</label>
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
            <div><label className="text-xs text-muted-foreground mb-1 block">Tedarikçi / Dükkan</label><Input value={receiptForm.supplierName} onChange={e => setReceiptForm(f => ({ ...f, supplierName: e.target.value }))} placeholder="Tedarikçi adı" data-testid="input-receipt-supplier" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Tarih</label><Input type="date" value={receiptForm.receiptDate} onChange={e => setReceiptForm(f => ({ ...f, receiptDate: e.target.value }))} data-testid="input-receipt-date" /></div>
            <div><label className="text-xs text-muted-foreground mb-1 block">Rehber Notu</label><Textarea value={receiptForm.guideNote} onChange={e => setReceiptForm(f => ({ ...f, guideNote: e.target.value }))} rows={2} placeholder="Makbuz hakkında not..." data-testid="textarea-receipt-note" /></div>

            {/* Photo upload */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Makbuz Fotoğrafı</label>
              {receiptPhotoPreview ? (
                <div className="relative">
                  <img src={receiptPhotoPreview} alt="Önizleme" className="w-full h-32 object-cover rounded-lg border" />
                  <button
                    onClick={() => { setReceiptPhoto(null); setReceiptPhotoPreview(null); if (photoInputRef.current) photoInputRef.current.value = ''; }}
                    className="absolute top-1 right-1 bg-background/80 rounded-full p-1 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="w-full h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary/70 transition-colors"
                  data-testid="button-upload-photo"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-xs">Fotoğraf Seç</span>
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
                data-testid="input-receipt-photo"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateReceipt} disabled={isUploadingReceipt || createReceiptMutation.isPending} data-testid="button-save-receipt">
              {isUploadingReceipt ? 'Yükleniyor...' : createReceiptMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

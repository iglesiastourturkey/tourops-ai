import { OperationDomainWorkspace } from "@/components/OperationDomainWorkspace";
import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { FieldShell } from '@/components/FieldShell';
import { LocationShare } from '@/components/LocationShare';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch, useListResources, getListResourcesQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/usePermission';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import {
  AlertTriangle, Car, ChevronLeft, ClipboardList, User, Phone,
  CheckCircle2, Clock, RefreshCw, PlusCircle, Edit2, MapPin, FileText,
  MessageSquare, Zap,
} from 'lucide-react';
import {
  OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS,
  INCIDENT_SEVERITY_COLORS, INCIDENT_SEVERITY_LABELS,
  FIELD_NOTE_CATEGORY_LABELS, TASK_STATUS_LABELS, formatDate,
} from '@/lib/labels';

import { API_BASE } from '@/lib/api-base';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: string | null;
  completedAt: string | null;
}

interface Receipt {
  id: number;
  amount: number;
  currency: string;
  supplierName: string | null;
  receiptDate: string | null;
  reviewStatus: string;
}

interface FieldNote {
  id: number;
  noteText: string;
  category: string;
  authorName: string | null;
  createdAt: string;
}

interface IncidentRef {
  id: number;
  severity: string;
  title: string;
  status: string;
}

interface HistoryEntry {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  createdAt: string;
}

interface GuideOption {
  id: number;
  clerkUserId: string;
  name: string | null;
  email: string;
  todayOperationCount: number;
}

interface OperationDetail {
  id: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  guideName: string | null;
  guidePhone: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  assignedGuideUserId: string | null;
  // Phase 2C: canonical Personnel/Resource identity FK, independent of
  // assignedGuideUserId (login access).
  guideResourceId: number | null;
  driverResourceId: number | null;
  emergencyContact1Name: string | null;
  emergencyContact1Phone: string | null;
  emergencyContact2Name: string | null;
  emergencyContact2Phone: string | null;
  notes: string | null;
  completionRate: number;
  version: number;
  tourName: string | null;
  customerName: string | null;
  tasks: Task[];
  receipts: Receipt[];
  notes_list: FieldNote[];
  incidents: IncidentRef[];
  history: HistoryEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LIFECYCLE_ACTIONS: Record<string, { next: string; label: string; confirm: string; color: string }[]> = {
  planned: [
    { next: 'ready', label: 'Hazıra Al', confirm: 'Operasyonu hazır durumuna alıyorsunuz.', color: 'bg-blue-600 hover:bg-blue-700' },
  ],
  ready: [
    { next: 'started', label: 'Operasyonu Başlat', confirm: 'Operasyonu başlatmak istediğinizden emin misiniz?', color: 'bg-emerald-600 hover:bg-emerald-700' },
  ],
  active: [
    { next: 'started', label: 'Başlatıldı Olarak İşaretle', confirm: 'Operasyonu başlatıldı olarak işaretleyeceksiniz.', color: 'bg-emerald-600 hover:bg-emerald-700' },
    { next: 'completed', label: 'Operasyonu Tamamla', confirm: 'Operasyonu tamamlamak istediğinizden emin misiniz?', color: 'bg-blue-600 hover:bg-blue-700' },
  ],
  started: [
    { next: 'in_progress', label: 'Devam Ediyor', confirm: 'Operasyonu devam ediyor olarak işaretleyeceksiniz.', color: 'bg-teal-600 hover:bg-teal-700' },
    { next: 'delayed', label: 'Gecikme Bildir', confirm: 'Operasyonu gecikmiş olarak işaretleyeceksiniz.', color: 'bg-orange-500 hover:bg-orange-600' },
    { next: 'completed', label: 'Operasyonu Tamamla', confirm: 'Operasyonu tamamlamak istediğinizden emin misiniz?', color: 'bg-blue-600 hover:bg-blue-700' },
  ],
  in_progress: [
    { next: 'delayed', label: 'Gecikme Bildir', confirm: 'Operasyonu gecikmiş olarak işaretleyeceksiniz.', color: 'bg-orange-500 hover:bg-orange-600' },
    { next: 'completed', label: 'Operasyonu Tamamla', confirm: 'Operasyonu tamamlamak istediğinizden emin misiniz?', color: 'bg-blue-600 hover:bg-blue-700' },
  ],
  delayed: [
    { next: 'in_progress', label: 'Devam Ediyor', confirm: 'Gecikme kaldırılacak, operasyon devam ediyor olarak işaretlenecek.', color: 'bg-teal-600 hover:bg-teal-700' },
    { next: 'completed', label: 'Operasyonu Tamamla', confirm: 'Operasyonu tamamlamak istediğinizden emin misiniz?', color: 'bg-blue-600 hover:bg-blue-700' },
  ],
};

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === 'blocked') return <AlertTriangle className="w-4 h-4 text-red-500" />;
  if (status === 'in_progress') return <Zap className="w-4 h-4 text-blue-500" />;
  return <Clock className="w-4 h-4 text-gray-300" />;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FieldOperationDetailPage() {
  const [, params] = useRoute('/field/operations/:id');
  const id = params?.id;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { queueAction } = useOfflineQueue();
  const { isOnline } = useNetworkStatus();

  // Dialog states
  const [statusDialog, setStatusDialog] = useState<{ next: string; confirm: string } | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [assignDialog, setAssignDialog] = useState<'guide' | 'driver' | null>(null);
  const [noteDialog, setNoteDialog] = useState(false);
  const [taskDialog, setTaskDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);

  // Assignment form
  const [guideId, setGuideId] = useState('');
  const [guideName, setGuideName] = useState('');
  const [guidePhone, setGuidePhone] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  // Phase 2C: canonical Personnel/Resource assignment, independent of the
  // guideId (login account) / free-text fields above.
  const [guideResourceId, setGuideResourceId] = useState<number | null>(null);
  const [driverResourceId, setDriverResourceId] = useState<number | null>(null);
  const canAssignPersonnel = usePermission('operations', 'assign');

  // Note form
  const [noteText, setNoteText] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');

  // Task form
  const [taskTitle, setTaskTitle] = useState('');
  const [taskAssignedTo, setTaskAssignedTo] = useState('');

  const { data: op, isLoading, refetch } = useQuery<OperationDetail>({
    queryKey: ['field-op', id],
    queryFn: () => customFetch(`${API_BASE}/field/operations/${id}`),
    enabled: !!id,
  });

  const { data: guides = [] } = useQuery<GuideOption[]>({
    queryKey: ['field-guides'],
    queryFn: () => customFetch(`${API_BASE}/field/guides`),
    enabled: assignDialog === 'guide',
  });

  // Phase 2C: canonical GUIDE/DRIVER resources, independent of the
  // field-guides login list above and only fetched when the relevant
  // dialog is open and the user can actually assign personnel.
  const guideResourceParams = { type: 'GUIDE' as const, active: true };
  const { data: guideResources } = useListResources(guideResourceParams, {
    query: { enabled: assignDialog === 'guide' && canAssignPersonnel, queryKey: getListResourcesQueryKey(guideResourceParams) },
  });
  const driverResourceParams = { type: 'DRIVER' as const, active: true };
  const { data: driverResources } = useListResources(driverResourceParams, {
    query: { enabled: assignDialog === 'driver' && canAssignPersonnel, queryKey: getListResourcesQueryKey(driverResourceParams) },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ status, note }: { status: string; note?: string }) => {
      const body = { status, note, expectedVersion: op?.version };
      if (!isOnline) {
        await queueAction({
          url: `${API_BASE}/field/operations/${id}/status`, method: 'PATCH', body,
          type: 'status_update', label: `OPR-${id} durumunu güncelle`, operationId: op?.id, expectedVersion: op?.version,
        });
        return { queued: true };
      }
      return customFetch(`${API_BASE}/field/operations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: { queued?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['field-op', id] });
      qc.invalidateQueries({ queryKey: ['field-dashboard'] });
      setStatusDialog(null);
      setStatusNote('');
      toast({ title: data?.queued ? 'Durum senkronizasyon için bekliyor' : 'Durum güncellendi' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  const assignMutation = useMutation({
    mutationFn: (body: object) =>
      customFetch(`${API_BASE}/field/operations/${id}/assignments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (data: { warnings?: string[] }) => {
      qc.invalidateQueries({ queryKey: ['field-op', id] });
      qc.invalidateQueries({ queryKey: ['field-dashboard'] });
      setAssignDialog(null);
      if (data?.warnings?.length) {
        toast({ title: '⚠️ Çakışma Uyarısı', description: data.warnings[0], variant: 'destructive' });
      } else {
        toast({ title: 'Atama güncellendi' });
      }
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  const noteMutation = useMutation({
    mutationFn: async (body: { noteText: string; category: string }) => {
      if (!isOnline) {
        await queueAction({
          url: `${API_BASE}/field/operations/${id}/notes`, method: 'POST', body,
          type: 'field_note', label: `OPR-${id} saha notu`, operationId: op?.id,
        });
        return { queued: true };
      }
      return customFetch(`${API_BASE}/field/operations/${id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: { queued?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['field-op', id] });
      setNoteDialog(false);
      setNoteText('');
      setNoteCategory('general');
      toast({ title: data?.queued ? 'Not senkronizasyon için bekliyor' : 'Not eklendi' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  const taskMutation = useMutation({
    mutationFn: (body: { title: string; assignedTo?: string }) =>
      customFetch(`${API_BASE}/field/operations/${id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['field-op', id] });
      setTaskDialog(false);
      setTaskTitle('');
      setTaskAssignedTo('');
      toast({ title: 'Görev eklendi' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  const taskStatusMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: string }) => {
      const body = { status, expectedVersion: op?.version };
      if (!isOnline) {
        await queueAction({
          url: `${API_BASE}/field/operations/${id}/tasks/${taskId}`, method: 'PATCH', body,
          type: 'task_update', label: `OPR-${id} görev durumu`, operationId: op?.id, expectedVersion: op?.version,
        });
        return { queued: true };
      }
      return customFetch(`${API_BASE}/field/operations/${id}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: { queued?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['field-op', id] });
      if (data?.queued) toast({ title: 'Görev senkronizasyon için bekliyor' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  if (isLoading) {
    return (
      <FieldShell title="Operasyon Detayı">
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </FieldShell>
    );
  }

  if (!op) {
    return (
      <FieldShell title="Operasyon Detayı">
        <div className="text-center py-12">
          <p className="text-gray-400">Operasyon bulunamadı</p>
          <Link href="/field">
            <Button variant="outline" className="mt-4">Saha Paneline Dön</Button>
          </Link>
        </div>
      </FieldShell>
    );
  }

  const statusColor = OPERATION_STATUS_COLORS[op.status] ?? 'bg-gray-100 text-gray-600';
  const actions = LIFECYCLE_ACTIONS[op.status] ?? [];
  const completedTasks = op.tasks.filter(t => t.status === 'completed').length;
  const totalTasks = op.tasks.length;

  return (
    <FieldShell title={op.tourName ?? `OPR-${op.id}`}>
      {/* Back link */}
      <Link href="/field">
        <div className="flex items-center gap-1.5 text-sm text-blue-600 font-medium mb-4 -mt-1">
          <ChevronLeft className="w-4 h-4" />
          Saha Paneli
        </div>
      </Link>

      {/* Header */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1">
            <h1 className="font-bold text-base leading-tight">{op.tourName ?? `OPR-${op.id}`}</h1>
            {op.customerName && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3" /> {op.customerName}
              </p>
            )}
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold shrink-0 ${statusColor}`}>
            {OPERATION_STATUS_LABELS[op.status] ?? op.status}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-3">
          <MapPin className="w-3 h-3 shrink-0" />
          OPR-{op.id} · {formatDate(op.startDate)}
          {op.endDate && op.endDate !== op.startDate && ` – ${formatDate(op.endDate)}`}
        </div>
        {totalTasks > 0 && (
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Görev tamamlama</span>
              <span className="font-semibold text-gray-700">{completedTasks}/{totalTasks}</span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <OperationDomainWorkspace operationId={op.id} surface="field" />

      {/* Assignments */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-3">Atamalar</h2>
        <div className="space-y-3">
          {/* Guide */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-gray-400 font-medium">Rehber</p>
                {op.guideName ? (
                  <div>
                    <p className="text-sm font-semibold leading-tight">{op.guideName}</p>
                    {op.guidePhone && (
                      <a href={`tel:${op.guidePhone}`} className="text-xs text-blue-600 flex items-center gap-0.5">
                        <Phone className="w-3 h-3" /> {op.guidePhone}
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-orange-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Atanmamış
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setGuideId(op.assignedGuideUserId ?? '');
                setGuideName(op.guideName ?? '');
                setGuidePhone(op.guidePhone ?? '');
                setGuideResourceId(op.guideResourceId ?? null);
                setAssignDialog('guide');
              }}
              className="text-xs text-blue-600 font-medium border border-blue-200 rounded-lg px-2 py-1 shrink-0"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          </div>

          {/* Driver / Vehicle */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                <Car className="w-4 h-4 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-gray-400 font-medium">Şoför / Araç</p>
                {op.driverName || op.vehiclePlate ? (
                  <div>
                    {op.driverName && <p className="text-sm font-semibold leading-tight">{op.driverName}</p>}
                    <div className="flex items-center gap-2">
                      {op.driverPhone && (
                        <a href={`tel:${op.driverPhone}`} className="text-xs text-blue-600 flex items-center gap-0.5">
                          <Phone className="w-3 h-3" /> {op.driverPhone}
                        </a>
                      )}
                      {op.vehiclePlate && (
                        <span className="text-xs text-gray-600 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                          {op.vehiclePlate}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-orange-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Atanmamış
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => {
                setDriverName(op.driverName ?? '');
                setDriverPhone(op.driverPhone ?? '');
                setVehiclePlate(op.vehiclePlate ?? '');
                setDriverResourceId(op.driverResourceId ?? null);
                setAssignDialog('driver');
              }}
              className="text-xs text-blue-600 font-medium border border-blue-200 rounded-lg px-2 py-1 shrink-0"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          </div>

          {/* Emergency contacts */}
          {(op.emergencyContact1Name || op.emergencyContact2Name) && (
            <div className="border-t border-gray-50 pt-2">
              <p className="text-[10px] text-gray-400 font-medium mb-1.5">Acil Durumlar</p>
              {op.emergencyContact1Name && op.emergencyContact1Phone && (
                <a href={`tel:${op.emergencyContact1Phone}`} className="flex items-center gap-1.5 text-xs text-red-600 py-0.5">
                  <Phone className="w-3 h-3" />
                  {op.emergencyContact1Name}: {op.emergencyContact1Phone}
                </a>
              )}
              {op.emergencyContact2Name && op.emergencyContact2Phone && (
                <a href={`tel:${op.emergencyContact2Phone}`} className="flex items-center gap-1.5 text-xs text-red-600 py-0.5">
                  <Phone className="w-3 h-3" />
                  {op.emergencyContact2Name}: {op.emergencyContact2Phone}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tasks */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">Görevler</h2>
          <button
            onClick={() => setTaskDialog(true)}
            className="flex items-center gap-1 text-xs text-blue-600 font-medium"
          >
            <PlusCircle className="w-3.5 h-3.5" /> Ekle
          </button>
        </div>
        {op.tasks.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-3">Henüz görev eklenmemiş</p>
        ) : (
          <div className="space-y-2">
            {op.tasks.map(task => (
              <div key={task.id} className="flex items-start gap-2.5">
                <button
                  onClick={() => {
                    const next = task.status === 'completed' ? 'pending' : 'completed';
                    taskStatusMutation.mutate({ taskId: task.id, status: next });
                  }}
                  className="mt-0.5 shrink-0"
                  aria-label={`Görev durumunu değiştir: ${task.title}`}
                >
                  <TaskStatusIcon status={task.status} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-tight ${task.status === 'completed' ? 'line-through text-gray-400' : ''}`}>
                    {task.title}
                  </p>
                  {task.assignedTo && (
                    <p className="text-[10px] text-gray-400">{task.assignedTo}</p>
                  )}
                  {task.dueDate && (
                    <p className={`text-[10px] ${new Date(task.dueDate) < new Date() && task.status !== 'completed' ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                      Son: {formatDate(task.dueDate)}
                    </p>
                  )}
                </div>
                <span className="text-[9px] text-gray-400 shrink-0">
                  {TASK_STATUS_LABELS[task.status] ?? task.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Field Notes */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">Saha Notları</h2>
          <button
            onClick={() => setNoteDialog(true)}
            className="flex items-center gap-1 text-xs text-blue-600 font-medium"
          >
            <PlusCircle className="w-3.5 h-3.5" /> Ekle
          </button>
        </div>
        {(!op.notes_list || op.notes_list.length === 0) ? (
          <p className="text-xs text-gray-400 text-center py-3">Henüz saha notu yok</p>
        ) : (
          <div className="space-y-3">
            {op.notes_list.map(note => (
              <div key={note.id} className="flex gap-2.5">
                <div className="w-1.5 shrink-0 mt-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#F97316]" />
                  <div className="w-px h-full bg-gray-100 mx-auto" />
                </div>
                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 font-medium">
                      {FIELD_NOTE_CATEGORY_LABELS[note.category] ?? note.category}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {note.authorName ?? 'Anonim'} · {new Date(note.createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{note.noteText}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Receipts summary */}
      {op.receipts.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3">
            Makbuzlar ({op.receipts.length})
          </h2>
          <div className="space-y-2">
            {op.receipts.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{r.supplierName ?? 'Tedarikçi'} · {r.receiptDate ?? '-'}</span>
                <span className="font-semibold">{new Intl.NumberFormat('tr-TR', { style: 'currency', currency: r.currency }).format(r.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incidents */}
      {op.incidents.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
          <h2 className="text-sm font-bold text-red-800 mb-3">
            Olaylar ({op.incidents.length})
          </h2>
          {op.incidents.map(inc => (
            <Link href={`/field/incidents/${inc.id}`} key={inc.id}>
              <div className="flex items-center gap-2 py-1 cursor-pointer">
                <AlertTriangle className={`w-3.5 h-3.5 ${inc.severity === 'critical' ? 'text-red-600' : 'text-orange-500'}`} />
                <span className="text-sm text-gray-700 flex-1">{inc.title}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${INCIDENT_SEVERITY_COLORS[inc.severity]}`}>
                  {INCIDENT_SEVERITY_LABELS[inc.severity]}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Location sharing */}
      <LocationShare operationId={op.id} context="field" />

      {/* Quick actions: report incident */}
      <div className="flex gap-2 mt-4 mb-20 lg:mb-4">
        <Link href={`/field/incidents?operationId=${op.id}`} className="flex-1">
          <Button variant="outline" className="w-full text-red-600 border-red-200 text-xs h-10">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Olay Bildir
          </Button>
        </Link>
        <Button
          variant="outline"
          className="flex-1 text-xs h-10"
          onClick={() => refetch()}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Güncelle
        </Button>
      </div>

      {/* Sticky status action bar — mobile only */}
      {actions.length > 0 && (
        <div className="fixed bottom-16 left-0 right-0 z-30 lg:static lg:bottom-auto bg-white border-t lg:border border-gray-200 lg:rounded-xl p-3 lg:mb-4 shadow-lg lg:shadow-sm flex gap-2">
          {actions.slice(0, 2).map(a => (
            <button
              key={a.next}
              onClick={() => setStatusDialog({ next: a.next, confirm: a.confirm })}
              className={`flex-1 text-xs font-semibold text-white py-2.5 rounded-lg ${a.color}`}
            >
              {a.label}
            </button>
          ))}
          <button
            onClick={() => setCancelDialog(true)}
            className="px-3 text-xs font-semibold text-gray-500 border border-gray-200 rounded-lg"
          >
            İptal
          </button>
        </div>
      )}

      {/* Status confirmation dialog */}
      <Dialog open={!!statusDialog} onOpenChange={v => !v && setStatusDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Durum Değiştir</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">{statusDialog?.confirm}</p>
          <Textarea
            placeholder="İsteğe bağlı not ekleyin…"
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setStatusDialog(null)} className="flex-1">
              Vazgeç
            </Button>
            <Button
              onClick={() => statusMutation.mutate({ status: statusDialog!.next, note: statusNote || undefined })}
              disabled={statusMutation.isPending}
              className="flex-1 bg-[#0B1F3A]"
            >
              {statusMutation.isPending ? 'Kaydediliyor…' : 'Onayla'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirmation dialog */}
      <Dialog open={cancelDialog} onOpenChange={setCancelDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Operasyonu İptal Et</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">Bu operasyonu iptal etmek istediğinizden emin misiniz? Bu işlem geri alınamaz.</p>
          <Textarea
            placeholder="İptal nedeni (zorunlu)…"
            value={statusNote}
            onChange={e => setStatusNote(e.target.value)}
            rows={2}
            className="text-sm"
          />
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setCancelDialog(false)} className="flex-1">Vazgeç</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!statusNote.trim()) {
                  toast({ title: 'İptal nedeni zorunludur', variant: 'destructive' });
                  return;
                }
                statusMutation.mutate({ status: 'cancelled', note: statusNote });
                setCancelDialog(false);
              }}
              className="flex-1"
            >
              İptal Et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Guide assignment dialog */}
      <Dialog open={assignDialog === 'guide'} onOpenChange={v => !v && setAssignDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rehber Ata</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {guides.length > 0 && (
              <Select value={guideId} onValueChange={v => {
                const g = guides.find(x => x.clerkUserId === v);
                if (g) {
                  setGuideId(v);
                  setGuideName(g.name ?? '');
                }
              }}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Rehber seçin…" />
                </SelectTrigger>
                <SelectContent>
                  {guides.map(g => (
                    <SelectItem key={g.clerkUserId} value={g.clerkUserId}>
                      {g.name ?? g.email}
                      {g.todayOperationCount > 0 && ` (bugün ${g.todayOperationCount} operasyon)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input placeholder="Rehber adı" value={guideName} onChange={e => setGuideName(e.target.value)} className="text-sm" />
            <Input placeholder="Rehber telefonu" value={guidePhone} onChange={e => setGuidePhone(e.target.value)} type="tel" className="text-sm" />
            {canAssignPersonnel && (
              <div className="pt-2 border-t">
                <p className="text-[10px] text-gray-400 font-medium mb-1">Personel Kaydı (Sistem Kimliği) — yukarıdakinden bağımsız</p>
                <Select value={guideResourceId != null ? String(guideResourceId) : '__none__'} onValueChange={v => setGuideResourceId(v === '__none__' ? null : Number(v))}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Personel seç..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Bağlantı yok —</SelectItem>
                    {(guideResources ?? []).map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setAssignDialog(null)} className="flex-1">Vazgeç</Button>
            <Button
              onClick={() => assignMutation.mutate({
                guideName, guidePhone, assignedGuideUserId: guideId || undefined,
                ...(canAssignPersonnel ? { guideResourceId } : {}),
              })}
              disabled={assignMutation.isPending}
              className="flex-1 bg-[#0B1F3A]"
            >
              {assignMutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Driver / vehicle assignment dialog */}
      <Dialog open={assignDialog === 'driver'} onOpenChange={v => !v && setAssignDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Şoför / Araç Ata</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Şoför adı" value={driverName} onChange={e => setDriverName(e.target.value)} className="text-sm" />
            <Input placeholder="Şoför telefonu" value={driverPhone} onChange={e => setDriverPhone(e.target.value)} type="tel" className="text-sm" />
            <Input placeholder="Araç plakası (örn. 34 ABC 07)" value={vehiclePlate} onChange={e => setVehiclePlate(e.target.value)} className="text-sm font-mono uppercase" />
            {canAssignPersonnel && (
              <div className="pt-2 border-t">
                <p className="text-[10px] text-gray-400 font-medium mb-1">Personel Kaydı (Sistem Kimliği) — yukarıdakinden bağımsız</p>
                <Select value={driverResourceId != null ? String(driverResourceId) : '__none__'} onValueChange={v => setDriverResourceId(v === '__none__' ? null : Number(v))}>
                  <SelectTrigger className="text-sm"><SelectValue placeholder="Personel seç..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Bağlantı yok —</SelectItem>
                    {(driverResources ?? []).map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setAssignDialog(null)} className="flex-1">Vazgeç</Button>
            <Button
              onClick={() => assignMutation.mutate({
                driverName, driverPhone, vehiclePlate: vehiclePlate.toUpperCase(),
                ...(canAssignPersonnel ? { driverResourceId } : {}),
              })}
              disabled={assignMutation.isPending}
              className="flex-1 bg-[#0B1F3A]"
            >
              {assignMutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add note dialog */}
      <Dialog open={noteDialog} onOpenChange={setNoteDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Saha Notu Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Select value={noteCategory} onValueChange={setNoteCategory}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FIELD_NOTE_CATEGORY_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              placeholder="Not içeriği…"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setNoteDialog(false)} className="flex-1">Vazgeç</Button>
            <Button
              onClick={() => noteMutation.mutate({ noteText, category: noteCategory })}
              disabled={noteMutation.isPending || !noteText.trim()}
              className="flex-1 bg-[#0B1F3A]"
            >
              {noteMutation.isPending ? 'Kaydediliyor…' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add task dialog */}
      <Dialog open={taskDialog} onOpenChange={setTaskDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Görev Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Görev başlığı"
              value={taskTitle}
              onChange={e => setTaskTitle(e.target.value)}
              className="text-sm"
            />
            <Input
              placeholder="Atanacak kişi (isteğe bağlı)"
              value={taskAssignedTo}
              onChange={e => setTaskAssignedTo(e.target.value)}
              className="text-sm"
            />
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setTaskDialog(false)} className="flex-1">Vazgeç</Button>
            <Button
              onClick={() => taskMutation.mutate({ title: taskTitle, assignedTo: taskAssignedTo || undefined })}
              disabled={taskMutation.isPending || !taskTitle.trim()}
              className="flex-1 bg-[#0B1F3A]"
            >
              {taskMutation.isPending ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FieldShell>
  );
}

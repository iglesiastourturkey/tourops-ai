import { OperationDomainWorkspace } from "@/components/OperationDomainWorkspace";
import { useParams } from 'wouter';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import {
  useListOperationTasks,
  useUpdateOperationTask,
  getListOperationTasksQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Car, Phone, AlertTriangle, MapPin, Calendar,
  Loader2, CheckCircle2, Circle,
} from 'lucide-react';
import { LocationShare } from '@/components/LocationShare';
import {
  OPERATION_STATUS_LABELS,
  OPERATION_STATUS_COLORS,
  TASK_STATUS_LABELS,
  formatDate,
} from '@/lib/labels';

import { API_BASE } from '@/lib/api-base';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GuideOperation {
  id: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  completionRate: number;
  notes: string | null;
  guideName: string | null;
  guidePhone: string | null;
  driverName: string | null;
  driverPhone: string | null;
  vehiclePlate: string | null;
  emergencyContact1Name: string | null;
  emergencyContact1Phone: string | null;
  emergencyContact2Name: string | null;
  emergencyContact2Phone: string | null;
  tourName: string | null;
  customerName: string | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContactRow({ label, name, phone }: { label: string; name: string | null; phone: string | null }) {
  if (!name && !phone) return null;
  return (
    <div className="flex items-start gap-2">
      <span className="text-sm text-muted-foreground min-w-[90px] shrink-0">{label}</span>
      <div className="flex flex-col gap-0.5">
        {name && <span className="text-sm font-medium">{name}</span>}
        {phone && (
          <a href={`tel:${phone}`} className="text-sm text-primary hover:underline flex items-center gap-1">
            <Phone className="w-3 h-3" />{phone}
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GuideOperationDetailPage() {
  const params = useParams<{ id: string }>();
  const operationId = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: op, isLoading: opLoading, isError: opError } = useQuery({
    queryKey: ['guide', 'my-operations', operationId],
    queryFn: () => customFetch<GuideOperation>(`${API_BASE}/guide/my-operations/${operationId}`),
    enabled: !!operationId,
  });

  const { data: tasks, isLoading: tasksLoading } = useListOperationTasks(operationId, {
    query: { enabled: !!operationId, queryKey: getListOperationTasksQueryKey(operationId) },
  });

  const updateTask = useUpdateOperationTask();

  function toggleTaskDone(taskId: number, currentStatus: string) {
    const newStatus = currentStatus === 'completed' ? 'not_started' : 'completed';
    updateTask.mutate(
      { id: operationId, taskId, data: { status: newStatus } },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: getListOperationTasksQueryKey(operationId) }),
        onError: () => toast({ title: 'Görev güncellenemedi', variant: 'destructive' }),
      }
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (opLoading) {
    return (
      <AppShell title="Operasyon Detayı">
        <div className="max-w-md mx-auto space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      </AppShell>
    );
  }

  if (opError || !op) {
    return (
      <AppShell title="Operasyon Detayı">
        <div className="max-w-md mx-auto py-12 text-center space-y-3">
          <p className="text-muted-foreground">Operasyon bulunamadı veya erişim izniniz yok.</p>
          <Link href="/guide">
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" />Geri Dön
            </Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const statusBadge = op.status in OPERATION_STATUS_COLORS
    ? OPERATION_STATUS_COLORS[op.status]
    : 'bg-gray-100 text-gray-600';

  const completedTasks = (tasks ?? []).filter(t => t.status === 'completed').length;
  const totalTasks = (tasks ?? []).length;

  return (
    <AppShell title={op.tourName ?? `OP-${op.id}`}>
      <div className="max-w-md mx-auto space-y-4 pb-8">

        {/* Back button */}
        <Link href="/guide">
          <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
            <ArrowLeft className="w-4 h-4" />Görevlerime Dön
          </button>
        </Link>

        {/* Header card */}
        <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-semibold text-lg leading-tight">{op.tourName ?? `OP-${op.id}`}</h1>
              {op.customerName && (
                <p className="text-sm text-muted-foreground mt-0.5">{op.customerName}</p>
              )}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusBadge}`}>
              {OPERATION_STATUS_LABELS[op.status] ?? op.status}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>
              {formatDate(op.startDate)}
              {op.endDate && op.endDate !== op.startDate && ` – ${formatDate(op.endDate)}`}
            </span>
          </div>

          {totalTasks > 0 && (
            <div className="text-sm text-muted-foreground">
              Görevler: <span className="font-medium text-foreground">{completedTasks}/{totalTasks}</span> tamamlandı
            </div>
          )}
        </div>

        <OperationDomainWorkspace operationId={operationId} surface="guide" />

        {/* Driver & vehicle */}
        {(op.driverName || op.driverPhone || op.vehiclePlate) && (
          <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5" />Sürücü & Araç
            </h2>
            <ContactRow label="Sürücü" name={op.driverName} phone={op.driverPhone} />
            {op.vehiclePlate && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground min-w-[90px]">Plaka</span>
                <span className="font-mono text-sm font-medium">{op.vehiclePlate}</span>
              </div>
            )}
          </div>
        )}

        {/* Emergency contacts */}
        {(op.emergencyContact1Name || op.emergencyContact1Phone || op.emergencyContact2Name || op.emergencyContact2Phone) && (
          <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />Acil İletişim
            </h2>
            <ContactRow label="İletişim 1" name={op.emergencyContact1Name} phone={op.emergencyContact1Phone} />
            <ContactRow label="İletişim 2" name={op.emergencyContact2Name} phone={op.emergencyContact2Phone} />
          </div>
        )}

        {/* Notes */}
        {op.notes && (
          <div className="bg-card border rounded-xl p-4 shadow-sm space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />Notlar
            </h2>
            <p className="text-sm text-foreground/80 whitespace-pre-line">{op.notes}</p>
          </div>
        )}

        {/* Location sharing */}
        <LocationShare operationId={operationId} context="guide" />

        {/* Tasks */}
        <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Görevler</h2>
          {tasksLoading ? (
            <div className="space-y-2">
              {[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !tasks || tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">Görev bulunmuyor.</p>
          ) : (
            <div className="space-y-2">
              {tasks.map(task => {
                const isDone = task.status === 'completed';
                const isPending = updateTask.isPending && updateTask.variables?.taskId === task.id;
                return (
                  <button
                    key={task.id}
                    className={`w-full flex items-start gap-3 p-2.5 rounded-lg border text-left transition-colors
                      ${isDone ? 'bg-muted/50 border-muted' : 'bg-background border-border hover:bg-muted/30'}
                      active:scale-[0.98]`}
                    onClick={() => toggleTaskDone(task.id, task.status)}
                    disabled={isPending}
                  >
                    <span className="mt-0.5 shrink-0">
                      {isPending
                        ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        : isDone
                          ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                          : <Circle className="w-4 h-4 text-muted-foreground" />
                      }
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isDone ? 'line-through text-muted-foreground' : ''}`}>
                        {task.title}
                      </p>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0
                      ${isDone ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                      {TASK_STATUS_LABELS[task.status] ?? task.status}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}

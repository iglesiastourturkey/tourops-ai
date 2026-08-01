import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useGetOperation, useListOperationTasks, useUpdateOperationTask, useCreateOperationTask, useDeleteOperationTask } from '@workspace/api-client-react';
import { getGetOperationQueryKey, getListOperationTasksQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS, TASK_STATUS_LABELS, formatDate } from '@/lib/labels';

export default function OperationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'medium', dueDate: '', assignedTo: '' });

  const { data: operation, isLoading: opLoading } = useGetOperation(id, { query: { enabled: !!id, queryKey: getGetOperationQueryKey(id) } });
  const { data: tasks, isLoading: tasksLoading } = useListOperationTasks(id, { query: { enabled: !!id, queryKey: getListOperationTasksQueryKey(id) } });
  const updateTaskMutation = useUpdateOperationTask();
  const createTaskMutation = useCreateOperationTask();
  const deleteTaskMutation = useDeleteOperationTask();

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
    });
  }

  const allTasks = tasks ?? [];
  const completedCount = allTasks.filter(t => t.status === 'completed').length;

  return (
    <AppShell title={`Operasyon OP-${id}`}>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/operations"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-operations"><ArrowLeft className="w-4 h-4" />Operasyonlar</Button></Link>
      </div>

      {opLoading ? <Skeleton className="h-32 rounded-xl mb-4" /> : operation && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm">OP-{operation.id}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${OPERATION_STATUS_COLORS[operation.status] ?? 'bg-gray-100 text-gray-600'}`}>{OPERATION_STATUS_LABELS[operation.status] ?? operation.status}</span>
              </div>
              <p className="text-sm text-muted-foreground">Başlangıç: {formatDate(operation.startDate)}</p>
            </div>
            <div className="flex items-center gap-3">
              <Progress value={operation.completionRate} className="flex-1 h-2" />
              <span className="text-sm font-semibold text-primary">%{Math.round(operation.completionRate)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">{completedCount} / {allTasks.length} görev tamamlandı</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-sm">Görev Listesi</h3>
        <Button size="sm" onClick={() => setTaskDialogOpen(true)} className="gap-1.5" data-testid="button-add-task"><Plus className="w-3.5 h-3.5" />Görev Ekle</Button>
      </div>

      {tasksLoading ? <Skeleton className="h-48 rounded-xl" /> : allTasks.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">Henüz görev eklenmemiş.</CardContent></Card>
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
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0" onClick={() => handleDeleteTask(task.id)} data-testid={`button-delete-task-${task.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </div>
      )}

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
            <Button onClick={handleCreateTask} disabled={createTaskMutation.isPending} data-testid="button-save-task">{createTaskMutation.isPending ? 'Ekleniyor...' : 'Ekle'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

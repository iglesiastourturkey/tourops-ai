import { useState } from 'react';
import { Link, useSearch } from 'wouter';
import { FieldShell } from '@/components/FieldShell';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock, Filter, PlusCircle, RefreshCw,
} from 'lucide-react';
import {
  INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_SEVERITY_COLORS,
  INCIDENT_STATUS_LABELS, INCIDENT_STATUS_COLORS,
} from '@/lib/labels';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Incident {
  id: number;
  operationId: number | null;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  occurredAt: string;
  resolvedAt: string | null;
  operationTourName: string | null;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FieldIncidentsPage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const prefilledOpId = params.get('operationId') ?? '';

  const qc = useQueryClient();
  const { toast } = useToast();
  const { queueAction } = useOfflineQueue();
  const { isOnline } = useNetworkStatus();
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [createDialog, setCreateDialog] = useState(!!prefilledOpId);

  // Create form
  const [form, setForm] = useState({
    operationId: prefilledOpId,
    type: 'other',
    severity: 'medium',
    title: '',
    description: '',
  });

  const { data = [], isLoading, refetch } = useQuery<Incident[]>({
    queryKey: ['field-incidents', filterStatus],
    queryFn: () =>
      customFetch(
        `${API_BASE}/field/incidents${filterStatus !== 'all' ? `?status=${filterStatus}` : ''}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: async (body: typeof form) => {
      if (!isOnline) {
        const operationId = body.operationId ? Number(body.operationId) : undefined;
        await queueAction({
          url: `${API_BASE}/field/incidents`,
          method: 'POST',
          body: { ...body, occurredAt: new Date().toISOString() },
          type: 'incident',
          label: 'Olay taslağı',
          operationId: Number.isFinite(operationId) ? operationId : undefined,
        });
        return { queued: true };
      }
      return customFetch(`${API_BASE}/field/incidents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data: { queued?: boolean }) => {
      qc.invalidateQueries({ queryKey: ['field-incidents'] });
      qc.invalidateQueries({ queryKey: ['field-dashboard'] });
      setCreateDialog(false);
      setForm({ operationId: '', type: 'other', severity: 'medium', title: '', description: '' });
      toast({ title: data?.queued ? 'Olay taslağı senkronizasyon için bekliyor' : 'Olay bildirildi' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  const STATUS_FILTERS = [
    { value: 'all', label: 'Tümü' },
    { value: 'open', label: 'Açık' },
    { value: 'investigating', label: 'İnceleniyor' },
    { value: 'resolved', label: 'Çözüldü' },
    { value: 'closed', label: 'Kapatıldı' },
  ];

  const openCount = data.filter(i => i.status === 'open').length;
  const criticalCount = data.filter(i => i.severity === 'critical').length;

  return (
    <FieldShell title="Olaylar">
      {/* Summary banner */}
      {(openCount > 0 || criticalCount > 0) && (
        <div className={`rounded-xl p-3 mb-4 flex items-center gap-3 ${criticalCount > 0 ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
          <AlertTriangle className={`w-5 h-5 shrink-0 ${criticalCount > 0 ? 'text-red-600' : 'text-orange-600'}`} />
          <div className="text-sm">
            {criticalCount > 0 && (
              <span className="font-bold text-red-700">{criticalCount} kritik olay · </span>
            )}
            <span className={criticalCount > 0 ? 'text-red-600' : 'text-orange-700'}>
              {openCount} açık olay mevcut
            </span>
          </div>
        </div>
      )}

      {/* Filter + actions */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-1.5">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setFilterStatus(f.value)}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  filterStatus === f.value
                    ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                    : 'border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="shrink-0 p-1.5 rounded-lg border border-gray-200 text-gray-400"
          aria-label="Yenile"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Incident list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-gray-600">
            {filterStatus === 'all' ? 'Kayıtlı olay yok' : 'Bu filtrede olay bulunamadı'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(inc => {
            const sevColor = INCIDENT_SEVERITY_COLORS[inc.severity] ?? 'bg-gray-100 text-gray-600';
            const stColor = INCIDENT_STATUS_COLORS[inc.status] ?? 'bg-gray-100 text-gray-600';
            const isCritical = inc.severity === 'critical';
            const isOpen = inc.status === 'open' || inc.status === 'investigating';

            return (
              <Link href={`/field/incidents/${inc.id}`} key={inc.id}>
                <div className={`border rounded-xl p-4 cursor-pointer active:scale-[0.98] transition-transform ${
                  isCritical ? 'border-red-200 bg-red-50' : isOpen ? 'border-orange-100 bg-orange-50' : 'border-gray-100 bg-white'
                }`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${isCritical ? 'text-red-600' : isOpen ? 'text-orange-500' : 'text-gray-400'}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight line-clamp-2">{inc.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}
                          {inc.operationTourName && ` · ${inc.operationTourName}`}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sevColor}`}>
                      {INCIDENT_SEVERITY_LABELS[inc.severity] ?? inc.severity}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${stColor}`}>
                      {INCIDENT_STATUS_LABELS[inc.status] ?? inc.status}
                    </span>
                    <span className="text-[10px] text-gray-400 ml-auto flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(inc.occurredAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* FAB: New incident — mobile */}
      <button
        onClick={() => setCreateDialog(true)}
        className="fixed bottom-20 right-4 z-30 lg:hidden w-12 h-12 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg"
        aria-label="Olay bildir"
      >
        <PlusCircle className="w-6 h-6" />
      </button>

      {/* Desktop create button */}
      <div className="hidden lg:flex justify-end mt-4">
        <Button onClick={() => setCreateDialog(true)} className="bg-red-600 hover:bg-red-700">
          <PlusCircle className="w-4 h-4 mr-2" /> Olay Bildir
        </Button>
      </div>

      {/* Create incident dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Olay Bildir</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Olay başlığı *"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-gray-400 font-medium mb-1 block">Tür</label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger className="text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INCIDENT_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-gray-400 font-medium mb-1 block">Önem</label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger className="text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(INCIDENT_SEVERITY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Input
              placeholder="İlgili operasyon ID (isteğe bağlı)"
              value={form.operationId}
              onChange={e => setForm(f => ({ ...f, operationId: e.target.value }))}
              className="text-sm"
              type="number"
            />
            <Textarea
              placeholder="Açıklama…"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="text-sm"
            />
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setCreateDialog(false)} className="flex-1">Vazgeç</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={createMutation.isPending || !form.title.trim()}
              className="flex-1 bg-red-600 hover:bg-red-700"
            >
              {createMutation.isPending ? 'Bildiriliyor…' : 'Bildir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FieldShell>
  );
}

import { useState } from 'react';
import { useRoute, Link } from 'wouter';
import { FieldShell } from '@/components/FieldShell';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, Clock, MapPin,
} from 'lucide-react';
import {
  INCIDENT_TYPE_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_SEVERITY_COLORS,
  INCIDENT_STATUS_LABELS, INCIDENT_STATUS_COLORS,
} from '@/lib/labels';

import { API_BASE } from '@/lib/api-base';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncidentDetail {
  id: number;
  operationId: number | null;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  reportedByProfileId: number | null;
  assignedToProfileId: number | null;
  occurredAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  operationTourName: string | null;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FieldIncidentDetailPage() {
  const [, params] = useRoute('/field/incidents/:id');
  const id = params?.id;
  const qc = useQueryClient();
  const { toast } = useToast();

  const [statusDialog, setStatusDialog] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');

  const { data: incident, isLoading } = useQuery<IncidentDetail>({
    queryKey: ['field-incident', id],
    queryFn: () => customFetch(`${API_BASE}/field/incidents/${id}`),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: { status?: string; resolutionNote?: string }) =>
      customFetch(`${API_BASE}/field/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['field-incident', id] });
      qc.invalidateQueries({ queryKey: ['field-incidents'] });
      qc.invalidateQueries({ queryKey: ['field-dashboard'] });
      setStatusDialog(false);
      toast({ title: 'Olay güncellendi' });
    },
    onError: (e: Error) => toast({ title: e.message, variant: 'destructive' }),
  });

  if (isLoading) {
    return (
      <FieldShell title="Olay Detayı">
        <div className="space-y-4">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </FieldShell>
    );
  }

  if (!incident) {
    return (
      <FieldShell title="Olay Detayı">
        <div className="text-center py-12">
          <p className="text-gray-400">Olay bulunamadı</p>
          <Link href="/field/incidents">
            <Button variant="outline" className="mt-4">Olaylar Listesine Dön</Button>
          </Link>
        </div>
      </FieldShell>
    );
  }

  const sevColor = INCIDENT_SEVERITY_COLORS[incident.severity] ?? 'bg-gray-100 text-gray-600';
  const stColor = INCIDENT_STATUS_COLORS[incident.status] ?? 'bg-gray-100 text-gray-600';
  const isCritical = incident.severity === 'critical';
  const isResolved = incident.status === 'resolved' || incident.status === 'closed';

  const NEXT_STATUSES: Record<string, { value: string; label: string }[]> = {
    open: [
      { value: 'investigating', label: 'İncelemeye Al' },
      { value: 'resolved', label: 'Çözüldü Olarak Kapat' },
    ],
    investigating: [
      { value: 'resolved', label: 'Çözüldü Olarak Kapat' },
      { value: 'closed', label: 'Kapat' },
    ],
    resolved: [
      { value: 'closed', label: 'Tamamen Kapat' },
    ],
  };

  const availableNextStatuses = NEXT_STATUSES[incident.status] ?? [];

  return (
    <FieldShell title="Olay Detayı">
      {/* Back */}
      <Link href="/field/incidents">
        <div className="flex items-center gap-1.5 text-sm text-blue-600 font-medium mb-4 -mt-1">
          <ChevronLeft className="w-4 h-4" />
          Olaylar
        </div>
      </Link>

      {/* Header */}
      <div className={`border rounded-xl p-4 shadow-sm mb-4 ${isCritical ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
        <div className="flex items-start gap-2.5 mb-3">
          <AlertTriangle className={`w-5 h-5 mt-0.5 shrink-0 ${isCritical ? 'text-red-600' : 'text-orange-500'}`} />
          <div className="flex-1">
            <h1 className="font-bold text-base leading-tight">{incident.title}</h1>
            {incident.operationTourName && (
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {incident.operationTourName}
                {incident.operationId && ` · OPR-${incident.operationId}`}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${sevColor}`}>
            {INCIDENT_SEVERITY_LABELS[incident.severity] ?? incident.severity}
          </span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${stColor}`}>
            {INCIDENT_STATUS_LABELS[incident.status] ?? incident.status}
          </span>
          <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-semibold">
            {INCIDENT_TYPE_LABELS[incident.type] ?? incident.type}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-3">Detaylar</h2>
        <div className="space-y-3">
          {incident.description && (
            <div>
              <p className="text-[10px] text-gray-400 font-medium mb-1">Açıklama</p>
              <p className="text-sm text-gray-700 leading-relaxed">{incident.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-gray-400 font-medium mb-0.5">Olay Zamanı</p>
              <p className="text-sm text-gray-700 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                {new Date(incident.occurredAt).toLocaleString('tr-TR', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 font-medium mb-0.5">Bildirim Tarihi</p>
              <p className="text-sm text-gray-700">
                {new Date(incident.createdAt).toLocaleString('tr-TR', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          </div>
          {incident.resolvedAt && (
            <div>
              <p className="text-[10px] text-gray-400 font-medium mb-0.5">Çözüm Tarihi</p>
              <p className="text-sm text-gray-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                {new Date(incident.resolvedAt).toLocaleString('tr-TR', {
                  day: '2-digit', month: '2-digit', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Resolution note */}
      {(incident.resolutionNote || isResolved) && (
        <div className={`border rounded-xl p-4 shadow-sm mb-4 ${isResolved ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-gray-100'}`}>
          <h2 className="text-sm font-bold mb-2 text-emerald-800">Çözüm Notu</h2>
          {incident.resolutionNote ? (
            <p className="text-sm text-gray-700 leading-relaxed">{incident.resolutionNote}</p>
          ) : (
            <p className="text-xs text-gray-400">Henüz çözüm notu eklenmemiş</p>
          )}
        </div>
      )}

      {/* Update resolution note inline */}
      {!isResolved && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">Çözüm Notu Ekle</h2>
          <Textarea
            placeholder="Çözüm veya güncelleme notu…"
            value={resolutionNote}
            onChange={e => setResolutionNote(e.target.value)}
            rows={2}
            className="text-sm mb-2"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => updateMutation.mutate({ resolutionNote })}
            disabled={updateMutation.isPending || !resolutionNote.trim()}
            className="text-xs"
          >
            Notu Kaydet
          </Button>
        </div>
      )}

      {/* Status actions */}
      {availableNextStatuses.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm mb-20 lg:mb-4">
          <h2 className="text-sm font-bold text-gray-800 mb-3">Durum Güncelle</h2>
          <div className="flex flex-col gap-2">
            {availableNextStatuses.map(ns => (
              <button
                key={ns.value}
                onClick={() => {
                  setNewStatus(ns.value);
                  setStatusDialog(true);
                }}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold text-white ${
                  ns.value === 'resolved' || ns.value === 'closed'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-[#0B1F3A] hover:bg-[#162033]'
                }`}
              >
                {ns.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Back link to operation if applicable */}
      {incident.operationId && (
        <div className="mb-4">
          <Link href={`/field/operations/${incident.operationId}`}>
            <Button variant="outline" className="w-full text-xs">
              Operasyona Git (OPR-{incident.operationId})
            </Button>
          </Link>
        </div>
      )}

      {/* Status update confirmation dialog */}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Durum Güncelle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Olay durumunu{' '}
              <strong>{INCIDENT_STATUS_LABELS[newStatus] ?? newStatus}</strong>
              {' '}olarak değiştirmek istediğinizden emin misiniz?
            </p>
            {(newStatus === 'resolved' || newStatus === 'closed') && !resolutionNote && (
              <Textarea
                placeholder="Çözüm notu ekleyin (önerilir)…"
                value={resolutionNote}
                onChange={e => setResolutionNote(e.target.value)}
                rows={2}
                className="text-sm"
              />
            )}
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setStatusDialog(false)} className="flex-1">Vazgeç</Button>
            <Button
              onClick={() =>
                updateMutation.mutate({
                  status: newStatus,
                  resolutionNote: resolutionNote || undefined,
                })
              }
              disabled={updateMutation.isPending}
              className="flex-1 bg-[#0B1F3A]"
            >
              {updateMutation.isPending ? 'Güncelleniyor…' : 'Güncelle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FieldShell>
  );
}

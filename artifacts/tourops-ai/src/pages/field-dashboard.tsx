import { useState } from 'react';
import { Link } from 'wouter';
import { FieldShell } from '@/components/FieldShell';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import {
  AlertTriangle, Calendar, Car, CheckCircle2, ChevronRight,
  ClipboardList, Clock, HardHat, RefreshCw, User, Wifi, WifiOff, MapPin,
} from 'lucide-react';
import {
  OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS,
  INCIDENT_SEVERITY_COLORS, INCIDENT_SEVERITY_LABELS,
  INCIDENT_TYPE_LABELS, formatDate,
} from '@/lib/labels';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface OpSummary {
  id: number;
  status: string;
  startDate: string | null;
  endDate: string | null;
  guideName: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  completionRate: number;
  tourName: string | null;
  customerName: string | null;
}

interface IncidentSummary {
  id: number;
  operationId: number | null;
  type: string;
  severity: string;
  title: string;
  status: string;
  occurredAt: string;
  operationTourName: string | null;
}

interface DashboardData {
  kpis: {
    todayTotal: number;
    active: number;
    waiting: number;
    missingGuide: number;
    missingVehicle: number;
    overdueTask: number;
    missingDoc: number;
    openIncident: number;
  };
  todayOperations: OpSummary[];
  upcomingOperations: OpSummary[];
  openIncidents: IncidentSummary[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  value, label, accent, warn,
}: { value: number; label: string; accent: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${warn && value > 0 ? 'border-orange-200 bg-orange-50' : 'border-gray-100 bg-white'}`}>
      <div className={`text-2xl font-bold leading-none mb-1 ${warn && value > 0 ? 'text-orange-600' : accent}`}>
        {value}
      </div>
      <div className="text-[10px] text-gray-500 font-medium leading-tight">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = OPERATION_STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${color}`}>
      {OPERATION_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function OpCard({ op }: { op: OpSummary }) {
  const missingGuide = !op.guideName;
  const missingVehicle = !op.vehiclePlate;

  return (
    <Link href={`/field/operations/${op.id}`}>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm active:scale-[0.98] transition-transform cursor-pointer">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight line-clamp-1">
              {op.tourName ?? `OPR-${op.id}`}
            </p>
            {op.customerName && (
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                <User className="w-3 h-3 shrink-0" />
                {op.customerName}
              </p>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <StatusBadge status={op.status} />
            <span className="text-[10px] text-gray-400">OPR-{op.id}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <Calendar className="w-3 h-3 shrink-0" />
          {formatDate(op.startDate)}
          {op.endDate && op.endDate !== op.startDate && ` – ${formatDate(op.endDate)}`}
        </div>

        <div className="flex flex-wrap gap-2">
          {op.guideName ? (
            <div className="flex items-center gap-1 text-[11px] text-gray-600">
              <User className="w-3 h-3 text-blue-400" />
              {op.guideName}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-orange-600 font-medium">
              <AlertTriangle className="w-3 h-3" />
              Rehber eksik
            </div>
          )}
          {op.vehiclePlate ? (
            <div className="flex items-center gap-1 text-[11px] text-gray-600">
              <Car className="w-3 h-3 text-purple-400" />
              {op.vehiclePlate}
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[11px] text-orange-600 font-medium">
              <AlertTriangle className="w-3 h-3" />
              Araç eksik
            </div>
          )}
          {op.completionRate > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-gray-500">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              %{Math.round(op.completionRate)} tamamlandı
            </div>
          )}
        </div>

        <div className="mt-2.5 flex items-center justify-end">
          <span className="text-[11px] text-blue-600 font-medium flex items-center gap-0.5">
            Detay <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function IncidentCard({ inc }: { inc: IncidentSummary }) {
  const sevColor = INCIDENT_SEVERITY_COLORS[inc.severity] ?? 'bg-gray-100 text-gray-600';
  return (
    <Link href={`/field/incidents/${inc.id}`}>
      <div className={`border rounded-xl p-3.5 cursor-pointer active:scale-[0.98] transition-transform ${
        inc.severity === 'critical' ? 'border-red-300 bg-red-50' : 'border-orange-200 bg-orange-50'
      }`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${inc.severity === 'critical' ? 'text-red-600' : 'text-orange-600'}`} />
              <span className="text-sm font-semibold line-clamp-1">{inc.title}</span>
            </div>
            <div className="text-xs text-gray-500">
              {INCIDENT_TYPE_LABELS[inc.type] ?? inc.type}
              {inc.operationTourName && ` · ${inc.operationTourName}`}
            </div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${sevColor}`}>
            {INCIDENT_SEVERITY_LABELS[inc.severity] ?? inc.severity}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SectionHeader({ title, count, href }: { title: string; count?: number; href?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
        {count !== undefined && (
          <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5 font-semibold">{count}</span>
        )}
      </div>
      {href && (
        <Link href={href}>
          <span className="text-xs text-blue-600 font-medium flex items-center gap-0.5">
            Tümü <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FieldDashboardPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DashboardData>({
    queryKey: ['field-dashboard'],
    queryFn: () => customFetch(`${API_BASE}/field/dashboard`),
    refetchInterval: 60_000,
  });

  const kpis = data?.kpis;
  const today = data?.todayOperations ?? [];
  const upcoming = data?.upcomingOperations ?? [];
  const incidents = data?.openIncidents ?? [];

  const hasAlerts = (kpis?.missingGuide ?? 0) > 0
    || (kpis?.missingVehicle ?? 0) > 0
    || (kpis?.overdueTask ?? 0) > 0
    || (kpis?.openIncident ?? 0) > 0;

  return (
    <FieldShell title="Saha Operasyon Merkezi">
      {/* Refresh button */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-gray-400">
          {new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-blue-600 font-medium disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Güncelle
        </button>
      </div>

      {/* Error state */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-center">
          <p className="text-sm text-red-600 font-medium">Veri yüklenemedi</p>
          <button onClick={() => refetch()} className="mt-2 text-xs text-red-500 underline">
            Tekrar dene
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="mb-6">
        <SectionHeader title="Bugünün Özeti" />
        {isLoading ? (
          <div className="grid grid-cols-4 gap-2">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            <KpiCard value={kpis?.todayTotal ?? 0} label="Bugünkü Operasyon" accent="text-blue-600" />
            <KpiCard value={kpis?.active ?? 0} label="Devam Eden" accent="text-emerald-600" />
            <KpiCard value={kpis?.waiting ?? 0} label="Başlamayı Bekleyen" accent="text-teal-600" />
            <KpiCard value={kpis?.openIncident ?? 0} label="Açık Olay" accent="text-red-600" warn />
            <KpiCard value={kpis?.missingGuide ?? 0} label="Rehber Eksik" accent="text-orange-600" warn />
            <KpiCard value={kpis?.missingVehicle ?? 0} label="Araç Eksik" accent="text-orange-600" warn />
            <KpiCard value={kpis?.overdueTask ?? 0} label="Geciken Görev" accent="text-orange-600" warn />
            <KpiCard value={kpis?.missingDoc ?? 0} label="Belge Bekliyor" accent="text-amber-600" warn />
          </div>
        )}
      </div>

      {/* Open incidents alert */}
      {incidents.length > 0 && (
        <div className="mb-6">
          <SectionHeader title="Açık Olaylar" count={incidents.length} href="/field/incidents" />
          <div className="space-y-2">
            {incidents.slice(0, 3).map(inc => (
              <IncidentCard key={inc.id} inc={inc} />
            ))}
          </div>
        </div>
      )}

      {/* Today's operations */}
      <div className="mb-6">
        <SectionHeader title="Bugünkü Operasyonlar" count={today.length} />
        {isLoading ? (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : today.length === 0 ? (
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-6 text-center">
            <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Bugün için operasyon yok</p>
          </div>
        ) : (
          <div className="space-y-3">
            {today.map(op => <OpCard key={op.id} op={op} />)}
          </div>
        )}
      </div>

      {/* Upcoming operations */}
      {(upcoming.length > 0 || isLoading) && (
        <div className="mb-6">
          <SectionHeader title="Yaklaşan Operasyonlar" count={upcoming.length} />
          {isLoading ? (
            <div className="space-y-3">
              <SkeletonCard />
            </div>
          ) : (
            <div className="space-y-3">
              {upcoming.map(op => <OpCard key={op.id} op={op} />)}
            </div>
          )}
        </div>
      )}

      {!isLoading && today.length === 0 && upcoming.length === 0 && incidents.length === 0 && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-6 text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-medium text-emerald-700">Her şey yolunda görünüyor</p>
          <p className="text-xs text-emerald-500 mt-1">Yaklaşan 14 günde bekleyen operasyon yok</p>
        </div>
      )}
    </FieldShell>
  );
}

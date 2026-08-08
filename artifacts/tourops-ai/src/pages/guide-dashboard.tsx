import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import {
  MapPin, Phone, Car, AlertTriangle, ChevronRight,
  Calendar, RefreshCw, ClipboardList, User,
} from 'lucide-react';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, formatDate } from '@/lib/labels';

import { API_BASE } from '@/lib/api-base';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function classifyOperation(op: GuideOperation): 'today' | 'upcoming' | 'past' {
  const today = todayStr();
  const start = op.startDate ?? '';
  const end = op.endDate ?? op.startDate ?? '';

  if (start <= today && today <= end) return 'today';
  if (start > today) return 'upcoming';
  return 'past';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContactChip({ icon: Icon, label, phone }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  phone: string;
}) {
  return (
    <a
      href={`tel:${phone}`}
      className="flex items-center gap-1.5 text-sm text-primary hover:underline py-0.5"
    >
      <Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">{phone}</span>
    </a>
  );
}

function OperationCard({ op }: { op: GuideOperation }) {
  const badge = op.status in OPERATION_STATUS_COLORS
    ? OPERATION_STATUS_COLORS[op.status]
    : 'bg-gray-100 text-gray-600';

  const hasDriver = op.driverName || op.driverPhone;
  const hasEmergency = op.emergencyContact1Name || op.emergencyContact1Phone;

  return (
    <Link href={`/guide/${op.id}`}>
      <div className="bg-card border rounded-xl p-4 shadow-sm active:scale-[0.98] transition-transform cursor-pointer">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-base leading-tight line-clamp-2">
              {op.tourName ?? `OP-${op.id}`}
            </p>
            {op.customerName && (
              <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1">
                <User className="w-3.5 h-3.5 shrink-0" />
                {op.customerName}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>
              {OPERATION_STATUS_LABELS[op.status] ?? op.status}
            </span>
            <span className="text-xs font-mono text-muted-foreground">OP-{op.id}</span>
          </div>
        </div>

        {/* Date row */}
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
          <Calendar className="w-3.5 h-3.5 shrink-0" />
          <span>
            {formatDate(op.startDate)}
            {op.endDate && op.endDate !== op.startDate && ` – ${formatDate(op.endDate)}`}
          </span>
        </div>

        {/* Driver */}
        {hasDriver && (
          <div className="mb-2 pb-2 border-b border-border/60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              <Car className="w-3 h-3" />Sürücü
            </div>
            <div className="space-y-0.5">
              {op.driverPhone ? (
                <ContactChip icon={Car} label={op.driverName ?? 'Sürücü'} phone={op.driverPhone} />
              ) : op.driverName ? (
                <p className="text-sm flex items-center gap-1.5">
                  <Car className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  {op.driverName}
                </p>
              ) : null}
              {op.vehiclePlate && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 ml-5">
                  Plaka: <span className="font-mono font-medium">{op.vehiclePlate}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* Emergency contacts */}
        {hasEmergency && (
          <div className="mb-2 pb-2 border-b border-border/60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              <AlertTriangle className="w-3 h-3" />Acil İletişim
            </div>
            <div className="space-y-0.5">
              {op.emergencyContact1Phone ? (
                <ContactChip
                  icon={Phone}
                  label={op.emergencyContact1Name ?? 'İletişim 1'}
                  phone={op.emergencyContact1Phone}
                />
              ) : op.emergencyContact1Name ? (
                <p className="text-sm">{op.emergencyContact1Name}</p>
              ) : null}
              {op.emergencyContact2Phone ? (
                <ContactChip
                  icon={Phone}
                  label={op.emergencyContact2Name ?? 'İletişim 2'}
                  phone={op.emergencyContact2Phone}
                />
              ) : op.emergencyContact2Name ? (
                <p className="text-sm">{op.emergencyContact2Name}</p>
              ) : null}
            </div>
          </div>
        )}

        {/* Notes */}
        {op.notes && (
          <div className="mb-2 pb-2 border-b border-border/60">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              <MapPin className="w-3 h-3" />Notlar
            </div>
            <p className="text-sm text-foreground/80 line-clamp-3 whitespace-pre-line">
              {op.notes}
            </p>
          </div>
        )}

        {/* Footer: view link */}
        <div className="flex items-center justify-end text-primary text-sm font-medium pt-0.5">
          Detaylar <ChevronRight className="w-4 h-4 ml-0.5" />
        </div>
      </div>
    </Link>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {count > 0 && (
        <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GuideDashboardPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['guide', 'my-operations'],
    queryFn: () => customFetch<GuideOperation[]>(`${API_BASE}/guide/my-operations`),
    staleTime: 60_000,
  });

  const ops = data ?? [];

  // Exclude archived operations from "past" — show them only if explicitly relevant
  const active = ops.filter(op => op.status !== 'archived');
  const today = active.filter(op => classifyOperation(op) === 'today');
  const upcoming = active.filter(op => classifyOperation(op) === 'upcoming');
  const past = active.filter(op => classifyOperation(op) === 'past');

  return (
    <AppShell title="Görevlerim">
      <div className="max-w-md mx-auto space-y-6 pb-8">

        {/* Loading state */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <ClipboardList className="w-10 h-10 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">Görevler yüklenemedi.</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5" />Yeniden Dene
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && ops.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <ClipboardList className="w-12 h-12 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">Atanmış operasyon yok</p>
            <p className="text-sm text-muted-foreground/70">
              Size atanan operasyonlar burada görünecek.
            </p>
          </div>
        )}

        {/* Today */}
        {today.length > 0 && (
          <section>
            <SectionHeader title="Bugün" count={today.length} />
            <div className="space-y-3">
              {today.map(op => <OperationCard key={op.id} op={op} />)}
            </div>
          </section>
        )}

        {/* Upcoming */}
        {upcoming.length > 0 && (
          <section>
            <SectionHeader title="Yaklaşan" count={upcoming.length} />
            <div className="space-y-3">
              {upcoming.map(op => <OperationCard key={op.id} op={op} />)}
            </div>
          </section>
        )}

        {/* Past */}
        {past.length > 0 && (
          <section>
            <SectionHeader title="Geçmiş" count={past.length} />
            <div className="space-y-3">
              {past.map(op => <OperationCard key={op.id} op={op} />)}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useListOperations } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, CalendarDays, List } from 'lucide-react';
import { OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, formatDate } from '@/lib/labels';
import { groupOperationsByDate, getMonthGrid, toDateKey, sortByPickupTime } from '@/lib/calendar-grouping';

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTH_LABELS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

type ViewMode = 'month' | 'day';

export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());

  const { data: operations, isLoading, isError, refetch } = useListOperations();

  const scheduled = useMemo(() => (operations ?? []).filter(op => op.status !== 'archived'), [operations]);
  const byDate = useMemo(() => groupOperationsByDate(scheduled), [scheduled]);
  const unscheduledCount = useMemo(() => scheduled.filter(op => !op.startDate).length, [scheduled]);

  const todayKey = toDateKey(new Date());
  const cursorKey = toDateKey(cursorDate);

  function goToday() {
    setCursorDate(new Date());
  }

  function shiftMonth(delta: number) {
    setCursorDate(d => new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }

  function shiftDay(delta: number) {
    setCursorDate(d => {
      const next = new Date(d);
      next.setDate(next.getDate() + delta);
      return next;
    });
  }

  function openDay(date: Date) {
    setCursorDate(date);
    setViewMode('day');
  }

  const monthGrid = useMemo(() => getMonthGrid(cursorDate), [cursorDate]);
  const dayOperations = useMemo(
    () => sortByPickupTime(byDate.get(cursorKey) ?? []),
    [byDate, cursorKey],
  );

  return (
    <AppShell title="Takvim">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border bg-card p-0.5 w-fit">
          <Button
            size="sm"
            variant={viewMode === 'month' ? 'secondary' : 'ghost'}
            className="gap-1.5"
            onClick={() => setViewMode('month')}
            data-testid="button-calendar-view-month"
          >
            <CalendarDays className="w-3.5 h-3.5" />Aylık
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'day' ? 'secondary' : 'ghost'}
            className="gap-1.5"
            onClick={() => setViewMode('day')}
            data-testid="button-calendar-view-day"
          >
            <List className="w-3.5 h-3.5" />Günlük
          </Button>
        </div>

        <div className="flex items-center gap-1.5 sm:ml-2">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => (viewMode === 'month' ? shiftMonth(-1) : shiftDay(-1))} data-testid="button-calendar-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => (viewMode === 'month' ? shiftMonth(1) : shiftDay(1))} data-testid="button-calendar-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium min-w-40 text-center sm:text-left">
            {viewMode === 'month'
              ? `${MONTH_LABELS[cursorDate.getMonth()]} ${cursorDate.getFullYear()}`
              : formatDate(cursorKey)}
          </span>
        </div>

        <Button size="sm" variant="outline" className="sm:ml-auto" onClick={goToday} data-testid="button-calendar-today">
          Bugün
        </Button>
      </div>

      {unscheduledCount > 0 && (
        <p className="text-xs text-muted-foreground mb-3">
          {unscheduledCount} operasyonun tarihi belirlenmemiş — takvimde görünmüyor, listelemek için
          {' '}<Link href="/operations" className="underline underline-offset-2">Operasyon Planlama</Link>'ya bakın.
        </p>
      )}

      {isError ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-destructive text-sm">Veriler yüklenemedi.</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => refetch()} data-testid="button-retry-calendar">
            <RefreshCw className="w-3.5 h-3.5" />Yeniden Dene
          </Button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : viewMode === 'month' ? (
        <div className="border rounded-lg overflow-hidden bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40">
            {WEEKDAY_LABELS.map(label => (
              <div key={label} className="px-2 py-1.5 text-xs font-medium text-muted-foreground text-center">{label}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthGrid.map(day => {
              const dayKey = toDateKey(day);
              const dayOps = byDate.get(dayKey) ?? [];
              const inMonth = day.getMonth() === cursorDate.getMonth();
              const isToday = dayKey === todayKey;
              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => openDay(day)}
                  className={`min-h-20 border-b border-r p-1.5 text-left align-top hover:bg-accent/50 transition-colors ${inMonth ? '' : 'bg-muted/20 text-muted-foreground/50'}`}
                  data-testid={`button-calendar-day-${dayKey}`}
                >
                  <span className={`text-xs font-medium inline-flex items-center justify-center ${isToday ? 'w-5 h-5 rounded-full bg-primary text-primary-foreground' : ''}`}>
                    {day.getDate()}
                  </span>
                  {dayOps.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {dayOps.slice(0, 3).map(op => (
                        <div key={op.id} className={`text-[10px] leading-tight px-1 py-0.5 rounded truncate ${OPERATION_STATUS_COLORS[op.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          OP-{op.id}
                        </div>
                      ))}
                      {dayOps.length > 3 && (
                        <div className="text-[10px] text-muted-foreground px-1">+{dayOps.length - 3} daha</div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-card">
          {dayOperations.length === 0 ? (
            <div className="text-center text-muted-foreground py-10 text-sm">
              Bu tarihte planlanmış operasyon yok
            </div>
          ) : (
            <ul className="divide-y">
              {dayOperations.map(op => (
                <li key={op.id} className="p-3 flex items-center gap-3" data-testid={`row-calendar-operation-${op.id}`}>
                  <span className="font-mono text-sm font-medium w-16 shrink-0">OP-{op.id}</span>
                  <span className="text-sm text-muted-foreground w-14 shrink-0">{op.pickupTime ?? '—'}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${OPERATION_STATUS_COLORS[op.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {OPERATION_STATUS_LABELS[op.status] ?? op.status}
                  </span>
                  <span className="text-sm text-muted-foreground truncate flex-1">
                    {[op.guideName, op.driverName, op.vehiclePlate].filter(Boolean).join(' · ') || 'Rehber/şoför atanmadı'}
                  </span>
                  <Link href={`/operations/${op.id}`} className="text-muted-foreground hover:text-foreground shrink-0" data-testid={`link-calendar-operation-${op.id}`}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppShell>
  );
}

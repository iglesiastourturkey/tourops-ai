import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import {
  MapPin, FileText, Sparkles, AlertTriangle, Info, TrendingUp, Calendar,
  CheckSquare, ClipboardList, Users, Camera, Bell, ArrowRight, CircleAlert,
  Receipt, Package, UserCheck, Clock,
} from 'lucide-react';
import { customFetch, useGetMyProfile, useListNotifications } from '@workspace/api-client-react';
import { useProfile, ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';
import { formatCurrency } from '@/lib/labels';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

// ── Types ──────────────────────────────────────────────────────────────────────

interface DashStats {
  role?: string;
  // admin/super_admin
  activeTours?: number;
  pendingQuotations?: number;
  tasksDueToday?: number;
  todayOperations?: number;
  totalEstimatedRevenue?: number;
  avgProfitMargin?: number;
  currency?: string;
  missingGuideAssignments?: number;
  receiptsMissingPhotos?: number;
  // operations
  unassignedCount?: number;
  incompleteTasksCount?: number;
  upcomingDepartures?: number;
  avgCompletionRate?: number;
  // accounting
  receiptCount?: number;
  totalRecordedExpenses?: number;
  // guide
  assignedOperationsCount?: number;
  todayOperationsCount?: number;
  pendingTasksCount?: number;
}

interface DashAlert {
  id: string;
  type: string;
  message: string;
  severity: string;
  relatedId: number | null;
  relatedType: string | null;
}

interface DashCharts {
  monthlyQuotations: Array<{ label: string; value: number }>;
  monthlySales: Array<{ label: string; value: number }>;
  tourStatusDistribution: Array<{ label: string; value: number }>;
  topDestinations: Array<{ label: string; value: number }>;
}

interface UpcomingOp {
  id: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
  guideName: string | null;
  assignedGuideUserId: string | null;
  tourName: string | null;
}

interface GuideOp {
  id: number;
  startDate: string | null;
  endDate: string | null;
  status: string;
  completionRate: number;
  guideName: string | null;
  tourName: string | null;
}

// ── Data hooks ─────────────────────────────────────────────────────────────────

function useDashStats() {
  return useQuery<DashStats>({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => customFetch<DashStats>(`${API_BASE}/dashboard/stats`),
    staleTime: 60_000,
  });
}

function useDashAlerts() {
  return useQuery<DashAlert[]>({
    queryKey: ['dashboard', 'alerts'],
    queryFn: () => customFetch<DashAlert[]>(`${API_BASE}/dashboard/alerts`),
    staleTime: 60_000,
  });
}

function useDashCharts() {
  return useQuery<DashCharts>({
    queryKey: ['dashboard', 'charts'],
    queryFn: () => customFetch<DashCharts>(`${API_BASE}/dashboard/charts`),
    staleTime: 120_000,
  });
}

function useDashUpcoming() {
  return useQuery<UpcomingOp[]>({
    queryKey: ['dashboard', 'upcoming'],
    queryFn: () => customFetch<UpcomingOp[]>(`${API_BASE}/dashboard/upcoming`),
    staleTime: 60_000,
  });
}

function useDashGuideOps() {
  return useQuery<GuideOp[]>({
    queryKey: ['dashboard', 'guide-ops'],
    queryFn: () => customFetch<GuideOp[]>(`${API_BASE}/dashboard/guide-ops`),
    staleTime: 60_000,
  });
}

// ── Shared components ──────────────────────────────────────────────────────────

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const TR_MONTHS_LONG = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

function DashboardHeader({ name, role }: { name?: string | null; role: UserRole }) {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
  const firstName = name?.split(' ')[0];
  const dateStr = `${TR_DAYS[now.getDay()]}, ${now.getDate()} ${TR_MONTHS_LONG[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
      <div>
        <h2 className="text-xl font-bold text-foreground">
          {greeting}{firstName ? `, ${firstName}` : ''}!
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">{dateStr}</p>
      </div>
      <Badge variant="outline" className="self-start sm:self-auto text-xs px-2.5 py-1">
        {ROLE_LABELS[role]}
      </Badge>
    </div>
  );
}

interface KPICardProps {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  subtitle?: string;
  alert?: boolean;
  loading?: boolean;
}

function KPICard({ label, value, icon: Icon, iconColor = 'text-primary', subtitle, alert, loading }: KPICardProps) {
  if (loading) return <Skeleton className="h-24 rounded-xl" />;
  return (
    <Card className={`border ${alert && Number(value) > 0 ? 'border-orange-200 bg-orange-50/30' : ''}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium leading-tight">{label}</span>
          <Icon className={`w-4 h-4 flex-shrink-0 ${alert && Number(value) > 0 ? 'text-orange-500' : iconColor}`} />
        </div>
        <div className={`text-2xl font-bold ${alert && Number(value) > 0 ? 'text-orange-600' : 'text-foreground'}`}>
          {value ?? '—'}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground mt-1 truncate">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

const SEVERITY_STYLES: Record<string, { bg: string; icon: typeof AlertTriangle; text: string }> = {
  critical: { bg: 'bg-red-50 border-red-200', icon: CircleAlert, text: 'text-red-600' },
  warning: { bg: 'bg-yellow-50 border-yellow-200', icon: AlertTriangle, text: 'text-yellow-600' },
  info: { bg: 'bg-blue-50 border-blue-200', icon: Info, text: 'text-blue-600' },
};

function AlertsPanel() {
  const { data: alerts, isLoading, isError, refetch } = useDashAlerts();

  if (isLoading) return <Skeleton className="h-32 rounded-xl" />;
  if (isError) return (
    <Card><CardContent className="p-4 text-center space-y-2">
      <p className="text-destructive text-sm">Uyarılar yüklenemedi.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>Yeniden Dene</Button>
    </CardContent></Card>
  );
  if (!alerts || alerts.length === 0) return (
    <Card><CardContent className="p-4 text-center text-muted-foreground text-sm">
      Dikkat gerektiren işlem yok.
    </CardContent></Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CircleAlert className="w-4 h-4 text-orange-500" /> Dikkat Gerektirenler
          <Badge className="ml-auto bg-orange-100 text-orange-700 hover:bg-orange-100 border-0 text-xs">
            {alerts.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map(alert => {
          const { bg, icon: Icon, text } = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
          return (
            <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${bg}`}>
              <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${text}`} />
              <p className="text-sm text-foreground leading-tight">{alert.message}</p>
              {alert.relatedId && alert.relatedType === 'operation' && (
                <Link href={`/operations/${alert.relatedId}`} className="ml-auto flex-shrink-0">
                  <ArrowRight className="w-4 h-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              {alert.relatedId && alert.relatedType === 'tour' && (
                <Link href={`/tours/${alert.relatedId}`} className="ml-auto flex-shrink-0">
                  <ArrowRight className="w-4 h-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              {alert.relatedId && alert.relatedType === 'quotation' && (
                <Link href={`/quotations/${alert.relatedId}`} className="ml-auto flex-shrink-0">
                  <ArrowRight className="w-4 h-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function UpcomingPanel() {
  const { data: upcoming, isLoading, isError, refetch } = useDashUpcoming();

  if (isLoading) return <Skeleton className="h-48 rounded-xl" />;
  if (isError) return (
    <Card><CardContent className="p-4 text-center space-y-2">
      <p className="text-destructive text-sm">Yaklaşan operasyonlar yüklenemedi.</p>
      <Button variant="outline" size="sm" onClick={() => refetch()}>Yeniden Dene</Button>
    </CardContent></Card>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" /> Yaklaşan Operasyonlar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!upcoming || upcoming.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-4">14 gün içinde operasyon yok.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map(op => (
              <Link key={op.id} href={`/operations/${op.id}`}>
                <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{op.tourName ?? `Operasyon #${op.id}`}</p>
                    <p className="text-xs text-muted-foreground">{op.startDate}</p>
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-1.5">
                    {op.assignedGuideUserId || op.guideName ? (
                      <UserCheck className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <UserCheck className="w-3.5 h-3.5 text-orange-400" />
                    )}
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions({ role }: { role: UserRole }) {
  type Action = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; color: string };
  const actions: Action[] = [];

  if (role === 'admin' || role === 'super_admin') {
    actions.push(
      { href: '/requests/new', label: 'Yeni Talep', icon: Sparkles, color: 'text-primary' },
      { href: '/quotations/new', label: 'Yeni Teklif', icon: FileText, color: 'text-blue-600' },
      { href: '/tours/new', label: 'Yeni Tur', icon: MapPin, color: 'text-orange-600' },
      { href: '/operations', label: 'Yeni Operasyon', icon: ClipboardList, color: 'text-teal-600' },
    );
  } else if (role === 'operations') {
    actions.push(
      { href: '/operations', label: 'Yeni Operasyon', icon: ClipboardList, color: 'text-primary' },
      { href: '/operations', label: 'Rehber Ata', icon: Users, color: 'text-blue-600' },
      { href: '/operations', label: 'Görev Ekle', icon: CheckSquare, color: 'text-teal-600' },
    );
  } else if (role === 'accounting') {
    actions.push(
      { href: '/operations', label: 'Makbuzları Gör', icon: Receipt, color: 'text-primary' },
      { href: '/quotations', label: 'Teklifleri Gör', icon: FileText, color: 'text-blue-600' },
    );
  } else if (role === 'guide') {
    actions.push(
      { href: '/operations', label: 'Operasyonuma Git', icon: ClipboardList, color: 'text-primary' },
      { href: '/operations', label: 'Makbuz Ekle', icon: Camera, color: 'text-teal-600' },
      { href: '/operations', label: 'Görevlerimi Gör', icon: CheckSquare, color: 'text-blue-600' },
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Hızlı İşlemler</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map(({ href, label, icon: Icon, color }) => (
          <Link key={label} href={href}>
            <Button className="w-full justify-start gap-2" variant="outline" size="sm">
              <Icon className={`w-4 h-4 ${color}`} />
              {label}
            </Button>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Admin / SuperAdmin dashboard ───────────────────────────────────────────────

function AdminDashboard({ name, role }: { name?: string | null; role: UserRole }) {
  const { data: stats, isLoading: sL, isError: sE, refetch: sR } = useDashStats();
  const { data: charts, isLoading: cL, isError: cE, refetch: cR } = useDashCharts();

  const statsLoading = sL;

  return (
    <AppShell title="Kontrol Paneli">
      <DashboardHeader name={name} role={role} />

      {/* KPI row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <KPICard label="Bugünkü Operasyonlar" value={stats?.todayOperations}
          icon={ClipboardList} iconColor="text-teal-600" loading={statsLoading} />
        <KPICard label="Aktif Turlar" value={stats?.activeTours}
          icon={MapPin} iconColor="text-blue-600" loading={statsLoading} />
        <KPICard label="Bekleyen Teklifler" value={stats?.pendingQuotations}
          icon={FileText} iconColor="text-purple-600" loading={statsLoading} />
        <KPICard label="Günün Görevleri" value={stats?.tasksDueToday}
          icon={CheckSquare} iconColor="text-orange-600" loading={statsLoading} />
      </div>

      {/* KPI row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard label="Tahmini Gelir"
          value={stats ? formatCurrency(stats.totalEstimatedRevenue ?? 0, stats.currency ?? 'TRY') : undefined}
          icon={TrendingUp} iconColor="text-green-600" loading={statsLoading} />
        <KPICard label="Ort. Kar Marjı" value={stats ? `%${stats.avgProfitMargin}` : undefined}
          icon={TrendingUp} iconColor="text-emerald-600" loading={statsLoading} />
        <KPICard label="Rehber Atanmamış" value={stats?.missingGuideAssignments}
          icon={Users} alert loading={statsLoading}
          subtitle="Yaklaşan 7 gün" />
        <KPICard label="Fotoğrafsız Makbuz" value={stats?.receiptsMissingPhotos}
          icon={Camera} alert loading={statsLoading} />
      </div>

      {sE && (
        <div className="mb-6 text-center">
          <p className="text-destructive text-sm mb-2">İstatistikler yüklenemedi.</p>
          <Button variant="outline" size="sm" onClick={() => sR()}>Yeniden Dene</Button>
        </div>
      )}

      {/* Chart + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Aylık Teklifler (Son 6 Ay)</CardTitle>
          </CardHeader>
          <CardContent>
            {cL ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : cE ? (
              <div className="h-[200px] flex flex-col items-center justify-center gap-2">
                <p className="text-destructive text-sm">Grafik yüklenemedi.</p>
                <Button variant="outline" size="sm" onClick={() => cR()}>Yeniden Dene</Button>
              </div>
            ) : charts?.monthlyQuotations?.some(p => p.value > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={charts.monthlyQuotations}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Teklif" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                Henüz veri yok.
              </div>
            )}
          </CardContent>
        </Card>
        <QuickActions role={role} />
      </div>

      {/* Alerts + Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlertsPanel />
        <UpcomingPanel />
      </div>
    </AppShell>
  );
}

// ── Operations dashboard ───────────────────────────────────────────────────────

function OperationsDashboard({ name }: { name?: string | null }) {
  const { data: stats, isLoading: sL, isError: sE, refetch: sR } = useDashStats();
  const { data: charts, isLoading: cL, isError: cE, refetch: cR } = useDashCharts();

  return (
    <AppShell title="Kontrol Paneli">
      <DashboardHeader name={name} role="operations" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        <KPICard label="Bugünkü Operasyonlar" value={stats?.todayOperations}
          icon={ClipboardList} iconColor="text-teal-600" loading={sL} />
        <KPICard label="Rehbersiz Operasyon" value={stats?.unassignedCount}
          icon={Users} alert loading={sL} subtitle="Durum: aktif" />
        <KPICard label="Eksik Görevler" value={stats?.incompleteTasksCount}
          icon={CheckSquare} iconColor="text-orange-600" loading={sL} />
        <KPICard label="Yaklaşan Hareket (7 gün)" value={stats?.upcomingDepartures}
          icon={Calendar} iconColor="text-blue-600" loading={sL} />
        <KPICard label="Ort. Tamamlanma" value={stats ? `%${stats.avgCompletionRate}` : undefined}
          icon={TrendingUp} iconColor="text-green-600" loading={sL}
          subtitle="Aktif operasyonlar" />
      </div>

      {sE && (
        <div className="mb-6 text-center">
          <p className="text-destructive text-sm mb-2">İstatistikler yüklenemedi.</p>
          <Button variant="outline" size="sm" onClick={() => sR()}>Yeniden Dene</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Aylık Teklifler (Son 6 Ay)</CardTitle>
          </CardHeader>
          <CardContent>
            {cL ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : cE ? (
              <div className="h-[200px] flex flex-col items-center justify-center gap-2">
                <p className="text-destructive text-sm">Grafik yüklenemedi.</p>
                <Button variant="outline" size="sm" onClick={() => cR()}>Yeniden Dene</Button>
              </div>
            ) : charts?.monthlyQuotations?.some(p => p.value > 0) ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={charts.monthlyQuotations}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Teklif" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                Henüz veri yok.
              </div>
            )}
          </CardContent>
        </Card>
        <QuickActions role="operations" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AlertsPanel />
        <UpcomingPanel />
      </div>
    </AppShell>
  );
}

// ── Accounting dashboard ───────────────────────────────────────────────────────

function AccountingDashboard({ name }: { name?: string | null }) {
  const { data: stats, isLoading: sL, isError: sE, refetch: sR } = useDashStats();

  return (
    <AppShell title="Kontrol Paneli">
      <DashboardHeader name={name} role="accounting" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <KPICard label="Toplam Makbuz" value={stats?.receiptCount}
          icon={Receipt} iconColor="text-teal-600" loading={sL} />
        <KPICard label="Fotoğrafsız Makbuz" value={stats?.receiptsMissingPhotos}
          icon={Camera} alert loading={sL} />
        <KPICard label="Kayıtlı Gider (TRY)"
          value={stats ? formatCurrency(stats.totalRecordedExpenses ?? 0, 'TRY') : undefined}
          icon={TrendingUp} iconColor="text-green-600" loading={sL} />
        <KPICard label="İşlem Bekleyen Teklif" value={stats?.pendingQuotations}
          icon={FileText} iconColor="text-purple-600" loading={sL} />
      </div>

      {sE && (
        <div className="mb-6 text-center">
          <p className="text-destructive text-sm mb-2">İstatistikler yüklenemedi.</p>
          <Button variant="outline" size="sm" onClick={() => sR()}>Yeniden Dene</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AlertsPanel />
          <UpcomingPanel />
        </div>
        <QuickActions role="accounting" />
      </div>
    </AppShell>
  );
}

// ── Guide dashboard ────────────────────────────────────────────────────────────

const OP_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: 'Aktif', color: 'bg-green-100 text-green-800' },
  completed: { label: 'Tamamlandı', color: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'İptal', color: 'bg-red-100 text-red-700' },
  pending: { label: 'Beklemede', color: 'bg-yellow-100 text-yellow-800' },
  archived: { label: 'Arşiv', color: 'bg-gray-100 text-gray-500' },
};

function GuideDashboard({ name }: { name?: string | null }) {
  const { data: stats, isLoading: sL, isError: sE, refetch: sR } = useDashStats();
  const { data: guideOps, isLoading: gL, isError: gE, refetch: gR } = useDashGuideOps();
  const { data: notifications } = useListNotifications();

  const today = new Date().toISOString().split('T')[0];
  const todayOp = guideOps?.find(op => op.startDate === today);
  const unreadNotifs = notifications?.filter(n => !n.isRead).slice(0, 5) ?? [];

  return (
    <AppShell title="Kontrol Paneli">
      <DashboardHeader name={name} role="guide" />

      {/* Today's operation — prominent card */}
      {!gL && (
        <div className="mb-6">
          {todayOp ? (
            <Link href={`/operations/${todayOp.id}`}>
              <Card className="border-2 border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="text-xs font-semibold text-primary uppercase tracking-wide">Bugünkü Operasyon</span>
                      </div>
                      <h3 className="font-bold text-foreground text-lg truncate">
                        {todayOp.tourName ?? `Operasyon #${todayOp.id}`}
                      </h3>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {todayOp.startDate}{todayOp.endDate && todayOp.endDate !== todayOp.startDate ? ` – ${todayOp.endDate}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <Badge className={`text-xs border-0 ${OP_STATUS_LABELS[todayOp.status]?.color ?? 'bg-gray-100'}`}>
                        {OP_STATUS_LABELS[todayOp.status]?.label ?? todayOp.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">%{todayOp.completionRate ?? 0} tamamlandı</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ) : (
            <Card className="border border-dashed">
              <CardContent className="p-4 text-center text-muted-foreground text-sm">
                Bugün için atanmış operasyon bulunmuyor.
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {gL && <Skeleton className="h-28 rounded-xl mb-6" />}

      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <KPICard label="Atanan Operasyon" value={stats?.assignedOperationsCount}
          icon={ClipboardList} iconColor="text-teal-600" loading={sL} />
        <KPICard label="Bugün" value={stats?.todayOperationsCount}
          icon={Calendar} iconColor="text-blue-600" loading={sL} />
        <KPICard label="Bekleyen Görev" value={stats?.pendingTasksCount}
          icon={CheckSquare} alert loading={sL} />
      </div>

      {(sE || gE) && (
        <div className="mb-6 text-center space-y-1">
          <p className="text-destructive text-sm">Veri yüklenemedi.</p>
          <div className="flex justify-center gap-2">
            {sE && <Button variant="outline" size="sm" onClick={() => sR()}>Yeniden Dene</Button>}
            {gE && <Button variant="outline" size="sm" onClick={() => gR()}>Operasyonları Yenile</Button>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Assigned operations list */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="w-4 h-4 text-primary" /> Operasyonlarım
              </CardTitle>
            </CardHeader>
            <CardContent>
              {gL ? (
                <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : !guideOps || guideOps.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-4">Henüz atanmış operasyon yok.</p>
              ) : (
                <div className="space-y-2">
                  {guideOps.map(op => (
                    <Link key={op.id} href={`/operations/${op.id}`}>
                      <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${op.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {op.tourName ?? `Operasyon #${op.id}`}
                          </p>
                          <p className="text-xs text-muted-foreground">{op.startDate}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted-foreground">%{op.completionRate ?? 0}</span>
                          <Badge className={`text-xs border-0 ${OP_STATUS_LABELS[op.status]?.color ?? 'bg-gray-100'}`}>
                            {OP_STATUS_LABELS[op.status]?.label ?? op.status}
                          </Badge>
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent notifications */}
          {unreadNotifs.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" /> Son Bildirimler
                  <Link href="/notifications" className="ml-auto text-xs text-primary hover:underline">Tümünü Gör</Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {unreadNotifs.map((n: { id: number; title: string; message?: string | null }) => (
                  <div key={n.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/30">
                    <Bell className="w-3.5 h-3.5 mt-0.5 text-primary flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      {n.message && <p className="text-xs text-muted-foreground truncate">{n.message}</p>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Quick actions */}
        <QuickActions role="guide" />
      </div>
    </AppShell>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { role, isLoading } = useProfile();
  const { data: me } = useGetMyProfile();

  if (isLoading) {
    return (
      <AppShell title="Kontrol Paneli">
        <div className="space-y-4">
          <Skeleton className="h-14 w-64 rounded-lg" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Skeleton className="h-64 rounded-xl lg:col-span-2" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        </div>
      </AppShell>
    );
  }

  const name = me?.name ?? null;

  if (role === 'guide') return <GuideDashboard name={name} />;
  if (role === 'accounting') return <AccountingDashboard name={name} />;
  if (role === 'operations') return <OperationsDashboard name={name} />;
  return <AdminDashboard name={name} role={role ?? 'admin'} />;
}

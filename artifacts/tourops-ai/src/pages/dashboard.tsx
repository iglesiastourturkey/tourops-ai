import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  useGetDashboardStats, useGetDashboardAlerts, useGetDashboardCharts,
} from '@workspace/api-client-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { MapPin, FileText, Sparkles, AlertTriangle, Info, TrendingUp, Calendar, CheckSquare } from 'lucide-react';
import { formatCurrency } from '@/lib/labels';

const SEVERITY_STYLES: Record<string, { bg: string; icon: typeof AlertTriangle }> = {
  critical: { bg: 'bg-red-50 border-red-200', icon: AlertTriangle },
  warning: { bg: 'bg-yellow-50 border-yellow-200', icon: AlertTriangle },
  info: { bg: 'bg-blue-50 border-blue-200', icon: Info },
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useGetDashboardStats();
  const { data: alerts, isLoading: alertsLoading, isError: alertsError, refetch: refetchAlerts } = useGetDashboardAlerts();
  const { data: charts, isLoading: chartsLoading, isError: chartsError, refetch: refetchCharts } = useGetDashboardCharts();

  const kpis = stats ? [
    { label: 'Aktif Turlar', value: stats.activeTours, icon: MapPin, color: 'text-teal-600' },
    { label: 'Bekleyen Teklifler', value: stats.pendingQuotations, icon: FileText, color: 'text-blue-600' },
    { label: 'Yaklaşan Hareket', value: stats.upcomingDepartures, icon: Calendar, color: 'text-orange-600' },
    { label: 'Günün Görevleri', value: stats.tasksDueToday, icon: CheckSquare, color: 'text-purple-600' },
    { label: 'Tahmini Gelir', value: formatCurrency(stats.totalEstimatedRevenue, stats.currency), icon: TrendingUp, color: 'text-green-600' },
    { label: 'Ort. Kar Marjı', value: `%${stats.avgProfitMargin}`, icon: TrendingUp, color: 'text-emerald-600' },
  ] : [];

  return (
    <AppShell title="Kontrol Paneli">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statsLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : statsError
          ? (
            <div className="col-span-2 lg:col-span-4 text-center py-6 space-y-2">
              <p className="text-destructive text-sm">İstatistikler yüklenemedi.</p>
              <Button variant="outline" size="sm" onClick={() => refetchStats()}>Yeniden Dene</Button>
            </div>
          )
          : kpis.map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground font-medium">{label}</span>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div className="text-2xl font-bold text-foreground">{value}</div>
              </CardContent>
            </Card>
          ))
        }
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Aylık Teklifler</CardTitle>
          </CardHeader>
          <CardContent>
            {chartsLoading ? (
              <div className="h-[220px] flex items-center justify-center"><Skeleton className="h-full w-full rounded-lg" /></div>
            ) : chartsError ? (
              <div className="h-[220px] flex flex-col items-center justify-center gap-2">
                <p className="text-destructive text-sm">Grafik yüklenemedi.</p>
                <Button variant="outline" size="sm" onClick={() => refetchCharts()}>Yeniden Dene</Button>
              </div>
            ) : charts?.monthlyQuotations && charts.monthlyQuotations.some(p => p.value > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={charts.monthlyQuotations}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Teklif Sayısı" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">Henüz veri yok.</div>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Hızlı İşlemler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/requests/new">
              <Button className="w-full justify-start gap-2" variant="outline" data-testid="btn-quick-new-request">
                <Sparkles className="w-4 h-4 text-primary" /> Yeni Müşteri Talebi
              </Button>
            </Link>
            <Link href="/quotations/new">
              <Button className="w-full justify-start gap-2" variant="outline" data-testid="btn-quick-new-quotation">
                <FileText className="w-4 h-4 text-blue-600" /> Yeni Teklif
              </Button>
            </Link>
            <Link href="/tours/new">
              <Button className="w-full justify-start gap-2" variant="outline" data-testid="btn-quick-new-tour">
                <MapPin className="w-4 h-4 text-orange-600" /> Yeni Tur
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      {alertsLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : alertsError ? (
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-destructive text-sm">Uyarılar yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetchAlerts()}>Yeniden Dene</Button>
          </CardContent>
        </Card>
      ) : alerts && alerts.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Dikkat Gerektiren İşlemler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map(alert => {
              const { bg, icon: Icon } = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
              return (
                <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${bg}`} data-testid={`alert-${alert.id}`}>
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-current opacity-70" />
                  <p className="text-sm text-foreground">{alert.message}</p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            Dikkat gerektiren işlem bulunmuyor.
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

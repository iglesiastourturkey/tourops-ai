import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/labels';
import {
  TrendingUp, TrendingDown, DollarSign, Clock, AlertTriangle,
  FileText, BarChart3, ArrowRight, RefreshCw
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

interface DashboardStats {
  thisMonthIncome: number;
  thisMonthExpenses: number;
  grossProfit: number;
  pendingReviewCount: number;
  missingPhotoCount: number;
  unpaidTransactions: number;
  upcomingDue: Array<{ id: number; dueDate: string; amount: number; currency: string; description?: string; type: string }>;
  categoryBreakdown: Record<string, number>;
  monthlyChart: Array<{ label: string; income: number; expenses: number }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  transportation: 'Ulaşım', guide: 'Rehber', hotel: 'Otel', restaurant: 'Restoran',
  activity: 'Aktivite', entrance_ticket: 'Giriş Bileti', fuel: 'Yakıt', parking: 'Park',
  commission: 'Komisyon', office: 'Ofis', tax: 'Vergi', other: 'Diğer',
  customer_payment: 'Müşteri Ödemesi', quotation_payment: 'Teklif Ödemesi',
  operation_income: 'Operasyon Geliri',
};

function KpiCard({ icon: Icon, label, value, variant = 'default', link }: {
  icon: React.ElementType; label: string; value: string | number;
  variant?: 'default' | 'success' | 'warning' | 'danger'; link?: string;
}) {
  const colors = {
    default: 'text-foreground',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  };
  return (
    <Card className={link ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}>
      <CardContent className="flex items-center gap-4 pt-5 pb-4 px-5">
        <div className="p-2.5 rounded-lg bg-[#1e3a5f]/10">
          <Icon className="h-5 w-5 text-[#1e3a5f]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className={`text-xl font-bold ${colors[variant]}`}>{value}</p>
        </div>
        {link && <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      </CardContent>
    </Card>
  );
}

export default function AccountingDashboardPage() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'dashboard'],
    queryFn: () => customFetch<DashboardStats>(`${API_BASE}/accounting/dashboard`),
    staleTime: 60_000,
  });

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#1e3a5f]">Muhasebe Paneli</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Bu ay gelir-gider özeti ve bekleyen işlemler</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Yenile
            </Button>
            <Link href="/accounting/reports">
              <Button size="sm" className="bg-[#0d7377] hover:bg-[#0d7377]/90">
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" />Raporlar &amp; İhracat
              </Button>
            </Link>
          </div>
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">Veriler yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">Yeniden Dene</Button>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {isLoading ? Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-5 pb-4 px-5"><Skeleton className="h-14 w-full" /></CardContent></Card>
          )) : data && <>
            <Link href="/accounting/transactions?type=income">
              <KpiCard icon={TrendingUp} label="Bu ay gelir" value={formatCurrency(data.thisMonthIncome)} variant="success" link="/accounting/transactions?type=income" />
            </Link>
            <Link href="/accounting/transactions?type=expense">
              <KpiCard icon={TrendingDown} label="Bu ay gider" value={formatCurrency(data.thisMonthExpenses)} variant="danger" link="/accounting/transactions?type=expense" />
            </Link>
            <KpiCard icon={DollarSign} label="Tahmini kar" value={formatCurrency(data.grossProfit)} variant={data.grossProfit >= 0 ? 'success' : 'danger'} />
            <Link href="/accounting/documents">
              <KpiCard icon={Clock} label="İnceleme bekliyor" value={data.pendingReviewCount} variant={data.pendingReviewCount > 0 ? 'warning' : 'default'} link="/accounting/documents" />
            </Link>
            <Link href="/accounting/documents?missingPhoto=true">
              <KpiCard icon={AlertTriangle} label="Fotoğraf eksik" value={data.missingPhotoCount} variant={data.missingPhotoCount > 0 ? 'warning' : 'default'} link="/accounting/documents?missingPhoto=true" />
            </Link>
            <Link href="/accounting/transactions?paymentStatus=pending&type=income">
              <KpiCard icon={FileText} label="Ödeme bekliyor" value={data.unpaidTransactions} variant={data.unpaidTransactions > 0 ? 'warning' : 'default'} link="/accounting/transactions" />
            </Link>
          </>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Monthly chart */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-[#1e3a5f]">Aylık Gelir vs Gider (TRY)</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-64 w-full" /> : data && (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.monthlyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'income' ? 'Gelir' : 'Gider'} />
                    <Bar dataKey="income" fill="#0d7377" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="expenses" fill="#1e3a5f" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Category breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-[#1e3a5f]">Gider Kategorileri (Bu ay)</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5 w-full mb-2" />) :
              data && Object.entries(data.categoryBreakdown).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Bu ay gider kaydı yok</p>
              ) : data && (
                <div className="space-y-2">
                  {Object.entries(data.categoryBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 8)
                    .map(([cat, amt]) => (
                      <div key={cat} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground truncate">
                          {CATEGORY_LABELS[cat] ?? cat}
                        </span>
                        <span className="text-xs font-semibold text-[#1e3a5f] shrink-0">
                          {formatCurrency(amt)}
                        </span>
                      </div>
                    ))
                  }
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Upcoming due payments */}
        {data && data.upcomingDue.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-amber-700 flex items-center gap-2">
                <Clock className="h-4 w-4" />Yaklaşan Vadeli Ödemeler
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.upcomingDue.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.description ?? `İşlem #${item.id}`}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-amber-700 font-medium">{formatCurrency(item.amount, item.currency)}</span>
                      <Badge variant="outline" className="border-amber-300 text-amber-700 text-[10px]">
                        {new Date(item.dueDate).toLocaleDateString('tr-TR')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick navigation */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/accounting/transactions', label: 'Tüm İşlemler', icon: DollarSign },
            { href: '/accounting/documents', label: 'Belgeler', icon: FileText },
            { href: '/accounting/reports', label: 'Raporlar', icon: BarChart3 },
            { href: '/operations', label: 'Operasyonlar', icon: TrendingUp },
          ].map(item => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4 px-4">
                  <item.icon className="h-4 w-4 text-[#0d7377]" />
                  <span className="text-sm font-medium">{item.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

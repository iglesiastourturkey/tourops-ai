import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  FileText, BarChart3, ArrowRight, RefreshCw, AlertCircle, Receipt,
  Bot, Loader2, CheckCircle2, Zap, Info,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

import { API_BASE } from '@/lib/api-base';

const BASE = import.meta.env.BASE_URL ?? '/';

interface DashboardStats {
  thisMonthIncome: number;
  thisMonthExpenses: number;
  grossProfit: number;
  netCashFlow: number;
  pendingReviewCount: number;
  missingPhotoCount: number;
  missingInfoCount: number;
  unpaidTransactions: number;
  pendingReceivablesAmount: number;
  pendingPayablesAmount: number;
  overdueReceivablesCount: number;
  overduePayablesCount: number;
  vatApprovedTotal: number;
  upcomingDue: Array<{ id: number; dueDate: string; amount: number; currency: string; description?: string; type: string }>;
  overdueItems: Array<{ id: number; dueDate: string; amount: number; currency: string; description?: string; type: string }>;
  categoryBreakdown: Record<string, number>;
  monthlyChart: Array<{ label: string; income: number; expenses: number }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  transportation: 'Ulaşım', guide: 'Rehber', hotel: 'Otel', restaurant: 'Restoran',
  activity: 'Aktivite', entrance_ticket: 'Giriş Bileti', fuel: 'Yakıt', parking: 'Park',
  commission: 'Komisyon', office: 'Ofis', tax: 'Vergi', other: 'Diğer',
  customer_payment: 'Müşteri Ödemesi', quotation_payment: 'Teklif Ödemesi',
  operation_income: 'Operasyon Geliri', supplier: 'Tedarikçi', driver: 'Sürücü',
  customer_refund: 'Müşteri İadesi', advance_payment: 'Avans', refund_received: 'İade',
  other_income: 'Diğer Gelir',
};

function KpiCard({ icon: Icon, label, value, variant = 'default', link, sub }: {
  icon: React.ElementType; label: string; value: string | number;
  variant?: 'default' | 'success' | 'warning' | 'danger'; link?: string; sub?: string;
}) {
  const colors = {
    default: 'text-foreground', success: 'text-emerald-600',
    warning: 'text-amber-600', danger: 'text-red-600',
  };
  const content = (
    <Card className={link ? 'hover:shadow-md transition-shadow cursor-pointer' : ''}>
      <CardContent className="flex items-center gap-3 pt-4 pb-3 px-4">
        <div className="p-2 rounded-lg bg-[#1e3a5f]/10 shrink-0">
          <Icon className="h-4 w-4 text-[#1e3a5f]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground truncate">{label}</p>
          <p className={`text-lg font-bold leading-tight ${colors[variant]}`}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
        </div>
        {link && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </CardContent>
    </Card>
  );
  return link ? <Link href={link}>{content}</Link> : content;
}

// ── AI Summary types ────────────────────────────────────────────────────────
interface AiWarning {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionType: 'documents' | 'transactions' | 'receivables' | 'payables' | 'operation' | 'report' | 'none';
  filter: Record<string, string>;
}
interface AiRecommendation {
  title: string;
  description: string;
  actionType: AiWarning['actionType'];
  filter: Record<string, string>;
}
interface AiSummaryResponse {
  summary: string;
  warnings: AiWarning[];
  recommendations: AiRecommendation[];
  generatedAt: string;
  dataPeriod: { from: string; to: string };
  cached: boolean;
}

const SEVERITY_CONFIG = {
  critical: { label: 'Kritik', cls: 'bg-red-100 text-red-800 border-red-200', border: 'border-l-red-500' },
  high:     { label: 'Yüksek', cls: 'bg-orange-100 text-orange-800 border-orange-200', border: 'border-l-orange-500' },
  medium:   { label: 'Orta',   cls: 'bg-amber-100 text-amber-800 border-amber-200', border: 'border-l-amber-500' },
  low:      { label: 'Düşük',  cls: 'bg-blue-100 text-blue-700 border-blue-200', border: 'border-l-blue-400' },
};

function actionHref(actionType: AiWarning['actionType'], filter: Record<string, string>): string | null {
  const params = new URLSearchParams(filter).toString();
  const qs = params ? `?${params}` : '';
  switch (actionType) {
    case 'documents':    return `${BASE}accounting/documents${qs}`;
    case 'transactions': return `${BASE}accounting/transactions${qs}`;
    case 'receivables':  return `${BASE}accounting/transactions?type=income&paymentStatus=pending`;
    case 'payables':     return `${BASE}accounting/transactions?type=expense&paymentStatus=pending`;
    case 'report':       return `${BASE}accounting/reports`;
    default:             return null;
  }
}

function getMonthStart() {
  const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0];
}
function getToday() { return new Date().toISOString().split('T')[0]; }

// ── Dashboard page ───────────────────────────────────────────────────────────
export default function AccountingDashboardPage() {
  const queryClient = useQueryClient();

  const [aiFrom, setAiFrom] = useState(getMonthStart);
  const [aiTo, setAiTo]     = useState(getToday);

  const {
    data: aiData, isLoading: aiLoading, isFetching: aiFetching, isError: aiError,
  } = useQuery({
    queryKey: ['accounting', 'ai-summary', aiFrom, aiTo],
    queryFn: () => customFetch<AiSummaryResponse>(`${API_BASE}/accounting/ai-summary?from=${aiFrom}&to=${aiTo}`),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  async function handleAiRefresh() {
    await queryClient.fetchQuery({
      queryKey: ['accounting', 'ai-summary', aiFrom, aiTo],
      queryFn: () => customFetch<AiSummaryResponse>(`${API_BASE}/accounting/ai-summary?from=${aiFrom}&to=${aiTo}&refresh=true`),
      staleTime: 0,
    });
  }

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
            <Button variant="outline" size="sm" onClick={() => refetch()} title="Verileri yenile" aria-label="Verileri yenile">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Yenile
            </Button>
            <Link href="/accounting/reports">
              <Button size="sm" className="bg-[#0d7377] hover:bg-[#0a5e62] text-white font-medium" title="PDF, Excel veya ZIP olarak dışa aktar">
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

        {/* Row 1: Core financials */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {isLoading ? Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-3 px-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
          )) : data && <>
            <KpiCard icon={TrendingUp} label="Bu Ay Gelir" value={formatCurrency(data.thisMonthIncome)} variant="success" link="/accounting/transactions?type=income" />
            <KpiCard icon={TrendingDown} label="Bu Ay Gider" value={formatCurrency(data.thisMonthExpenses)} variant="danger" link="/accounting/transactions?type=expense" />
            <KpiCard icon={DollarSign} label="Net Nakit Akışı" value={formatCurrency(data.netCashFlow)} variant={data.netCashFlow >= 0 ? 'success' : 'danger'} />
            <KpiCard icon={Clock} label="İnceleme Bekliyor" value={data.pendingReviewCount} variant={data.pendingReviewCount > 0 ? 'warning' : 'default'} link="/accounting/documents" />
            <KpiCard icon={AlertTriangle} label="Fotoğraf Eksik" value={data.missingPhotoCount} variant={data.missingPhotoCount > 0 ? 'warning' : 'default'} link="/accounting/documents?missingPhoto=true" />
            <KpiCard icon={AlertCircle} label="Eksik Bilgi" value={data.missingInfoCount} variant={data.missingInfoCount > 0 ? 'warning' : 'default'} link="/accounting/documents" />
          </>}
        </div>

        {/* Row 2: Receivables / payables / VAT */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {isLoading ? Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-3 px-4"><Skeleton className="h-14 w-full" /></CardContent></Card>
          )) : data && <>
            <KpiCard
              icon={TrendingUp}
              label="Tahsilat Bekleyen"
              value={formatCurrency(data.pendingReceivablesAmount)}
              variant="success"
              link="/accounting/transactions?type=income&paymentStatus=pending"
              sub={data.unpaidTransactions > 0 ? `${data.unpaidTransactions} işlem` : undefined}
            />
            <KpiCard
              icon={TrendingDown}
              label="Ödeme Bekleyen"
              value={formatCurrency(data.pendingPayablesAmount)}
              variant={data.pendingPayablesAmount > 0 ? 'warning' : 'default'}
              link="/accounting/transactions?type=expense&paymentStatus=pending"
            />
            <KpiCard
              icon={AlertTriangle}
              label="Vadesi Geçen Alacak"
              value={data.overdueReceivablesCount}
              variant={data.overdueReceivablesCount > 0 ? 'danger' : 'default'}
              link="/accounting/transactions?type=income&paymentStatus=pending"
            />
            <KpiCard
              icon={AlertTriangle}
              label="Vadesi Geçen Borç"
              value={data.overduePayablesCount}
              variant={data.overduePayablesCount > 0 ? 'danger' : 'default'}
              link="/accounting/transactions?type=expense&paymentStatus=pending"
            />
            <KpiCard
              icon={Receipt}
              label="KDV Özeti (Onaylı)"
              value={formatCurrency(data.vatApprovedTotal)}
              variant="default"
            />
          </>}
        </div>

        {/* ── AI Accounting Assistant ──────────────────────────────────────── */}
        <Card className="border-[#0d7377]/30 bg-gradient-to-br from-[#0d7377]/5 to-transparent">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#0d7377]/10">
                  <Bot className="h-4 w-4 text-[#0d7377]" />
                </div>
                <div>
                  <CardTitle className="text-base text-[#1e3a5f] flex items-center gap-2">
                    AI Muhasebe Asistanı
                    {aiData?.cached && (
                      <Badge variant="outline" className="text-[10px] font-normal border-blue-200 text-blue-600 py-0">
                        <CheckCircle2 className="h-2.5 w-2.5 mr-1" />Önbellekten
                      </Badge>
                    )}
                  </CardTitle>
                  {aiData && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {new Date(aiData.generatedAt).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })} · {aiData.dataPeriod.from} – {aiData.dataPeriod.to}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date" value={aiFrom} max={aiTo}
                  onChange={e => setAiFrom(e.target.value)}
                  className="text-xs border rounded-md px-2 py-1 bg-background h-8"
                  aria-label="Başlangıç tarihi"
                />
                <span className="text-xs text-muted-foreground">–</span>
                <input
                  type="date" value={aiTo} min={aiFrom} max={getToday()}
                  onChange={e => setAiTo(e.target.value)}
                  className="text-xs border rounded-md px-2 py-1 bg-background h-8"
                  aria-label="Bitiş tarihi"
                />
                <Button
                  variant="outline" size="sm"
                  onClick={handleAiRefresh}
                  disabled={aiFetching}
                  title="AI özetini yenile"
                  aria-label="AI özetini yenile"
                  className="h-8"
                >
                  {aiFetching
                    ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Yenileniyor…</>
                    : <><Zap className="h-3.5 w-3.5 mr-1.5" />Yenile</>
                  }
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Loading skeleton */}
            {aiLoading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              </div>
            )}

            {/* Error state */}
            {aiError && !aiLoading && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm text-destructive flex-1">AI özeti yüklenemedi.</p>
                <Button variant="outline" size="sm" onClick={handleAiRefresh}>Yeniden Dene</Button>
              </div>
            )}

            {/* AI result */}
            {aiData && !aiLoading && (
              <>
                {/* Summary */}
                <p className="text-sm leading-relaxed text-foreground">{aiData.summary}</p>

                {/* Warnings */}
                {aiData.warnings.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Uyarılar</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {aiData.warnings.map((w, i) => {
                        const cfg = SEVERITY_CONFIG[w.severity];
                        const href = actionHref(w.actionType, w.filter);
                        return (
                          <div key={i} className={`rounded-lg border border-l-4 p-3 ${cfg.border} bg-background`}>
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-xs font-semibold leading-tight">{w.title}</p>
                              <Badge variant="outline" className={`text-[10px] font-medium shrink-0 ${cfg.cls}`}>
                                {cfg.label}
                              </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug">{w.description}</p>
                            {href && (
                              <a href={href} className="inline-flex items-center gap-1 text-[11px] text-[#0d7377] mt-1.5 hover:underline font-medium">
                                İncele <ArrowRight className="h-2.5 w-2.5" />
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {aiData.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Önerilen Aksiyonlar</p>
                    <div className="space-y-1.5">
                      {aiData.recommendations.map((rec, i) => {
                        const href = actionHref(rec.actionType, rec.filter);
                        return (
                          <div key={i} className="flex items-start gap-2.5 py-1.5 px-3 rounded-lg bg-muted/40 border">
                            <Info className="h-3.5 w-3.5 text-[#0d7377] shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium">{rec.title}</p>
                              <p className="text-[11px] text-muted-foreground">{rec.description}</p>
                            </div>
                            {href && (
                              <a href={href} className="text-[11px] text-[#0d7377] hover:underline shrink-0 font-medium self-center">
                                Git →
                              </a>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Quick actions */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Hızlı Erişim</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'İnceleme Bekleyen Belgeler', href: `${BASE}accounting/documents` },
                      { label: 'Eksik Bilgili Belgeler', href: `${BASE}accounting/documents?status=missing_information` },
                      { label: 'Vadesi Geçen Alacaklar', href: `${BASE}accounting/transactions?type=income&paymentStatus=pending` },
                      { label: 'Vadesi Geçen Borçlar', href: `${BASE}accounting/transactions?type=expense&paymentStatus=pending` },
                      { label: 'Rapor Oluştur', href: `${BASE}accounting/reports` },
                      { label: 'Tüm İşlemler', href: `${BASE}accounting/transactions` },
                    ].map(item => (
                      <a key={item.href} href={item.href}>
                        <Button variant="outline" size="sm" className="h-7 text-xs">
                          {item.label}
                        </Button>
                      </a>
                    ))}
                  </div>
                </div>

                {/* Empty-data notice */}
                {aiData.warnings.length === 0 && aiData.recommendations.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">Bu dönemde analiz için yeterli veri bulunamadı.</p>
                )}

                {/* Disclaimer */}
                <p className="text-[11px] text-muted-foreground border rounded-lg px-3 py-2 bg-muted/20 flex items-start gap-1.5">
                  <Info className="h-3 w-3 shrink-0 mt-0.5" />
                  Bu özet operasyonel destek amaçlıdır; resmî muhasebe, mali müşavirlik veya vergi görüşü değildir.
                </p>
              </>
            )}
          </CardContent>
        </Card>

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
                        <span className="text-xs text-muted-foreground truncate">{CATEGORY_LABELS[cat] ?? cat}</span>
                        <span className="text-xs font-semibold text-[#1e3a5f] shrink-0">{formatCurrency(amt)}</span>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Overdue section */}
        {data && data.overdueItems && data.overdueItems.length > 0 && (
          <Card className="border-red-200 bg-red-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />Vadesi Geçen İşlemler
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.overdueItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {item.type === 'income' ? '↑ ' : '↓ '}{item.description ?? `İşlem #${item.id}`}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${item.type === 'income' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {formatCurrency(item.amount, item.currency)}
                      </span>
                      <Badge variant="outline" className="border-red-300 text-red-700 text-[10px]">
                        Vade: {new Date(item.dueDate).toLocaleDateString('tr-TR')}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming due payments */}
        {data && data.upcomingDue.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/40">
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
            { href: '/accounting/settings', label: 'Muhasebe Ayarları', icon: AlertCircle },
          ].map(item => (
            <Link key={item.href} href={item.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="flex items-center gap-3 py-4 px-4">
                  <item.icon className="h-4 w-4 text-[#0d7377] shrink-0" />
                  <span className="text-sm font-medium">{item.label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto" aria-label="Detayları görüntüle" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Disclaimer */}
        <p className="text-[11px] text-muted-foreground border rounded-lg p-3 bg-muted/30">
          ⚠ Bu ekran operasyonel finans takibi içindir; resmi muhasebe ve vergi beyannamesi yerine geçmez.
        </p>
      </div>
    </AppShell>
  );
}

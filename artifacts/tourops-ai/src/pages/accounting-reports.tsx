import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import { Download, FileSpreadsheet, Archive, FileText as FilePdf, TrendingUp, TrendingDown, RefreshCw, AlertTriangle, Filter } from 'lucide-react';
import { useAuth } from '@clerk/react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

interface Transaction {
  id: number; type: string; category: string; amount: number; currency: string;
  amountTry?: number; paymentStatus: string; accountingStatus: string;
  transactionDate: string; description?: string; documentNumber?: string;
  customerName?: string; supplierName?: string; tourName?: string;
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor', paid: 'Ödendi', partially_paid: 'Kısmi Ödendi', cancelled: 'İptal',
};
const ACCT_STATUS_LABELS: Record<string, string> = {
  pending_review: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', missing_information: 'Eksik',
};

interface Filters {
  type: string; accountingStatus: string; paymentStatus: string;
  currency: string; category: string; dateFrom: string; dateTo: string;
}

export default function AccountingReportsPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();

  const [filters, setFilters] = useState<Filters>({
    type: '', accountingStatus: '', paymentStatus: '', currency: '', category: '', dateFrom: '', dateTo: '',
  });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const queryParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) queryParams.set(k, v); });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'transactions', filters],
    queryFn: () => customFetch<Transaction[]>(`${API_BASE}/accounting/transactions?${queryParams}`),
  });

  function toggleAll() {
    if (!data) return;
    if (selectedIds.size === data.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(data.map(t => t.id)));
  }

  function toggleRow(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function downloadExport(format: 'pdf' | 'excel' | 'zip') {
    setDownloading(format);
    try {
      const token = await getToken();
      const activeFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const resp = await fetch(`${API_BASE}/accounting/export/${format}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: activeFilters }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'excel' ? 'xlsx' : format === 'zip' ? 'zip' : 'pdf';
      a.download = `muhasebe-raporu-${Date.now()}.${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: `${format.toUpperCase()} başarıyla indirildi` });
    } catch {
      toast({ title: 'İndirme başarısız', description: 'Lütfen tekrar deneyin', variant: 'destructive' });
    } finally { setDownloading(null); }
  }

  const rows = data ?? [];
  const income = rows.filter(t => t.type === 'income');
  const expenses = rows.filter(t => t.type === 'expense');
  const totalIncome = income.reduce((s, t) => s + (t.amountTry ?? (t.currency === 'TRY' ? t.amount : 0)), 0);
  const totalExpenses = expenses.reduce((s, t) => s + (t.amountTry ?? (t.currency === 'TRY' ? t.amount : 0)), 0);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#1e3a5f]">Raporlar &amp; Dışa Aktarma</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Filtrele, incele ve PDF/Excel/ZIP olarak indir</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFilters(v => !v)}>
              <Filter className="h-3.5 w-3.5 mr-1.5" />Filtreler
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Yenile
            </Button>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">İşlem Türü</Label>
                  <Select value={filters.type || '__all__'} onValueChange={v => setFilters(f => ({ ...f, type: v === '__all__' ? '' : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Tümü</SelectItem>
                      <SelectItem value="income">Gelir</SelectItem>
                      <SelectItem value="expense">Gider</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Muhasebe Durumu</Label>
                  <Select value={filters.accountingStatus || '__all__'} onValueChange={v => setFilters(f => ({ ...f, accountingStatus: v === '__all__' ? '' : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Tümü</SelectItem>
                      <SelectItem value="pending_review">Bekliyor</SelectItem>
                      <SelectItem value="approved">Onaylandı</SelectItem>
                      <SelectItem value="rejected">Reddedildi</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Ödeme Durumu</Label>
                  <Select value={filters.paymentStatus || '__all__'} onValueChange={v => setFilters(f => ({ ...f, paymentStatus: v === '__all__' ? '' : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Tümü</SelectItem>
                      <SelectItem value="pending">Bekliyor</SelectItem>
                      <SelectItem value="paid">Ödendi</SelectItem>
                      <SelectItem value="partially_paid">Kısmi</SelectItem>
                      <SelectItem value="cancelled">İptal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Para Birimi</Label>
                  <Select value={filters.currency || '__all__'} onValueChange={v => setFilters(f => ({ ...f, currency: v === '__all__' ? '' : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Tümü</SelectItem>
                      {['TRY', 'USD', 'EUR', 'GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Başlangıç</Label>
                  <Input type="date" className="h-8 text-sm" value={filters.dateFrom}
                    onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Bitiş</Label>
                  <Input type="date" className="h-8 text-sm" value={filters.dateTo}
                    onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
                </div>
                <div className="flex items-end">
                  <Button variant="outline" size="sm" className="h-8"
                    onClick={() => setFilters({ type: '', accountingStatus: '', paymentStatus: '', currency: '', category: '', dateFrom: '', dateTo: '' })}>
                    Filtreleri Temizle
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary + Export */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-xs text-muted-foreground">Toplam Gelir</p>
                <p className="text-lg font-bold text-emerald-600">{isLoading ? '…' : formatCurrency(totalIncome)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-3">
              <TrendingDown className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-xs text-muted-foreground">Toplam Gider</p>
                <p className="text-lg font-bold text-red-600">{isLoading ? '…' : formatCurrency(totalExpenses)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground mb-2.5">Dışa Aktar ({rows.length} kayıt)</p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!downloading}
                  onClick={() => downloadExport('pdf')}>
                  {downloading === 'pdf' ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <FilePdf className="h-3 w-3 mr-1" />}
                  PDF
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!downloading}
                  onClick={() => downloadExport('excel')}>
                  {downloading === 'excel' ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <FileSpreadsheet className="h-3 w-3 mr-1" />}
                  Excel
                </Button>
                <Button size="sm" className="h-7 text-xs bg-[#1e3a5f] hover:bg-[#1e3a5f]/90" disabled={!!downloading}
                  onClick={() => downloadExport('zip')}>
                  {downloading === 'zip' ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> : <Archive className="h-3 w-3 mr-1" />}
                  ZIP
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Veriler yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">Yeniden Dene</Button>
          </div>
        )}

        {/* Results table */}
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1e3a5f]/5 border-b">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-3">
                    <Checkbox checked={!!data && data.length > 0 && selectedIds.size === data.length} onCheckedChange={toggleAll} />
                  </th>
                  <th className="px-4 py-3 font-medium">Tarih</th>
                  <th className="px-4 py-3 font-medium">Tür</th>
                  <th className="px-4 py-3 font-medium">Kategori</th>
                  <th className="px-4 py-3 font-medium">Açıklama</th>
                  <th className="px-4 py-3 font-medium text-right">Tutar</th>
                  <th className="px-4 py-3 font-medium">Muhasebe</th>
                  <th className="px-4 py-3 font-medium">Ödeme</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={8} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                )) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                    Filtrelere uygun işlem bulunamadı
                  </td></tr>
                ) : rows.map(tx => (
                  <tr key={tx.id} className={`hover:bg-muted/30 transition-colors ${selectedIds.has(tx.id) ? 'bg-[#0d7377]/5' : ''}`}>
                    <td className="px-3 py-3">
                      <Checkbox checked={selectedIds.has(tx.id)} onCheckedChange={() => toggleRow(tx.id)} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{tx.transactionDate}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {tx.type === 'income'
                          ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                          : <TrendingDown className="h-3.5 w-3.5 text-red-500" />}
                        <span className="text-xs">{tx.type === 'income' ? 'Gelir' : 'Gider'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{tx.category}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px] truncate">
                      {tx.description ?? tx.customerName ?? tx.supplierName ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-sm whitespace-nowrap">
                      {formatCurrency(tx.amount, tx.currency)}
                      {tx.amountTry && tx.currency !== 'TRY' && (
                        <div className="text-[10px] text-muted-foreground">{formatCurrency(tx.amountTry)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px]">
                        {ACCT_STATUS_LABELS[tx.accountingStatus] ?? tx.accountingStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="text-[10px]">
                        {PAYMENT_STATUS_LABELS[tx.paymentStatus] ?? tx.paymentStatus}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedIds.size > 0 && (
            <div className="border-t px-4 py-3 flex items-center gap-3 bg-[#0d7377]/5">
              <span className="text-sm text-muted-foreground">{selectedIds.size} satır seçildi</span>
              <div className="flex gap-2 ml-auto">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
                  Seçimi Kaldır
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}

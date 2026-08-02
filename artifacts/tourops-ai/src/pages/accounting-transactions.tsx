import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import {
  Plus, MoreHorizontal, CheckCircle, XCircle, AlertCircle, Ban,
  RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CreditCard
} from 'lucide-react';
import { useAuth } from '@clerk/react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

interface Transaction {
  id: number; type: string; category: string; amount: number; currency: string;
  amountTry?: number; taxRate?: number; taxAmount?: number; netAmount?: number;
  paymentStatus: string; accountingStatus: string; paymentMethod?: string;
  transactionDate: string; dueDate?: string; description?: string;
  documentNumber?: string; operationId?: number; receiptId?: number;
  customerName?: string; supplierName?: string; tourName?: string;
  createdAt: string;
}

const INCOME_CATEGORIES = [
  { value: 'customer_payment', label: 'Müşteri Ödemesi' },
  { value: 'advance_payment', label: 'Avans Ödemesi' },
  { value: 'quotation_payment', label: 'Teklif Ödemesi' },
  { value: 'operation_income', label: 'Operasyon Geliri' },
  { value: 'refund_received', label: 'İade Alındı' },
  { value: 'other_income', label: 'Diğer Gelir' },
];
const EXPENSE_CATEGORIES = [
  { value: 'supplier', label: 'Tedarikçi Ödemesi' },
  { value: 'guide', label: 'Rehber Ödemesi' },
  { value: 'driver', label: 'Sürücü/Transfer' },
  { value: 'hotel', label: 'Otel' },
  { value: 'restaurant', label: 'Restoran' },
  { value: 'entrance_ticket', label: 'Giriş Bileti' },
  { value: 'fuel', label: 'Yakıt' },
  { value: 'parking', label: 'Park' },
  { value: 'commission', label: 'Komisyon' },
  { value: 'tax', label: 'Vergi' },
  { value: 'office', label: 'Ofis Gideri' },
  { value: 'customer_refund', label: 'Müşteri İadesi' },
  { value: 'other', label: 'Diğer' },
];
const ALL_CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(INCOME_CATEGORIES.map(c => [c.value, c.label])),
  ...Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.value, c.label])),
  transportation: 'Ulaşım', activity: 'Aktivite',
};

const VAT_RATES = ['0', '1', '8', '10', '20'];
const PAYMENT_METHODS = ['Nakit', 'Kredi Kartı', 'Havale/EFT', 'Çek', 'Döviz'];

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor', paid: 'Ödendi', partially_paid: 'Kısmi Ödendi', cancelled: 'İptal',
};
const ACCT_STATUS_LABELS: Record<string, string> = {
  pending_review: 'İnceleme Bekliyor', approved: 'Onaylandı',
  rejected: 'Reddedildi', missing_information: 'Eksik Bilgi',
};
const ACCT_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800', missing_information: 'bg-orange-100 text-orange-800',
};
const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'border-amber-200 text-amber-700',
  paid: 'border-emerald-200 text-emerald-700',
  partially_paid: 'border-blue-200 text-blue-700',
  cancelled: 'border-gray-200 text-gray-500',
};

interface CreateForm {
  type: string; category: string; amount: string; currency: string;
  transactionDate: string; dueDate: string; description: string;
  paymentStatus: string; documentNumber: string; paymentMethod: string;
  taxRate: string; vatInclusive: boolean;
}

const DEFAULT_FORM: CreateForm = {
  type: 'expense', category: 'other', amount: '', currency: 'TRY',
  transactionDate: '', dueDate: '', description: '',
  paymentStatus: 'pending', documentNumber: '', paymentMethod: '',
  taxRate: '0', vatInclusive: false,
};

export default function AccountingTransactionsPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const [filters, setFilters] = useState({ type: '', accountingStatus: '', paymentStatus: '', dateFrom: '', dateTo: '' });
  const queryParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) queryParams.set(k, v); });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'transactions', filters],
    queryFn: () => customFetch<Transaction[]>(`${API_BASE}/accounting/transactions?${queryParams}`),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateForm>(DEFAULT_FORM);
  const [rejectDialogTxId, setRejectDialogTxId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const vatCalc = useMemo(() => {
    const amt = parseFloat(form.amount) || 0;
    const rate = parseFloat(form.taxRate) || 0;
    if (rate === 0 || amt === 0) return { net: amt, tax: 0, gross: amt };
    if (form.vatInclusive) {
      const net = amt / (1 + rate / 100);
      return { net, tax: amt - net, gross: amt };
    }
    const tax = amt * rate / 100;
    return { net: amt, tax, gross: amt + tax };
  }, [form.amount, form.taxRate, form.vatInclusive]);

  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const allData = data ?? [];
  const receivables = useMemo(() =>
    allData.filter(t => t.type === 'income' && !['paid', 'cancelled'].includes(t.paymentStatus)),
  [allData]);
  const payables = useMemo(() =>
    allData.filter(t => t.type === 'expense' && !['paid', 'cancelled'].includes(t.paymentStatus)),
  [allData]);

  async function authFetch(url: string, opts: RequestInit = {}) {
    const token = await getToken();
    const resp = await fetch(url, {
      ...opts,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers },
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Hata' }));
      throw new Error(err.error ?? 'İşlem başarısız');
    }
    return resp.json();
  }

  async function handleCreate() {
    if (!form.amount || !form.transactionDate) {
      toast({ title: 'Tutar ve tarih zorunludur', variant: 'destructive' }); return;
    }
    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        amount: parseFloat(form.amount),
        taxRate: form.taxRate !== '0' ? parseFloat(form.taxRate) : undefined,
        taxAmount: form.taxRate !== '0' ? vatCalc.tax : undefined,
        netAmount: form.taxRate !== '0' ? vatCalc.net : undefined,
        dueDate: form.dueDate || undefined,
        paymentMethod: form.paymentMethod || undefined,
        documentNumber: form.documentNumber || undefined,
      };
      delete payload.vatInclusive;
      await authFetch(`${API_BASE}/accounting/transactions`, { method: 'POST', body: JSON.stringify(payload) });
      toast({ title: 'İşlem oluşturuldu' });
      setCreateOpen(false);
      setForm(DEFAULT_FORM);
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'dashboard'] });
    } catch (e: unknown) {
      toast({ title: 'Oluşturma başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setCreating(false); }
  }

  async function doAction(url: string, method = 'POST', body?: object) {
    const token = await getToken();
    const resp = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Hata' }));
      throw new Error(err.error ?? 'İşlem başarısız');
    }
    return resp.json();
  }

  async function handleApprove(id: number) {
    setActionLoading(id);
    try {
      await doAction(`${API_BASE}/accounting/transactions/${id}/approve`);
      toast({ title: 'İşlem onaylandı' });
      qc.invalidateQueries({ queryKey: ['accounting'] });
    } catch (e: unknown) {
      toast({ title: 'Onay başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  async function handleReject() {
    if (!rejectDialogTxId || !rejectReason) return;
    setActionLoading(rejectDialogTxId);
    try {
      await doAction(`${API_BASE}/accounting/transactions/${rejectDialogTxId}/reject`, 'POST', { reason: rejectReason });
      toast({ title: 'İşlem reddedildi' });
      setRejectDialogTxId(null); setRejectReason('');
      qc.invalidateQueries({ queryKey: ['accounting'] });
    } catch (e: unknown) {
      toast({ title: 'Red başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  async function handleMarkMissing(id: number) {
    setActionLoading(id);
    try {
      await doAction(`${API_BASE}/accounting/transactions/${id}/mark-missing`);
      toast({ title: 'Eksik bilgi olarak işaretlendi' });
      qc.invalidateQueries({ queryKey: ['accounting'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  async function handleMarkPaid(id: number) {
    setActionLoading(id);
    try {
      await doAction(`${API_BASE}/accounting/transactions/${id}/mark-paid`);
      toast({ title: 'Ödendi olarak işaretlendi' });
      qc.invalidateQueries({ queryKey: ['accounting'] });
    } catch (e: unknown) {
      toast({ title: 'İşlem başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  async function handleCancel(id: number) {
    setActionLoading(id);
    try {
      await doAction(`${API_BASE}/accounting/transactions/${id}/cancel`);
      toast({ title: 'İşlem iptal edildi' });
      qc.invalidateQueries({ queryKey: ['accounting'] });
    } catch (e: unknown) {
      toast({ title: 'İptal başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  const today = new Date().toISOString().split('T')[0];

  function TransactionRows({ rows }: { rows: Transaction[] }) {
    if (isLoading) return (
      <>{Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
      ))}</>
    );
    if (rows.length === 0) return (
      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">İşlem kaydı bulunamadı</td></tr>
    );
    return (
      <>{rows.map(tx => {
        const isOverdue = tx.dueDate && tx.dueDate < today && !['paid', 'cancelled'].includes(tx.paymentStatus);
        return (
          <tr key={tx.id} className={`hover:bg-muted/30 transition-colors ${isOverdue ? 'bg-red-50/30' : ''}`}>
            <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
              {tx.transactionDate}
              {tx.dueDate && (
                <div className={`text-[10px] mt-0.5 ${isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                  {isOverdue ? '⚠ Vadesi geçti' : `Vade: ${tx.dueDate}`}
                </div>
              )}
            </td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-1.5">
                {tx.type === 'income'
                  ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  : <TrendingDown className="h-3.5 w-3.5 text-red-600 shrink-0" />}
                <span className="text-xs">{ALL_CATEGORY_LABELS[tx.category] ?? tx.category}</span>
              </div>
              {tx.taxRate && tx.taxRate > 0 && (
                <div className="text-[10px] text-muted-foreground mt-0.5 ml-5">KDV %{tx.taxRate}</div>
              )}
            </td>
            <td className="px-4 py-3 text-xs text-muted-foreground max-w-[180px] truncate">
              {tx.description ?? tx.customerName ?? tx.supplierName ?? '—'}
            </td>
            <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
              <span className={tx.type === 'income' ? 'text-emerald-700' : 'text-red-700'}>
                {formatCurrency(tx.amount, tx.currency)}
              </span>
              {tx.amountTry && tx.currency !== 'TRY' && (
                <div className="text-[10px] text-muted-foreground">{formatCurrency(tx.amountTry)}</div>
              )}
            </td>
            <td className="px-4 py-3">
              <Badge variant="outline" className={`text-[10px] ${PAYMENT_STATUS_COLORS[tx.paymentStatus] ?? ''}`}>
                {PAYMENT_STATUS_LABELS[tx.paymentStatus] ?? tx.paymentStatus}
              </Badge>
            </td>
            <td className="px-4 py-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${ACCT_STATUS_COLORS[tx.accountingStatus] ?? 'bg-gray-100 text-gray-700'}`}>
                {ACCT_STATUS_LABELS[tx.accountingStatus] ?? tx.accountingStatus}
              </span>
            </td>
            <td className="px-4 py-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" disabled={actionLoading === tx.id} aria-label="İşlemler">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  {tx.accountingStatus === 'pending_review' && (
                    <>
                      <DropdownMenuItem onClick={() => handleApprove(tx.id)} className="text-emerald-700 focus:text-emerald-700 focus:bg-emerald-50">
                        <CheckCircle className="h-3.5 w-3.5 mr-2" />Onayla
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => { setRejectDialogTxId(tx.id); setRejectReason(''); }}>
                        <XCircle className="h-3.5 w-3.5 mr-2 text-red-500" />Reddet
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleMarkMissing(tx.id)}>
                        <AlertCircle className="h-3.5 w-3.5 mr-2 text-orange-500" />Eksik Bilgi
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {!['paid', 'cancelled'].includes(tx.paymentStatus) && (
                    <DropdownMenuItem onClick={() => handleMarkPaid(tx.id)}>
                      <CreditCard className="h-3.5 w-3.5 mr-2 text-blue-500" />Ödendi İşaretle
                    </DropdownMenuItem>
                  )}
                  {tx.accountingStatus !== 'approved' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleCancel(tx.id)} className="text-red-600 focus:text-red-600 focus:bg-red-50">
                        <Ban className="h-3.5 w-3.5 mr-2" />İptal Et
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </td>
          </tr>
        );
      })}</>
    );
  }

  function TxTable({ rows }: { rows: Transaction[] }) {
    return (
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#1e3a5f]/5 border-b">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Tarih</th>
                <th className="px-4 py-3 font-medium">Tür / Kategori</th>
                <th className="px-4 py-3 font-medium">Açıklama</th>
                <th className="px-4 py-3 font-medium text-right">Tutar</th>
                <th className="px-4 py-3 font-medium">Ödeme</th>
                <th className="px-4 py-3 font-medium">Muhasebe</th>
                <th className="px-4 py-3 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y"><TransactionRows rows={rows} /></tbody>
          </table>
        </div>
      </Card>
    );
  }

  const receivableTotal = receivables.reduce((s, t) => s + (t.amountTry ?? (t.currency === 'TRY' ? t.amount : 0)), 0);
  const payableTotal = payables.reduce((s, t) => s + (t.amountTry ?? (t.currency === 'TRY' ? t.amount : 0)), 0);

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Gelir &amp; Gider İşlemleri</h1>
          <Button size="sm" className="bg-[#0d7377] hover:bg-[#0a5e62] text-white font-medium" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />Yeni İşlem
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-end">
          <Select value={filters.type || '__all__'} onValueChange={v => setFilters(f => ({ ...f, type: v === '__all__' ? '' : v }))}>
            <SelectTrigger className="w-36 h-8 text-sm"><SelectValue placeholder="Tür" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tüm Türler</SelectItem>
              <SelectItem value="income">Gelir</SelectItem>
              <SelectItem value="expense">Gider</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.accountingStatus || '__all__'} onValueChange={v => setFilters(f => ({ ...f, accountingStatus: v === '__all__' ? '' : v }))}>
            <SelectTrigger className="w-48 h-8 text-sm"><SelectValue placeholder="Muhasebe Durumu" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tüm Durumlar</SelectItem>
              <SelectItem value="pending_review">İnceleme Bekliyor</SelectItem>
              <SelectItem value="approved">Onaylandı</SelectItem>
              <SelectItem value="rejected">Reddedildi</SelectItem>
              <SelectItem value="missing_information">Eksik Bilgi</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.paymentStatus || '__all__'} onValueChange={v => setFilters(f => ({ ...f, paymentStatus: v === '__all__' ? '' : v }))}>
            <SelectTrigger className="w-40 h-8 text-sm"><SelectValue placeholder="Ödeme Durumu" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tümü</SelectItem>
              <SelectItem value="pending">Bekliyor</SelectItem>
              <SelectItem value="paid">Ödendi</SelectItem>
              <SelectItem value="partially_paid">Kısmi Ödendi</SelectItem>
              <SelectItem value="cancelled">İptal</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" className="w-40 h-8 text-sm" value={filters.dateFrom}
            onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} />
          <Input type="date" className="w-40 h-8 text-sm" value={filters.dateTo}
            onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} />
          <Button variant="outline" size="sm" onClick={() => setFilters({ type: '', accountingStatus: '', paymentStatus: '', dateFrom: '', dateTo: '' })}>Temizle</Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label="Verileri yenile" title="Verileri yenile">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Veriler yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">Yeniden Dene</Button>
          </div>
        )}

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">
              Tüm İşlemler {!isLoading && allData.length > 0 && <span className="ml-1.5 text-[10px] bg-muted rounded px-1.5 py-0.5">{allData.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="receivables">
              Alacaklar {!isLoading && receivables.length > 0 && <Badge className="ml-1.5 text-[10px] h-4 bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{receivables.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="payables">
              Borçlar {!isLoading && payables.length > 0 && <Badge className="ml-1.5 text-[10px] h-4 bg-red-100 text-red-700 hover:bg-red-100">{payables.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4"><TxTable rows={allData} /></TabsContent>

          <TabsContent value="receivables" className="mt-4">
            {!isLoading && receivables.length > 0 && (
              <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <p className="text-sm font-medium text-emerald-700">Tahsilat Bekleyen Toplam: {formatCurrency(receivableTotal)}</p>
              </div>
            )}
            <TxTable rows={receivables} />
          </TabsContent>

          <TabsContent value="payables" className="mt-4">
            {!isLoading && payables.length > 0 && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-700">Ödeme Bekleyen Toplam: {formatCurrency(payableTotal)}</p>
              </div>
            )}
            <TxTable rows={payables} />
          </TabsContent>
        </Tabs>

        {/* Create dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Yeni Finansal İşlem</DialogTitle>
              <DialogDescription>Yeni bir gelir veya gider işlemi oluşturun.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div>
                <Label className="text-xs">Tür *</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v, category: v === 'income' ? 'customer_payment' : 'other' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Gelir</SelectItem>
                    <SelectItem value="expense">Gider</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Kategori *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Tutar *</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Para Birimi</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['TRY', 'USD', 'EUR', 'GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">KDV Oranı</Label>
                <Select value={form.taxRate} onValueChange={v => setForm(f => ({ ...f, taxRate: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VAT_RATES.map(r => <SelectItem key={r} value={r}>%{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <Checkbox id="vatInclusive" checked={form.vatInclusive}
                    onCheckedChange={v => setForm(f => ({ ...f, vatInclusive: !!v }))} />
                  <Label htmlFor="vatInclusive" className="text-xs cursor-pointer">Tutar KDV dahil</Label>
                </div>
              </div>
              {form.taxRate !== '0' && parseFloat(form.amount) > 0 && (
                <div className="col-span-2 text-xs text-muted-foreground bg-muted/40 rounded p-2.5 flex gap-4">
                  <span>Net: <strong>{formatCurrency(vatCalc.net, form.currency)}</strong></span>
                  <span>KDV: <strong>{formatCurrency(vatCalc.tax, form.currency)}</strong></span>
                  <span>Brüt: <strong>{formatCurrency(vatCalc.gross, form.currency)}</strong></span>
                </div>
              )}
              <div>
                <Label className="text-xs">İşlem Tarihi *</Label>
                <Input type="date" value={form.transactionDate}
                  onChange={e => setForm(f => ({ ...f, transactionDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Vade Tarihi</Label>
                <Input type="date" value={form.dueDate}
                  onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Ödeme Durumu</Label>
                <Select value={form.paymentStatus} onValueChange={v => setForm(f => ({ ...f, paymentStatus: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Bekliyor</SelectItem>
                    <SelectItem value="paid">Ödendi</SelectItem>
                    <SelectItem value="partially_paid">Kısmi Ödendi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Ödeme Yöntemi</Label>
                <Select value={form.paymentMethod || '__none__'} onValueChange={v => setForm(f => ({ ...f, paymentMethod: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Seçiniz…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Belge No</Label>
                <Input placeholder="Fatura/fiş no" value={form.documentNumber}
                  onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Açıklama</Label>
                <Textarea rows={2} placeholder="İşlem açıklaması…" value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>İptal</Button>
              <Button className="bg-[#0d7377] hover:bg-[#0a5e62] text-white" onClick={handleCreate} disabled={creating}>
                {creating ? 'Oluşturuluyor…' : 'Kaydet'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject dialog */}
        <Dialog open={rejectDialogTxId !== null} onOpenChange={open => { if (!open) setRejectDialogTxId(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>İşlemi Reddet</DialogTitle>
              <DialogDescription>
                Bu işlem reddedilecek ve muhasebe durumu "Reddedildi" olarak güncellenecektir. Onaylı işlemler reddedilemez.
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <Label className="text-xs">Red Gerekçesi *</Label>
              <Textarea rows={3} placeholder="Neden reddediyorsunuz?" value={rejectReason}
                onChange={e => setRejectReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectDialogTxId(null)}>İptal</Button>
              <Button variant="destructive" onClick={handleReject} disabled={!rejectReason || actionLoading !== null}>
                {actionLoading !== null ? 'Kaydediliyor…' : 'Reddet'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

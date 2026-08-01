import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import { Plus, CheckCircle, XCircle, Ban, AlertTriangle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useAuth } from '@clerk/react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

interface Transaction {
  id: number; type: string; category: string; amount: number; currency: string;
  amountTry?: number; paymentStatus: string; accountingStatus: string;
  transactionDate: string; dueDate?: string; description?: string;
  documentNumber?: string; operationId?: number; receiptId?: number;
  customerName?: string; supplierName?: string; tourName?: string;
  createdAt: string;
}

const INCOME_CATEGORIES = [
  { value: 'customer_payment', label: 'Müşteri Ödemesi' },
  { value: 'quotation_payment', label: 'Teklif Ödemesi' },
  { value: 'operation_income', label: 'Operasyon Geliri' },
  { value: 'other', label: 'Diğer' },
];
const EXPENSE_CATEGORIES = [
  { value: 'transportation', label: 'Ulaşım' }, { value: 'guide', label: 'Rehber' },
  { value: 'hotel', label: 'Otel' }, { value: 'restaurant', label: 'Restoran' },
  { value: 'activity', label: 'Aktivite' }, { value: 'entrance_ticket', label: 'Giriş Bileti' },
  { value: 'fuel', label: 'Yakıt' }, { value: 'parking', label: 'Park' },
  { value: 'commission', label: 'Komisyon' }, { value: 'office', label: 'Ofis' },
  { value: 'tax', label: 'Vergi' }, { value: 'other', label: 'Diğer' },
];

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor', paid: 'Ödendi', partially_paid: 'Kısmi Ödendi', cancelled: 'İptal',
};
const ACCT_STATUS_LABELS: Record<string, string> = {
  pending_review: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', missing_information: 'Eksik Bilgi',
};
const ACCT_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800', missing_information: 'bg-orange-100 text-orange-800',
};

export default function AccountingTransactionsPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const qc = useQueryClient();

  // Filters
  const [filters, setFilters] = useState({ type: '', accountingStatus: '', paymentStatus: '', dateFrom: '', dateTo: '' });
  const queryParams = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) queryParams.set(k, v); });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'transactions', filters],
    queryFn: () => customFetch<Transaction[]>(`${API_BASE}/accounting/transactions?${queryParams}`),
  });

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ type: 'expense', category: 'other', amount: '', currency: 'TRY', transactionDate: '', description: '', paymentStatus: 'pending', documentNumber: '' });

  // Reject dialog
  const [rejectDialogTxId, setRejectDialogTxId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState<number | null>(null);

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
      await authFetch(`${API_BASE}/accounting/transactions`, {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: parseFloat(form.amount) }),
      });
      toast({ title: 'İşlem oluşturuldu' });
      setCreateOpen(false);
      setForm({ type: 'expense', category: 'other', amount: '', currency: 'TRY', transactionDate: '', description: '', paymentStatus: 'pending', documentNumber: '' });
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
      qc.invalidateQueries({ queryKey: ['accounting', 'dashboard'] });
    } catch (e: unknown) {
      toast({ title: 'Oluşturma başarısız', description: (e instanceof Error ? e.message : 'Bilinmeyen hata'), variant: 'destructive' });
    } finally { setCreating(false); }
  }

  async function handleApprove(id: number) {
    setActionLoading(id);
    try {
      await authFetch(`${API_BASE}/accounting/transactions/${id}/approve`, { method: 'POST' });
      toast({ title: 'Onaylandı' });
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
    } catch (e: unknown) {
      toast({ title: 'Onay başarısız', description: (e instanceof Error ? e.message : ''), variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  async function handleReject() {
    if (!rejectDialogTxId || !rejectReason) return;
    setActionLoading(rejectDialogTxId);
    try {
      await authFetch(`${API_BASE}/accounting/transactions/${rejectDialogTxId}/reject`, {
        method: 'POST', body: JSON.stringify({ reason: rejectReason }),
      });
      toast({ title: 'Reddedildi' });
      setRejectDialogTxId(null); setRejectReason('');
      qc.invalidateQueries({ queryKey: ['accounting', 'transactions'] });
    } catch (e: unknown) {
      toast({ title: 'Red başarısız', description: (e instanceof Error ? e.message : ''), variant: 'destructive' });
    } finally { setActionLoading(null); }
  }

  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Gelir &amp; Gider İşlemleri</h1>
          <Button size="sm" className="bg-[#0d7377] hover:bg-[#0d7377]/90" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />Yeni İşlem
          </Button>
        </div>

        {/* Filter bar */}
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
            <SelectTrigger className="w-44 h-8 text-sm"><SelectValue placeholder="Muhasebe Durumu" /></SelectTrigger>
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
              <SelectItem value="__all__">Tüm</SelectItem>
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
          <Button variant="outline" size="sm" onClick={() => setFilters({ type: '', accountingStatus: '', paymentStatus: '', dateFrom: '', dateTo: '' })}>
            Temizle
          </Button>
          <Button variant="ghost" size="sm" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Veriler yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">Yeniden Dene</Button>
          </div>
        )}

        {/* Table */}
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
                  <th className="px-4 py-3 font-medium">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}><td colSpan={7} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td></tr>
                )) : !data || data.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">İşlem kaydı bulunamadı</td></tr>
                ) : data.map(tx => (
                  <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {tx.transactionDate}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {tx.type === 'income'
                          ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                          : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                        <span className="text-xs">{tx.category}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                      {tx.description ?? (tx.customerName ?? tx.supplierName ?? '—')}
                    </td>
                    <td className="px-4 py-3 text-right font-medium whitespace-nowrap">
                      {formatCurrency(tx.amount, tx.currency)}
                      {tx.amountTry && tx.currency !== 'TRY' && (
                        <div className="text-[10px] text-muted-foreground">{formatCurrency(tx.amountTry)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px]">
                        {PAYMENT_STATUS_LABELS[tx.paymentStatus] ?? tx.paymentStatus}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${ACCT_STATUS_COLORS[tx.accountingStatus] ?? 'bg-gray-100 text-gray-700'}`}>
                        {ACCT_STATUS_LABELS[tx.accountingStatus] ?? tx.accountingStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {tx.accountingStatus === 'pending_review' && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-600 hover:text-emerald-700"
                            disabled={actionLoading === tx.id} onClick={() => handleApprove(tx.id)}>
                            <CheckCircle className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:text-red-700"
                            disabled={actionLoading === tx.id} onClick={() => { setRejectDialogTxId(tx.id); setRejectReason(''); }}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Create dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Yeni Finansal İşlem</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="col-span-2 grid grid-cols-2 gap-3">
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
                <Label className="text-xs">İşlem Tarihi *</Label>
                <Input type="date" value={form.transactionDate}
                  onChange={e => setForm(f => ({ ...f, transactionDate: e.target.value }))} />
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
                <Label className="text-xs">Belge No</Label>
                <Input placeholder="Fatura/fiş no" value={form.documentNumber}
                  onChange={e => setForm(f => ({ ...f, documentNumber: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Açıklama</Label>
                <Textarea rows={2} placeholder="İşlem açıklaması..." value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>İptal</Button>
              <Button className="bg-[#0d7377] hover:bg-[#0d7377]/90" onClick={handleCreate} disabled={creating}>
                {creating ? 'Oluşturuluyor…' : 'Kaydet'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject dialog */}
        <Dialog open={rejectDialogTxId !== null} onOpenChange={open => { if (!open) setRejectDialogTxId(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>İşlemi Reddet</DialogTitle></DialogHeader>
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

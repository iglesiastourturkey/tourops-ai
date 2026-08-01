import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/labels';
import {
  Download, FileSpreadsheet, Archive, FileText as FilePdf,
  TrendingUp, TrendingDown, Camera, CameraOff, AlertTriangle,
  User, MapPin, Calendar, ArrowLeft, RefreshCw, CheckCircle, XCircle
} from 'lucide-react';
import { useAuth } from '@clerk/react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

interface OperationFile {
  operation: {
    id: number; startDate?: string; endDate?: string; status: string;
    guideName?: string; driverName?: string; notes?: string;
    tourName?: string; customerName?: string; quotationId?: number;
  };
  transactions: Array<{
    id: number; type: string; category: string; amount: number; currency: string;
    amountTry?: number; paymentStatus: string; accountingStatus: string;
    transactionDate: string; description?: string; supplierName?: string;
    documentNumber?: string;
  }>;
  receipts: Array<{
    id: number; amount: number; currency: string; supplierName?: string;
    receiptDate?: string; guideNote?: string; photoObjectPath?: string;
    reviewStatus: string;
  }>;
  documents: Array<{
    id: number; documentType: string; originalFileName: string; reviewStatus: string;
  }>;
  currencyTotals: Record<string, { income: number; expenses: number; net: number }>;
  missingWarnings: string[];
}

const ACCT_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800', missing_information: 'bg-orange-100 text-orange-800',
};
const REVIEW_LABELS: Record<string, string> = {
  pending_review: 'Bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', missing_information: 'Eksik',
};

export default function AccountingOperationPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { getToken } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'operation', id],
    queryFn: () => customFetch<OperationFile>(`${API_BASE}/accounting/operations/${id}`),
    enabled: !!id,
  });

  async function downloadExport(format: 'pdf' | 'excel' | 'zip') {
    setDownloading(format);
    try {
      const token = await getToken();
      const resp = await fetch(`${API_BASE}/accounting/export/${format}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { operationId: parseInt(id!) } }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'excel' ? 'xlsx' : format === 'zip' ? 'zip' : 'pdf';
      a.download = `op-${id}-muhasebe.${ext}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: `${format.toUpperCase()} indirildi` });
    } catch {
      toast({ title: 'İndirme başarısız', variant: 'destructive' });
    } finally { setDownloading(null); }
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </AppShell>
    );
  }

  if (isError || !data) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-medium">Operasyon muhasebe dosyası yüklenemedi.</p>
            <Button variant="outline" className="mt-4" onClick={() => refetch()}>Yeniden Dene</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const { operation, transactions, receipts, documents, currencyTotals, missingWarnings } = data;
  const income = transactions.filter(t => t.type === 'income');
  const expenses = transactions.filter(t => t.type === 'expense');

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/accounting">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />Muhasebe
                </Button>
              </Link>
              <span className="text-muted-foreground text-sm">/</span>
            </div>
            <h1 className="text-2xl font-bold text-[#1e3a5f]">
              Operasyon #{operation.id} Muhasebe Dosyası
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {operation.tourName ?? '—'} · {operation.customerName ?? '—'}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" disabled={!!downloading} onClick={() => downloadExport('pdf')}>
              {downloading === 'pdf' ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FilePdf className="h-3.5 w-3.5 mr-1" />}
              PDF
            </Button>
            <Button size="sm" variant="outline" disabled={!!downloading} onClick={() => downloadExport('excel')}>
              {downloading === 'excel' ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />}
              Excel
            </Button>
            <Button size="sm" className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/90" disabled={!!downloading} onClick={() => downloadExport('zip')}>
              {downloading === 'zip' ? <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Archive className="h-3.5 w-3.5 mr-1" />}
              ZIP
            </Button>
          </div>
        </div>

        {/* Missing warnings */}
        {missingWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Eksik / Bekleyen İşlemler</p>
                <ul className="mt-1 space-y-0.5">
                  {missingWarnings.map((w, i) => <li key={i} className="text-xs text-amber-700">• {w}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Operation details */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Tarihler</p>
                  <p className="font-medium text-xs">{operation.startDate ?? '—'} – {operation.endDate ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Rehber</p>
                  <p className="font-medium text-xs">{operation.guideName ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground">Şoför</p>
                  <p className="font-medium text-xs">{operation.driverName ?? '—'}</p>
                </div>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Durum</p>
                <Badge variant="outline" className="text-xs mt-0.5">{operation.status}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Currency totals */}
        {Object.entries(currencyTotals).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(currencyTotals).map(([cur, totals]) => (
              <Card key={cur} className="border-[#0d7377]/20">
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-xs font-bold text-[#0d7377] mb-2">{cur} Özeti</p>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Gelir</span><span className="text-emerald-600 font-medium">{formatCurrency(totals.income, cur)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Gider</span><span className="text-red-600 font-medium">{formatCurrency(totals.expenses, cur)}</span></div>
                    <div className="flex justify-between border-t pt-1"><span className="font-medium">Net</span><span className={`font-bold ${totals.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(totals.net, cur)}</span></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Income table */}
        {income.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-[#1e3a5f] flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />Gelir Kayıtları ({income.length})
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-emerald-50/60 border-y">
                  <tr className="text-left text-[10px] text-muted-foreground">
                    <th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Kategori</th>
                    <th className="px-4 py-2">Açıklama</th><th className="px-4 py-2 text-right">Tutar</th>
                    <th className="px-4 py-2">Muhasebe</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {income.map(tx => (
                    <tr key={tx.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 text-muted-foreground">{tx.transactionDate}</td>
                      <td className="px-4 py-2">{tx.category}</td>
                      <td className="px-4 py-2 max-w-[200px] truncate">{tx.description ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(tx.amount, tx.currency)}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] ${ACCT_STATUS_COLORS[tx.accountingStatus] ?? 'bg-gray-100'}`}>
                          {tx.accountingStatus === 'approved' ? <CheckCircle className="h-3 w-3 mr-0.5" /> : tx.accountingStatus === 'rejected' ? <XCircle className="h-3 w-3 mr-0.5" /> : null}
                          {tx.accountingStatus === 'approved' ? 'Onaylı' : tx.accountingStatus === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Expense table */}
        {expenses.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-[#1e3a5f] flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-red-500" />Gider Kayıtları ({expenses.length})
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-red-50/60 border-y">
                  <tr className="text-left text-[10px] text-muted-foreground">
                    <th className="px-4 py-2">Tarih</th><th className="px-4 py-2">Kategori</th>
                    <th className="px-4 py-2">Tedarikçi / Açıklama</th><th className="px-4 py-2 text-right">Tutar</th>
                    <th className="px-4 py-2">Muhasebe</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenses.map(tx => (
                    <tr key={tx.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 text-muted-foreground">{tx.transactionDate}</td>
                      <td className="px-4 py-2">{tx.category}</td>
                      <td className="px-4 py-2 max-w-[200px] truncate">{tx.supplierName ?? tx.description ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(tx.amount, tx.currency)}</td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] ${ACCT_STATUS_COLORS[tx.accountingStatus] ?? 'bg-gray-100'}`}>
                          {tx.accountingStatus === 'approved' ? 'Onaylı' : tx.accountingStatus === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Receipts */}
        {receipts.length > 0 && (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-[#1e3a5f]">Makbuzlar ({receipts.length})</CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {receipts.map(r => (
                  <div key={r.id} className="border rounded-lg p-3 text-xs">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium">{r.supplierName ?? `Makbuz #${r.id}`}</span>
                      {r.photoObjectPath ? <Camera className="h-3.5 w-3.5 text-emerald-500" /> : <CameraOff className="h-3.5 w-3.5 text-red-400" />}
                    </div>
                    <div className="text-muted-foreground">{r.receiptDate ?? '—'}</div>
                    <div className="font-semibold text-[#1e3a5f] mt-0.5">{formatCurrency(r.amount, r.currency)}</div>
                    {r.guideNote && <div className="mt-1 text-muted-foreground italic truncate">{r.guideNote}</div>}
                    <div className="mt-1.5">
                      <Badge variant="outline" className="text-[10px]">{REVIEW_LABELS[r.reviewStatus] ?? r.reviewStatus}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {income.length === 0 && expenses.length === 0 && receipts.length === 0 && (
          <Card>
            <CardContent className="text-center py-12 text-muted-foreground text-sm">
              Bu operasyon için henüz finansal kayıt bulunmuyor.
              <div className="mt-3">
                <Link href="/accounting/transactions">
                  <Button size="sm" variant="outline">İşlem Ekle</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

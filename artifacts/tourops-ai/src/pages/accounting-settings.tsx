import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Settings, RefreshCw, AlertTriangle, Save } from 'lucide-react';
import { useAuth } from '@clerk/react';

import { API_BASE } from '@/lib/api-base';

interface AccountingSettings {
  id: number | null;
  defaultCurrency: string;
  fiscalYearStartMonth: number;
  defaultVatRate: number;
  vatRates: string;
  paymentMethods: string;
  documentNumberPrefix: string;
  accountantNotes: string | null;
}

const DEFAULT_SETTINGS: AccountingSettings = {
  id: null,
  defaultCurrency: 'TRY',
  fiscalYearStartMonth: 1,
  defaultVatRate: 20,
  vatRates: '["0","1","8","10","20"]',
  paymentMethods: '["Nakit","Kredi Kartı","Havale/EFT","Çek","Döviz"]',
  documentNumberPrefix: 'TRP',
  accountantNotes: null,
};

const MONTHS = [
  { value: 1, label: 'Ocak' }, { value: 2, label: 'Şubat' }, { value: 3, label: 'Mart' },
  { value: 4, label: 'Nisan' }, { value: 5, label: 'Mayıs' }, { value: 6, label: 'Haziran' },
  { value: 7, label: 'Temmuz' }, { value: 8, label: 'Ağustos' }, { value: 9, label: 'Eylül' },
  { value: 10, label: 'Ekim' }, { value: 11, label: 'Kasım' }, { value: 12, label: 'Aralık' },
];

function parseJsonList(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export default function AccountingSettingsPage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['accounting', 'settings'],
    queryFn: () => customFetch<AccountingSettings>(`${API_BASE}/accounting/settings`),
  });

  const [form, setForm] = useState<AccountingSettings>(DEFAULT_SETTINGS);
  const [vatRatesInput, setVatRatesInput] = useState('0,1,8,10,20');
  const [paymentMethodsInput, setPaymentMethodsInput] = useState('Nakit,Kredi Kartı,Havale/EFT,Çek,Döviz');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setForm(data);
      setVatRatesInput(parseJsonList(data.vatRates).join(','));
      setPaymentMethodsInput(parseJsonList(data.paymentMethods).join(','));
    }
  }, [data]);

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getToken();
      const vatRatesArr = vatRatesInput.split(',').map(s => s.trim()).filter(Boolean);
      const paymentMethodsArr = paymentMethodsInput.split(',').map(s => s.trim()).filter(Boolean);

      const payload = {
        ...form,
        vatRates: JSON.stringify(vatRatesArr),
        paymentMethods: JSON.stringify(paymentMethodsArr),
      };
      // remove id from payload if it's null
      if (payload.id === null) delete (payload as Partial<typeof payload>).id;

      const resp = await fetch(`${API_BASE}/accounting/settings`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Hata' }));
        throw new Error(err.error ?? 'Kayıt başarısız');
      }
      toast({ title: 'Muhasebe ayarları kaydedildi' });
      qc.invalidateQueries({ queryKey: ['accounting', 'settings'] });
    } catch (e: unknown) {
      toast({ title: 'Kayıt başarısız', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#1e3a5f] flex items-center gap-2">
              <Settings className="h-5 w-5" />Muhasebe Ayarları
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">Vergi oranları, ödeme yöntemleri ve genel muhasebe konfigürasyonu</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Yenile
          </Button>
        </div>

        {/* Disclaimer */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          ⚠ Bu ekran operasyonel finans takibi içindir; resmi muhasebe ve vergi beyannamesi yerine geçmez. KDV oranları bilgilendirme amaçlıdır.
        </div>

        {isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">Ayarlar yüklenemedi.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-auto">Yeniden Dene</Button>
          </div>
        )}

        {isLoading ? (
          <Card><CardContent className="pt-5 pb-4"><Skeleton className="h-64 w-full" /></CardContent></Card>
        ) : (
          <>
            {/* General settings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#1e3a5f]">Genel Ayarlar</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs mb-1.5 block">Varsayılan Para Birimi</Label>
                  <Select value={form.defaultCurrency} onValueChange={v => setForm(f => ({ ...f, defaultCurrency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['TRY', 'USD', 'EUR', 'GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Mali Yıl Başlangıç Ayı</Label>
                  <Select
                    value={String(form.fiscalYearStartMonth)}
                    onValueChange={v => setForm(f => ({ ...f, fiscalYearStartMonth: parseInt(v) }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map(m => <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Belge No Ön Eki</Label>
                  <Input
                    placeholder="Örn: TRP"
                    value={form.documentNumberPrefix}
                    onChange={e => setForm(f => ({ ...f, documentNumberPrefix: e.target.value }))}
                    maxLength={10}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Örnek: {form.documentNumberPrefix || 'TRP'}-2024-0001</p>
                </div>
              </CardContent>
            </Card>

            {/* VAT settings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#1e3a5f]">KDV Ayarları</CardTitle>
                <CardDescription className="text-xs">Operasyonel takip için KDV oranlarını yapılandırın</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs mb-1.5 block">Varsayılan KDV Oranı (%)</Label>
                  <Select
                    value={String(form.defaultVatRate)}
                    onValueChange={v => setForm(f => ({ ...f, defaultVatRate: parseFloat(v) }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {parseJsonList(
                        vatRatesInput.split(',').map(s => s.trim()).filter(Boolean).length > 0
                          ? JSON.stringify(vatRatesInput.split(',').map(s => s.trim()).filter(Boolean))
                          : form.vatRates
                      ).map(r => <SelectItem key={r} value={r}>%{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">Aktif KDV Oranları (virgülle ayırın)</Label>
                  <Input
                    placeholder="0,1,8,10,20"
                    value={vatRatesInput}
                    onChange={e => setVatRatesInput(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Örnek: 0,1,8,10,20</p>
                </div>
              </CardContent>
            </Card>

            {/* Payment methods */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#1e3a5f]">Ödeme Yöntemleri</CardTitle>
              </CardHeader>
              <CardContent>
                <Label className="text-xs mb-1.5 block">Yöntemler (virgülle ayırın)</Label>
                <Input
                  placeholder="Nakit,Kredi Kartı,Havale/EFT"
                  value={paymentMethodsInput}
                  onChange={e => setPaymentMethodsInput(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Şu an: {parseJsonList(
                    JSON.stringify(paymentMethodsInput.split(',').map(s => s.trim()).filter(Boolean))
                  ).join(', ')}
                </p>
              </CardContent>
            </Card>

            {/* Accountant notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-[#1e3a5f]">Muhasebe Notu</CardTitle>
                <CardDescription className="text-xs">Raporlarda ve dışa aktarmalarda görünecek muhasebe notları</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  rows={4}
                  placeholder="Muhasebeciye özel notlar, hatırlatmalar veya talimatlar…"
                  value={form.accountantNotes ?? ''}
                  onChange={e => setForm(f => ({ ...f, accountantNotes: e.target.value || null }))}
                />
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button
                className="bg-[#0d7377] hover:bg-[#0a5e62] text-white font-medium px-6"
                onClick={handleSave}
                disabled={saving}>
                <Save className="h-4 w-4 mr-1.5" />
                {saving ? 'Kaydediliyor…' : 'Ayarları Kaydet'}
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

import { useState } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAnalyzeCustomerRequest, useCreateCustomer } from '@workspace/api-client-react';
import { getListCustomersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, RotateCcw, UserPlus } from 'lucide-react';
import { CUSTOMER_TYPE_LABELS } from '@/lib/labels';

type Analysis = {
  customerName: string | null; startDate: string | null; endDate: string | null;
  adultCount: number | null; childCount: number | null; destination: string | null;
  duration: number | null; budget: string | null; hotelCategory: string | null;
  transferRequired: boolean | null; guideLanguage: string | null; activities: string | null;
  mealPreferences: string | null; specialRequests: string | null; customerType: string | null;
  missingFields: string[];
};

const FIELD_LABELS: Record<string, string> = {
  customerName: 'Ad Soyad', startDate: 'Başlangıç Tarihi', endDate: 'Bitiş Tarihi',
  adultCount: 'Yetişkin Sayısı', childCount: 'Çocuk Sayısı', destination: 'Destinasyon',
  duration: 'Süre (gün)', budget: 'Bütçe', hotelCategory: 'Otel Kategorisi',
  guideLanguage: 'Rehber Dili', activities: 'Aktiviteler', mealPreferences: 'Yemek Tercihleri',
  specialRequests: 'Özel İstekler', customerType: 'Müşteri Tipi',
};

export default function NewRequestPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const analyzeMutation = useAnalyzeCustomerRequest();
  const createMutation = useCreateCustomer();

  const [message, setMessage] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  function handleAnalyze() {
    if (!message.trim()) { toast({ title: 'Lütfen müşteri mesajını girin', variant: 'destructive' }); return; }
    analyzeMutation.mutate({ data: { message } }, {
      onSuccess: (data) => {
        setAnalysis(data as unknown as Analysis);
        const d = data as unknown as Analysis;
        setForm({
          customerName: d.customerName ?? '',
          startDate: d.startDate ?? '',
          endDate: d.endDate ?? '',
          adultCount: d.adultCount?.toString() ?? '',
          childCount: d.childCount?.toString() ?? '',
          destination: d.destination ?? '',
          budget: d.budget ?? '',
          hotelCategory: d.hotelCategory ?? '',
          guideLanguage: d.guideLanguage ?? '',
          activities: d.activities ?? '',
          mealPreferences: d.mealPreferences ?? '',
          specialRequests: d.specialRequests ?? '',
          customerType: d.customerType ?? 'individual',
        });
        toast({ title: 'Analiz tamamlandı', description: `${d.missingFields?.length ?? 0} eksik alan var` });
      },
      onError: () => toast({ title: 'Analiz başarısız', variant: 'destructive' }),
    });
  }

  function handleCreate() {
    if (!form.customerName?.trim()) { toast({ title: 'Ad Soyad zorunludur', variant: 'destructive' }); return; }
    createMutation.mutate({ data: {
      name: form.customerName,
      customerType: form.customerType || 'individual',
      phone: form.phone ?? undefined,
      email: form.email ?? undefined,
      travelPreferences: [form.activities, form.mealPreferences, form.specialRequests].filter(Boolean).join(', ') || undefined,
      notes: `Destinasyon: ${form.destination || '-'}\nBütçe: ${form.budget || '-'}\nRehber dili: ${form.guideLanguage || '-'}`,
    }}, {
      onSuccess: (c) => {
        toast({ title: 'Müşteri oluşturuldu' });
        qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setLocation(`/customers/${c.id}`);
      },
      onError: () => toast({ title: 'Müşteri oluşturulamadı', variant: 'destructive' }),
    });
  }

  const missing = analysis?.missingFields ?? [];
  const isMissing = (f: string) => missing.includes(f);

  const FieldRow = ({ field, label, type = 'text' }: { field: string; label: string; type?: string }) => (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-xs font-medium text-muted-foreground">{label}</label>
        {isMissing(field) && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">Eksik</span>}
      </div>
      <Input type={type} value={form[field] ?? ''} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} data-testid={`input-request-${field}`} />
    </div>
  );

  return (
    <AppShell title="Yeni Müşteri Talebi">
      <div className="max-w-2xl space-y-6">
        {/* Step 1: Input */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />Müşteri Mesajı</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Müşteri mesajını buraya yapıştırın... (WhatsApp, e-posta veya telefon görüşmesi notu)"
              rows={6}
              value={message}
              onChange={e => setMessage(e.target.value)}
              data-testid="textarea-customer-message"
            />
            <div className="flex gap-3">
              <Button onClick={handleAnalyze} disabled={analyzeMutation.isPending} className="gap-2" data-testid="button-analyze-request">
                <Sparkles className="w-4 h-4" />
                {analyzeMutation.isPending ? 'Analiz ediliyor...' : 'AI ile Analiz Et'}
              </Button>
              {analysis && (
                <Button variant="ghost" onClick={() => { setAnalysis(null); setForm({}); }} className="gap-2" data-testid="button-reset-request">
                  <RotateCcw className="w-4 h-4" /> Temizle
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Extracted form */}
        {analysis && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Çıkarılan Bilgiler</CardTitle>
              {missing.length > 0 && (
                <p className="text-xs text-orange-600 mt-1">
                  Eksik bilgiler: {missing.map(f => FIELD_LABELS[f] ?? f).join(', ')}
                </p>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-muted-foreground">Ad Soyad *</label>
                  {isMissing('customerName') && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">Eksik</span>}
                </div>
                <Input value={form.customerName ?? ''} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Ad Soyad" data-testid="input-request-customerName" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs font-medium text-muted-foreground">Müşteri Tipi</label>
                </div>
                <Select value={form.customerType ?? 'individual'} onValueChange={v => setForm(f => ({ ...f, customerType: v }))}>
                  <SelectTrigger data-testid="select-request-customerType"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <FieldRow field="destination" label="Destinasyon" />
              <FieldRow field="startDate" label="Başlangıç Tarihi" type="date" />
              <FieldRow field="endDate" label="Bitiş Tarihi" type="date" />
              <FieldRow field="adultCount" label="Yetişkin Sayısı" type="number" />
              <FieldRow field="childCount" label="Çocuk Sayısı" type="number" />
              <FieldRow field="budget" label="Bütçe" />
              <FieldRow field="hotelCategory" label="Otel Kategorisi" />
              <FieldRow field="guideLanguage" label="Rehber Dili" />
              <div className="md:col-span-2"><FieldRow field="activities" label="Aktiviteler" /></div>
              <div className="md:col-span-2"><FieldRow field="mealPreferences" label="Yemek Tercihleri" /></div>
              <div className="md:col-span-2"><FieldRow field="specialRequests" label="Özel İstekler" /></div>

              <div className="md:col-span-2 flex gap-3 pt-2">
                <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-2" data-testid="button-create-from-request">
                  <UserPlus className="w-4 h-4" />
                  {createMutation.isPending ? 'Kaydediliyor...' : 'Müşteri Oluştur'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

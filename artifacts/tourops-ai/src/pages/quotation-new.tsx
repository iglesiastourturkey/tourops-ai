import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateQuotation, useListCustomers, useListTours } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';

const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];

export default function QuotationNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateQuotation();
  const { data: customers } = useListCustomers();
  const { data: tours } = useListTours();

  const [form, setForm] = useState({
    customerId: '', tourId: '', currency: 'EUR',
    subtotal: '', discount: '0', finalPrice: '',
    expiresAt: '', paymentTerms: '', cancellationPolicy: '',
    includedServices: '', excludedServices: '', notes: '',
  });

  useEffect(() => {
    const sub = parseFloat(form.subtotal) || 0;
    const disc = parseFloat(form.discount) || 0;
    setForm(f => ({ ...f, finalPrice: Math.max(0, sub - disc).toString() }));
  }, [form.subtotal, form.discount]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.customerId) { toast({ title: 'Müşteri seçilmesi zorunludur', variant: 'destructive' }); return; }
    if (!form.finalPrice || parseFloat(form.finalPrice) <= 0) { toast({ title: 'Fiyat girilmesi zorunludur', variant: 'destructive' }); return; }
    createMutation.mutate({ data: {
      customerId: parseInt(form.customerId),
      tourId: form.tourId ? parseInt(form.tourId) : undefined,
      currency: form.currency,
      subtotal: parseFloat(form.subtotal) || 0,
      discount: parseFloat(form.discount) || 0,
      finalPrice: parseFloat(form.finalPrice) || 0,
      expiresAt: form.expiresAt || undefined,
      paymentTerms: form.paymentTerms || undefined,
      cancellationPolicy: form.cancellationPolicy || undefined,
      includedServices: form.includedServices || undefined,
      excludedServices: form.excludedServices || undefined,
      notes: form.notes || undefined,
      status: 'draft',
    } }, {
      onSuccess: (q) => { toast({ title: 'Teklif oluşturuldu' }); setLocation(`/quotations/${q.id}`); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  return (
    <AppShell title="Yeni Teklif">
      <div className="mb-4"><Link href="/quotations"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-quotations"><ArrowLeft className="w-4 h-4" />Teklifler</Button></Link></div>
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">Teklif Bilgileri</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Müşteri *</label>
            <Select value={form.customerId} onValueChange={v => set('customerId', v)}>
              <SelectTrigger data-testid="select-quotation-customer"><SelectValue placeholder="Müşteri seçin..." /></SelectTrigger>
              <SelectContent>{(customers ?? []).map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tur (opsiyonel)</label>
            <Select value={form.tourId} onValueChange={v => set('tourId', v)}>
              <SelectTrigger data-testid="select-quotation-tour"><SelectValue placeholder="Tur seçin..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tur seçilmedi</SelectItem>
                {(tours ?? []).map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Para Birimi</label>
            <Select value={form.currency} onValueChange={v => set('currency', v)}>
              <SelectTrigger data-testid="select-quotation-currency"><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Son Geçerlilik</label>
            <Input type="date" value={form.expiresAt} onChange={e => set('expiresAt', e.target.value)} data-testid="input-quotation-expiresAt" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Ara Toplam</label>
            <Input type="number" value={form.subtotal} onChange={e => set('subtotal', e.target.value)} placeholder="0" data-testid="input-quotation-subtotal" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">İndirim</label>
            <Input type="number" value={form.discount} onChange={e => set('discount', e.target.value)} placeholder="0" data-testid="input-quotation-discount" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Toplam Fiyat</label>
            <Input type="number" value={form.finalPrice} onChange={e => set('finalPrice', e.target.value)} placeholder="0" data-testid="input-quotation-finalPrice" className="font-semibold" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Ödeme Koşulları</label>
            <Textarea value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)} rows={2} placeholder="Ödeme koşulları..." data-testid="textarea-quotation-paymentTerms" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">İptal Politikası</label>
            <Textarea value={form.cancellationPolicy} onChange={e => set('cancellationPolicy', e.target.value)} rows={2} placeholder="İptal politikası..." data-testid="textarea-quotation-cancellationPolicy" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Dahil Hizmetler</label>
            <Textarea value={form.includedServices} onChange={e => set('includedServices', e.target.value)} rows={2} placeholder="Dahil olan hizmetler..." data-testid="textarea-quotation-includedServices" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Hariç Hizmetler</label>
            <Textarea value={form.excludedServices} onChange={e => set('excludedServices', e.target.value)} rows={2} placeholder="Dahil olmayan hizmetler..." data-testid="textarea-quotation-excludedServices" />
          </div>
          <div className="md:col-span-2 flex gap-3 pt-2">
            <Link href="/quotations"><Button variant="outline">Vazgeç</Button></Link>
            <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-quotation">
              {createMutation.isPending ? 'Oluşturuluyor...' : 'Teklif Oluştur'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

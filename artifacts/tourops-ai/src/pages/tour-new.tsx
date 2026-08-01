import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateTour } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft } from 'lucide-react';
import { TOUR_TYPE_LABELS } from '@/lib/labels';

export default function TourNewPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createMutation = useCreateTour();

  const [form, setForm] = useState({
    name: '', code: '', startDate: '', endDate: '', adultCount: 2, childCount: 0,
    nights: 1, currency: 'EUR',
    mainDestination: '', tourType: 'cultural', guideLanguage: '', notes: '', profitMargin: 20,
    transferRequired: false, isCruiseExcursion: false,
    shipName: '', portName: '', shipArrivalTime: '', shipDepartureTime: '',
  });

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  function handleSubmit() {
    if (!form.name.trim()) { toast({ title: 'Tur adı zorunludur', variant: 'destructive' }); return; }
    const data = { ...form, adultCount: Number(form.adultCount), childCount: Number(form.childCount), profitMargin: Number(form.profitMargin) };
    createMutation.mutate({ data }, {
      onSuccess: (tour) => { toast({ title: 'Tur oluşturuldu' }); setLocation(`/tours/${tour.id}`); },
      onError: () => toast({ title: 'Hata', description: 'Tur oluşturulamadı', variant: 'destructive' }),
    });
  }

  const F = ({ label, field, type = 'text', placeholder = '' }: { label: string; field: string; type?: string; placeholder?: string }) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <Input type={type} value={(form as Record<string, unknown>)[field] as string} onChange={e => set(field, type === 'number' ? Number(e.target.value) : e.target.value)} placeholder={placeholder} data-testid={`input-tour-${field}`} />
    </div>
  );

  const Toggle = ({ label, field }: { label: string; field: string }) => (
    <div className="flex items-center gap-3">
      <input type="checkbox" id={field} checked={!!(form as Record<string, unknown>)[field]} onChange={e => set(field, e.target.checked)} className="w-4 h-4 accent-primary" data-testid={`switch-tour-${field}`} />
      <label htmlFor={field} className="text-sm font-medium cursor-pointer">{label}</label>
    </div>
  );

  return (
    <AppShell title="Yeni Tur">
      <div className="mb-4"><Link href="/tours"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-tours"><ArrowLeft className="w-4 h-4" />Turlar</Button></Link></div>
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">Tur Bilgileri</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><F label="Tur Adı *" field="name" placeholder="Efes & Şirince Günübirlik Tur" /></div>
          <F label="Tur Kodu (opsiyonel)" field="code" placeholder="EFE-2026-001" />
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Tur Tipi</label>
            <Select value={form.tourType} onValueChange={v => set('tourType', v)}>
              <SelectTrigger data-testid="select-tour-type"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(TOUR_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <F label="Ana Destinasyon" field="mainDestination" placeholder="Selçuk, Efes" />
          <F label="Rehber Dili" field="guideLanguage" placeholder="İngilizce, Almanca" />
          <F label="Başlangıç Tarihi" field="startDate" type="date" />
          <F label="Bitiş Tarihi" field="endDate" type="date" />
          <F label="Yetişkin Sayısı" field="adultCount" type="number" />
          <F label="Çocuk Sayısı" field="childCount" type="number" />
          <F label="Kar Marjı (%)" field="profitMargin" type="number" />

          <div className="md:col-span-2 flex flex-col gap-3 pt-2">
            <Toggle label="Transfer Gerekli" field="transferRequired" />
            <Toggle label="Kruvaziyer Tur" field="isCruiseExcursion" />
          </div>

          {form.isCruiseExcursion && (
            <>
              <F label="Gemi Adı" field="shipName" placeholder="MSC Virtuosa" />
              <F label="Liman Adı" field="portName" placeholder="Kuşadası Limanı" />
              <F label="Gemi Varış Saati" field="shipArrivalTime" placeholder="08:00" />
              <F label="Gemi Kalkış Saati" field="shipDepartureTime" placeholder="18:00" />
            </>
          )}

          <div className="md:col-span-2"><F label="Notlar" field="notes" placeholder="Ek notlar..." /></div>

          <div className="md:col-span-2 flex gap-3 pt-2">
            <Link href="/tours"><Button variant="outline" data-testid="button-cancel-tour">Vazgeç</Button></Link>
            <Button onClick={handleSubmit} disabled={createMutation.isPending} data-testid="button-submit-tour">
              {createMutation.isPending ? 'Oluşturuluyor...' : 'Tur Oluştur'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

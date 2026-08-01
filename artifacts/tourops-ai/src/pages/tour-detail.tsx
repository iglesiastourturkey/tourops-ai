import { useState, useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  useGetTour, useUpdateTour, useListTourDays, useCreateTourDay, useDeleteTourDay,
  useListTourCosts, useCreateTourCost, useDeleteTourCost, useComputeTourCostSummary,
  useGenerateItinerary, useAiAssist,
} from '@workspace/api-client-react';
import {
  getGetTourQueryKey, getListTourDaysQueryKey, getListTourCostsQueryKey,
  getComputeTourCostSummaryQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, Plus, Trash2, AlertTriangle, Ship, Sparkles, Send } from 'lucide-react';
import { TOUR_TYPE_LABELS, COST_CATEGORY_LABELS, TOUR_STATUS_LABELS, formatCurrency } from '@/lib/labels';
import { useProfile } from '@/contexts/ProfileContext';

const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];

export default function TourDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();

  const { role } = useProfile();
  /** Can create/update/delete tours, days, costs (admin or operations) */
  const canEdit = ['admin', 'operations'].includes(role ?? '');
  /** Can view cost financial data (admin, operations, accounting — not guide) */
  const canSeeCosts = ['admin', 'operations', 'accounting'].includes(role ?? '');

  const { data: tour, isLoading } = useGetTour(id, { query: { enabled: !!id, queryKey: getGetTourQueryKey(id) } });
  const { data: days } = useListTourDays(id, { query: { enabled: !!id, queryKey: getListTourDaysQueryKey(id) } });
  const { data: costs } = useListTourCosts(id, { query: { enabled: !!id && canSeeCosts, queryKey: getListTourCostsQueryKey(id) } });
  const { data: costSummary } = useComputeTourCostSummary(id, { query: { enabled: !!id && canSeeCosts, queryKey: getComputeTourCostSummaryQueryKey(id) } });

  const updateMutation = useUpdateTour();
  const createDayMutation = useCreateTourDay();
  const deleteDayMutation = useDeleteTourDay();
  const createCostMutation = useCreateTourCost();
  const deleteCostMutation = useDeleteTourCost();
  const itineraryMutation = useGenerateItinerary();
  const assistMutation = useAiAssist();

  const [form, setForm] = useState({ name: '', code: '', startDate: '', endDate: '', nights: 0, adultCount: 1, childCount: 0, mainDestination: '', tourType: 'cultural', status: 'draft', guideLanguage: '', transferRequired: false, isCruiseExcursion: false, shipName: '', portName: '', shipArrivalTime: '', shipDepartureTime: '', profitMargin: 20, notes: '' });
  const [dayDialogOpen, setDayDialogOpen] = useState(false);
  const [aiItineraryOpen, setAiItineraryOpen] = useState(false);
  const [generatedDays, setGeneratedDays] = useState<Array<Record<string, unknown>>>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResult, setAiResult] = useState('');
  const [dayForm, setDayForm] = useState({ dayNumber: 1, title: '', startTime: '', endTime: '', locations: '', activities: '', mealPlan: '', transportPlan: '', operationalNotes: '' });
  const [costDialogOpen, setCostDialogOpen] = useState(false);
  const [costForm, setCostForm] = useState({ description: '', category: 'transfer', quantity: 1, unitCost: 0, currency: 'EUR', taxRate: 0, isPerPerson: false, isConfirmed: false });
  const [aiDestination, setAiDestination] = useState('');
  const [aiNights, setAiNights] = useState(1);

  useEffect(() => {
    if (tour) {
      setForm({
        name: tour.name ?? '', code: tour.code ?? '', startDate: tour.startDate ?? '',
        endDate: tour.endDate ?? '', nights: tour.nights ?? 0, adultCount: tour.adultCount ?? 1,
        childCount: tour.childCount ?? 0, mainDestination: tour.mainDestination ?? '',
        tourType: tour.tourType ?? 'cultural', status: tour.status ?? 'draft',
        guideLanguage: tour.guideLanguage ?? '', transferRequired: tour.transferRequired ?? false,
        isCruiseExcursion: tour.isCruiseExcursion ?? false, shipName: tour.shipName ?? '',
        portName: tour.portName ?? '', shipArrivalTime: tour.shipArrivalTime ?? '',
        shipDepartureTime: tour.shipDepartureTime ?? '', profitMargin: tour.profitMargin ?? 20,
        notes: tour.notes ?? '',
      });
    }
  }, [tour]);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  function handleSave() {
    updateMutation.mutate({ id, data: form }, {
      onSuccess: () => { toast({ title: 'Tur güncellendi' }); qc.invalidateQueries({ queryKey: getGetTourQueryKey(id) }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleCreateDay() {
    createDayMutation.mutate({ id, data: dayForm }, {
      onSuccess: () => { toast({ title: 'Gün eklendi' }); qc.invalidateQueries({ queryKey: getListTourDaysQueryKey(id) }); setDayDialogOpen(false); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleDeleteDay(dayId: number) {
    if (!confirm('Bu günü silmek istiyor musunuz?')) return;
    deleteDayMutation.mutate({ id, dayId }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListTourDaysQueryKey(id) }),
      onError: () => toast({ title: 'Hata', description: 'Gün silinemedi', variant: 'destructive' }),
    });
  }

  function handleCreateCost() {
    createCostMutation.mutate({ id, data: { ...costForm, quantity: Number(costForm.quantity), unitCost: Number(costForm.unitCost), taxRate: Number(costForm.taxRate) } }, {
      onSuccess: () => {
        toast({ title: 'Maliyet eklendi' });
        qc.invalidateQueries({ queryKey: getListTourCostsQueryKey(id) });
        qc.invalidateQueries({ queryKey: getComputeTourCostSummaryQueryKey(id) });
        setCostDialogOpen(false);
        setCostForm({ description: '', category: 'transfer', quantity: 1, unitCost: 0, currency: 'EUR', taxRate: 0, isPerPerson: false, isConfirmed: false });
      },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleDeleteCost(costId: number) {
    if (!confirm('Bu maliyeti silmek istiyor musunuz?')) return;
    deleteCostMutation.mutate({ id, costId }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListTourCostsQueryKey(id) }); qc.invalidateQueries({ queryKey: getComputeTourCostSummaryQueryKey(id) }); },
      onError: () => toast({ title: 'Hata', description: 'Maliyet silinemedi', variant: 'destructive' }),
    });
  }

  function handleGenerateItinerary() {
    itineraryMutation.mutate({
      data: { destination: aiDestination || tour?.mainDestination || 'Efes', nights: aiNights, adultCount: tour?.adultCount ?? 2, childCount: tour?.childCount ?? 0 },
    }, {
      onSuccess: (res) => {
        const r = res as unknown as { days: Array<Record<string, unknown>> };
        setGeneratedDays(r.days ?? []);
        toast({ title: `${r.days?.length ?? 0} gün oluşturuldu` });
      },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleSaveGeneratedDays() {
    Promise.all(generatedDays.map(d => createDayMutation.mutateAsync({ id, data: d as never }))).then(() => {
      toast({ title: 'Günler kaydedildi' });
      qc.invalidateQueries({ queryKey: getListTourDaysQueryKey(id) });
      setAiItineraryOpen(false);
      setGeneratedDays([]);
    }).catch(() => toast({ title: 'Hata', variant: 'destructive' }));
  }

  function handleAiAssist() {
    assistMutation.mutate({ data: { prompt: aiPrompt, context: `Tur: ${tour?.name}, Destinasyon: ${tour?.mainDestination}` } }, {
      onSuccess: (res) => { setAiResult((res as unknown as { result: string }).result ?? ''); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  if (isLoading) return <AppShell title="Tur Detayı"><Skeleton className="h-96 rounded-xl" /></AppShell>;
  if (!tour) return <AppShell title="Tur Bulunamadı"><p className="text-muted-foreground">Tur bulunamadı.</p></AppShell>;

  return (
    <AppShell title={tour.name}>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/tours"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-tours"><ArrowLeft className="w-4 h-4" />Turlar</Button></Link>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tour.isCruiseExcursion ? 'bg-blue-100 text-blue-700' : 'bg-muted text-muted-foreground'}`}>
          {tour.isCruiseExcursion ? <span className="flex items-center gap-1"><Ship className="w-3 h-3" />Kruvaziyer</span> : (TOUR_STATUS_LABELS[tour.status] ?? tour.status)}
        </span>
      </div>

      {tour.isCruiseExcursion && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">Kruvaziyer Turu — Zaman Kritik</p>
            <p className="text-yellow-700">Gemi kalkışından {tour.cruiseSafetyBufferMinutes} dakika önce limanda olunmalıdır. Kalkış: {tour.shipDepartureTime ?? '-'}</p>
          </div>
        </div>
      )}

      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general" data-testid="tab-general">Genel Bilgi</TabsTrigger>
          <TabsTrigger value="days" data-testid="tab-days">Günler ({days?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="costs" data-testid="tab-costs">Maliyetler ({costs?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">AI Asistanı</TabsTrigger>
        </TabsList>

        {/* GENERAL INFO */}
        <TabsContent value="general">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Tur Bilgileri</CardTitle>
              {canEdit && <Button onClick={handleSave} disabled={updateMutation.isPending} size="sm" className="gap-1.5" data-testid="button-save-tour"><Save className="w-4 h-4" />{updateMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button>}
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[['Tur Adı *', 'name', 'text'], ['Tur Kodu', 'code', 'text'], ['Başlangıç Tarihi', 'startDate', 'date'], ['Bitiş Tarihi', 'endDate', 'date'], ['Gece Sayısı', 'nights', 'number'], ['Yetişkin', 'adultCount', 'number'], ['Çocuk', 'childCount', 'number'], ['Ana Destinasyon', 'mainDestination', 'text'], ['Rehber Dili', 'guideLanguage', 'text'], ['Kar Marjı (%)', 'profitMargin', 'number']].map(([label, field, type]) => (
                <div key={field}>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
                  <Input type={type} value={(form as Record<string, unknown>)[field] as string} onChange={e => set(field, type === 'number' ? Number(e.target.value) : e.target.value)} data-testid={`input-tour-${field}`} />
                </div>
              ))}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Tur Tipi</label>
                <Select value={form.tourType} onValueChange={v => set('tourType', v)}>
                  <SelectTrigger data-testid="select-tour-type-detail"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TOUR_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Durum</label>
                <Select value={form.status} onValueChange={v => set('status', v)}>
                  <SelectTrigger data-testid="select-tour-status-detail"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TOUR_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="transferRequired" checked={form.transferRequired} onChange={e => set('transferRequired', e.target.checked)} className="w-4 h-4 accent-primary" data-testid="switch-tour-transferRequired" />
                <label htmlFor="transferRequired" className="text-sm font-medium cursor-pointer">Transfer Gerekli</label>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="isCruiseExcursion" checked={form.isCruiseExcursion} onChange={e => set('isCruiseExcursion', e.target.checked)} className="w-4 h-4 accent-primary" data-testid="switch-tour-isCruiseExcursion" />
                <label htmlFor="isCruiseExcursion" className="text-sm font-medium cursor-pointer">Kruvaziyer Tur</label>
              </div>
              {form.isCruiseExcursion && (<>
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Gemi Adı</label><Input value={form.shipName} onChange={e => set('shipName', e.target.value)} data-testid="input-tour-shipName" /></div>
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Liman</label><Input value={form.portName} onChange={e => set('portName', e.target.value)} data-testid="input-tour-portName" /></div>
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Varış</label><Input value={form.shipArrivalTime} onChange={e => set('shipArrivalTime', e.target.value)} placeholder="08:00" data-testid="input-tour-shipArrivalTime" /></div>
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Kalkış</label><Input value={form.shipDepartureTime} onChange={e => set('shipDepartureTime', e.target.value)} placeholder="18:00" data-testid="input-tour-shipDepartureTime" /></div>
              </>)}
              <div className="md:col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Notlar</label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} data-testid="textarea-tour-notes" /></div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* DAYS */}
        <TabsContent value="days">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Tur Programı</h3>
            {canEdit && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAiItineraryOpen(true)} className="gap-1.5" data-testid="button-ai-itinerary"><Sparkles className="w-3.5 h-3.5" />AI ile Oluştur</Button>
                <Button size="sm" onClick={() => setDayDialogOpen(true)} className="gap-1.5" data-testid="button-add-day"><Plus className="w-3.5 h-3.5" />Gün Ekle</Button>
              </div>
            )}
          </div>
          {!days || days.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground text-sm">Henüz program eklenmedi. "Gün Ekle" veya "AI ile Oluştur" butonunu kullanın.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {[...days].sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0)).map(day => (
                <Card key={day.id} data-testid={`card-day-${day.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">{day.dayNumber}. Gün</span>
                          <span className="text-xs text-muted-foreground">{day.startTime} — {day.endTime}</span>
                        </div>
                        <p className="font-medium text-sm mb-1">{day.title}</p>
                        {day.locations && <p className="text-xs text-muted-foreground mb-1"><strong>Güzergah:</strong> {day.locations}</p>}
                        {day.activities && <p className="text-xs text-muted-foreground mb-1"><strong>Aktiviteler:</strong> {day.activities}</p>}
                        {day.mealPlan && <p className="text-xs text-muted-foreground mb-1"><strong>Yemek:</strong> {day.mealPlan}</p>}
                        {day.operationalNotes && <p className="text-xs text-orange-600 mt-2 bg-orange-50 rounded p-2"><strong>Operasyon Notu:</strong> {day.operationalNotes}</p>}
                      </div>
                      {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive flex-shrink-0" onClick={() => handleDeleteDay(day.id)} data-testid={`button-delete-day-${day.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* COSTS */}
        <TabsContent value="costs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Maliyetler</h3>
            {canEdit && <Button size="sm" onClick={() => setCostDialogOpen(true)} className="gap-1.5" data-testid="button-add-cost"><Plus className="w-3.5 h-3.5" />Maliyet Ekle</Button>}
          </div>

          {costSummary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                ['Toplam Maliyet', formatCurrency(costSummary.totalCost, costSummary.currency)],
                ['Kişi Başı', formatCurrency(costSummary.costPerPerson, costSummary.currency)],
                ['Kar Marjı', `%${costSummary.profitMargin}`],
                ['Önerilen Fiyat', formatCurrency(costSummary.suggestedSellingPrice, costSummary.currency)],
              ].map(([label, value]) => (
                <Card key={label} className={label === 'Kar Marjı' && costSummary.profitMargin < 10 ? 'border-orange-300 bg-orange-50' : ''}>
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                      {label}
                      {label === 'Kar Marjı' && costSummary.profitMargin < 10 && <AlertTriangle className="w-3 h-3 text-orange-500" />}
                    </p>
                    <p className="font-bold text-sm">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Açıklama</TableHead>
                  <TableHead className="hidden md:table-cell">Kategori</TableHead>
                  <TableHead className="hidden md:table-cell">Miktar</TableHead>
                  <TableHead>Birim Fiyat</TableHead>
                  <TableHead>Toplam</TableHead>
                  <TableHead className="w-16">İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!costs || costs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Maliyet eklenmemiş</TableCell></TableRow>
                ) : costs.map(cost => (
                  <TableRow key={cost.id} data-testid={`row-cost-${cost.id}`}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">{cost.description}</p>
                        <div className="flex gap-1 mt-0.5">
                          {cost.isPerPerson && <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Kişi Başı</span>}
                          {cost.isConfirmed && <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">Onaylı</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-xs">{COST_CATEGORY_LABELS[cost.category ?? ''] ?? cost.category}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-sm">{cost.quantity}</TableCell>
                    <TableCell className="text-sm">{cost.unitCost} {cost.currency}</TableCell>
                    <TableCell className="font-semibold text-sm">{formatCurrency(cost.total ?? 0, cost.currency)}</TableCell>
                    <TableCell>
                      {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteCost(cost.id)} data-testid={`button-delete-cost-${cost.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* AI */}
        <TabsContent value="ai">
          <Card className="max-w-xl">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" />AI Asistan</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Textarea placeholder="Ne yapmamı istersiniz? (program önerisi, maliyet tahmini, e-posta taslağı...)" rows={4} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} data-testid="textarea-ai-prompt" />
              <Button onClick={handleAiAssist} disabled={assistMutation.isPending} className="gap-2" data-testid="button-ai-send">
                <Send className="w-4 h-4" />{assistMutation.isPending ? 'Düşünüyor...' : 'Gönder'}
              </Button>
              {aiResult && (
                <div className="mt-3 p-3 bg-accent/30 rounded-lg border border-border text-sm whitespace-pre-wrap">
                  {aiResult}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Day Dialog */}
      <Dialog open={dayDialogOpen} onOpenChange={setDayDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Gün Ekle</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Gün No</label><Input type="number" value={dayForm.dayNumber} onChange={e => setDayForm(f => ({ ...f, dayNumber: Number(e.target.value) }))} data-testid="input-day-dayNumber" /></div>
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Başlık</label><Input value={dayForm.title} onChange={e => setDayForm(f => ({ ...f, title: e.target.value }))} placeholder="Efes & Şirince" data-testid="input-day-title" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Başlangıç</label><Input value={dayForm.startTime} onChange={e => setDayForm(f => ({ ...f, startTime: e.target.value }))} placeholder="08:00" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Bitiş</label><Input value={dayForm.endTime} onChange={e => setDayForm(f => ({ ...f, endTime: e.target.value }))} placeholder="18:00" /></div>
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Güzergah / Lokasyonlar</label><Input value={dayForm.locations} onChange={e => setDayForm(f => ({ ...f, locations: e.target.value }))} placeholder="Kuşadası → Efes → Şirince" /></div>
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Aktiviteler</label><Textarea value={dayForm.activities} onChange={e => setDayForm(f => ({ ...f, activities: e.target.value }))} rows={2} placeholder="Antik kent gezisi, rehber turu..." /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Yemek Planı</label><Input value={dayForm.mealPlan} onChange={e => setDayForm(f => ({ ...f, mealPlan: e.target.value }))} placeholder="Öğle yemeği dahil" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Transfer Planı</label><Input value={dayForm.transportPlan} onChange={e => setDayForm(f => ({ ...f, transportPlan: e.target.value }))} placeholder="Özel minibüs" /></div>
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Operasyon Notu</label><Textarea value={dayForm.operationalNotes} onChange={e => setDayForm(f => ({ ...f, operationalNotes: e.target.value }))} rows={2} placeholder="Kritik zamanlamalar, uyarılar..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDayDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateDay} disabled={createDayMutation.isPending} data-testid="button-save-day">{createDayMutation.isPending ? 'Ekleniyor...' : 'Ekle'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Itinerary Dialog */}
      <Dialog open={aiItineraryOpen} onOpenChange={v => { setAiItineraryOpen(v); if (!v) setGeneratedDays([]); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>AI ile Program Oluştur</DialogTitle></DialogHeader>
          {generatedDays.length === 0 ? (
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Destinasyon</label><Input value={aiDestination} onChange={e => setAiDestination(e.target.value)} placeholder={tour.mainDestination ?? 'Efes'} data-testid="input-ai-destination" /></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Gece Sayısı</label><Input type="number" value={aiNights} onChange={e => setAiNights(Number(e.target.value))} data-testid="input-ai-nights" /></div>
              <Button onClick={handleGenerateItinerary} disabled={itineraryMutation.isPending} className="w-full gap-2" data-testid="button-generate-itinerary">
                <Sparkles className="w-4 h-4" />{itineraryMutation.isPending ? 'Oluşturuluyor...' : 'Program Oluştur'}
              </Button>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {generatedDays.map((d, i) => (
                <div key={i} className="p-2 bg-muted rounded text-xs">
                  <p className="font-semibold">{i + 1}. Gün: {d.title as string}</p>
                  <p className="text-muted-foreground">{d.summary as string}</p>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiItineraryOpen(false)}>İptal</Button>
            {generatedDays.length > 0 && (
              <Button onClick={handleSaveGeneratedDays} data-testid="button-save-generated-days">Kaydet ({generatedDays.length} gün)</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Cost Dialog */}
      <Dialog open={costDialogOpen} onOpenChange={setCostDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Maliyet Ekle</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Açıklama *</label><Input value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} placeholder="Transfer hizmeti..." data-testid="input-cost-description" /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Kategori</label>
              <Select value={costForm.category} onValueChange={v => setCostForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-cost-category"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(COST_CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Para Birimi</label>
              <Select value={costForm.currency} onValueChange={v => setCostForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Miktar</label><Input type="number" value={costForm.quantity} onChange={e => setCostForm(f => ({ ...f, quantity: Number(e.target.value) }))} data-testid="input-cost-quantity" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Birim Fiyat</label><Input type="number" value={costForm.unitCost} onChange={e => setCostForm(f => ({ ...f, unitCost: Number(e.target.value) }))} data-testid="input-cost-unitCost" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">KDV (%)</label><Input type="number" value={costForm.taxRate} onChange={e => setCostForm(f => ({ ...f, taxRate: Number(e.target.value) }))} /></div>
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" id="isPerPerson" checked={costForm.isPerPerson} onChange={e => setCostForm(f => ({ ...f, isPerPerson: e.target.checked }))} className="w-4 h-4 accent-primary" />
              <label htmlFor="isPerPerson" className="text-sm cursor-pointer">Kişi Başı</label>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input type="checkbox" id="isConfirmed" checked={costForm.isConfirmed} onChange={e => setCostForm(f => ({ ...f, isConfirmed: e.target.checked }))} className="w-4 h-4 accent-primary" />
              <label htmlFor="isConfirmed" className="text-sm cursor-pointer">Onaylı</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCostDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateCost} disabled={createCostMutation.isPending} data-testid="button-save-cost">{createCostMutation.isPending ? 'Ekleniyor...' : 'Ekle'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { sheetImportApi, type MappedFields, type SheetReservationImport } from '@/lib/sheet-import-api';
import { SheetImportFieldGrid, type FieldSpec } from '@/components/sheet-import/sheet-import-field-grid';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, ExternalLink, Save, XCircle } from 'lucide-react';

// Faz 5.3: sectioned review panel for a single sheet_reservation_imports row
// (see PLAN_Sheet_Import_Mapping_Refactor.md paragraf 6a). Genel / Musteri /
// Yolcu / Tur / Gemi-Liman / Operasyon Atamalari / Hizmet / Kaynak / Finans
// sections, each backed by the same MappedFields the server computes in
// mapSheetRowToStructuredFields() and stores as mappedData. Saving here calls
// PATCH /:id/review; rowData (the raw sheet row) is never edited from this
// page - it stays the untouched source of truth, shown read-only at the
// bottom under "Import Audit".
//
// tourProductMatchStatus/portCallMatchStatus are only computed inside the
// /approve transaction (matching is not previewed live while reviewing), so
// this page shows a neutral "onayda hesaplanacak" badge until the row is
// actually approved, then shows the real outcome.

const GENERAL_FIELDS: FieldSpec[] = [
  ['startDate', 'Tarih', 'date'],
  ['sourceBookingReference', 'Booking ID'],
];
const CUSTOMER_FIELDS: FieldSpec[] = [
  ['customerName', 'Müşteri Adı'],
  ['customerPhone', 'Telefon'],
  ['customerEmail', 'E-posta'],
  ['nationality', 'Ülke / Milliyet'],
];
const PASSENGER_FIELDS: FieldSpec[] = [
  ['adultCount', 'Yetişkin', 'number'],
  ['childCount', 'Çocuk', 'number'],
  ['passengerLanguage', 'Dil'],
];
const TOUR_FIELDS: FieldSpec[] = [
  ['tourCodeRaw', 'Tur Kodu'],
  ['tourType', 'Tur Tipi'],
  ['itineraryRaw', 'Tur İçeriği'],
];
const CRUISE_FIELDS: FieldSpec[] = [
  ['shipRaw', 'Gemi'],
  ['portRaw', 'Liman'],
  ['shipScheduleRaw', 'Gemi Saatleri'],
  ['pickupPoint', 'Pickup Noktası'],
  ['pickupTime', 'Pickup Saati'],
];
const ASSIGNMENT_FIELDS: FieldSpec[] = [
  ['guideNameRaw', 'Rehber'],
  ['driverNameRaw', 'Şoför'],
  ['vehiclePlateRaw', 'Araç Plakası'],
];
const SOURCE_FIELDS: FieldSpec[] = [
  ['externalSource', 'Kaynak'],
  ['externalOperator', 'Operatör'],
];
const FINANCIAL_FIELDS: FieldSpec[] = [
  ['netAmount', 'Net Tutar', 'number'],
  ['currency', 'Para Birimi'],
  ['advanceAmount', 'Avans (TL)', 'number'],
  ['collectionStatusRaw', 'Tahsilat Durumu'],
];

const INCLUDED_LABELS: Record<MappedFields['mealIncluded'], string> = {
  included: 'Dahil',
  excluded: 'Hariç',
  unspecified: 'Belirtilmemiş',
};

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('tr-TR');
}

function TourProductMatchBadge({ status }: { status: SheetReservationImport['tourProductMatchStatus'] }) {
  if (status === 'matched') return <Badge className="bg-emerald-100 text-emerald-800">Tur ürünüyle eşleşti</Badge>;
  if (status === 'alias_matched') return <Badge className="bg-emerald-100 text-emerald-800">Takma adla eşleşti</Badge>;
  if (status === 'unmatched') return <Badge className="bg-amber-100 text-amber-800">Eşleşmedi</Badge>;
  return <Badge className="bg-gray-100 text-gray-700">Onayda hesaplanacak</Badge>;
}

function PortCallMatchBadge({ status }: { status: SheetReservationImport['portCallMatchStatus'] }) {
  if (status === 'matched') return <Badge className="bg-emerald-100 text-emerald-800">Port Call ile eşleşti</Badge>;
  if (status === 'time_changed') return <Badge className="bg-amber-100 text-amber-800">Saatler farklı</Badge>;
  if (status === 'new_port_call') return <Badge className="bg-amber-100 text-amber-800">Yeni Port Call gerekebilir</Badge>;
  if (status === 'unmatched') return <Badge className="bg-amber-100 text-amber-800">Eşleşmedi</Badge>;
  return <Badge className="bg-gray-100 text-gray-700">Onayda hesaplanacak</Badge>;
}

export default function SheetImportDetailPage() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState<MappedFields | null>(null);
  const [agesText, setAgesText] = useState('');
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['sheet-import-detail', id],
    queryFn: () => sheetImportApi.get(id),
    enabled: Number.isFinite(id),
  });

  useEffect(() => {
    if (detail.data?.mappedData) {
      setForm(detail.data.mappedData);
      setAgesText((detail.data.mappedData.passengerAges ?? []).join(', '));
    }
  }, [detail.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sheet-import-detail', id] });
    qc.invalidateQueries({ queryKey: ['sheet-import'] });
  };

  const save = useMutation({
    mutationFn: () => sheetImportApi.review(id, form as MappedFields),
    onSuccess: (updated) => {
      toast({ title: 'İnceleme kaydedildi' });
      if (updated.mappedData) setForm(updated.mappedData);
      refresh();
    },
    onError: (error: Error) => toast({ title: 'Kayıt başarısız', description: error.message, variant: 'destructive' }),
  });

  const approve = useMutation({
    mutationFn: () => sheetImportApi.approve(id),
    onSuccess: (updated) => {
      toast({ title: 'Satır onaylandı, operasyon oluşturuldu' });
      setConfirmAction(null);
      refresh();
      if (updated.matchedOperationId) navigate(`/operations/${updated.matchedOperationId}`);
    },
    onError: (error: Error) => {
      setConfirmAction(null);
      toast({ title: 'Onaylanamadı', description: error.message, variant: 'destructive' });
    },
  });

  const reject = useMutation({
    mutationFn: () => sheetImportApi.reject(id),
    onSuccess: () => {
      toast({ title: 'Satır reddedildi' });
      setConfirmAction(null);
      refresh();
      navigate('/sheet-import');
    },
    onError: (error: Error) => {
      setConfirmAction(null);
      toast({ title: 'İşlem başarısız', description: error.message, variant: 'destructive' });
    },
  });

  if (detail.isLoading || !form) {
    return (
      <AppShell title="Sheet Satırı">
        <div className="space-y-4">
          <div className="h-24 bg-muted animate-pulse rounded-xl" />
          <div className="h-96 bg-muted animate-pulse rounded-xl" />
        </div>
      </AppShell>
    );
  }

  const item = detail.data;
  if (!item) {
    return (
      <AppShell title="Sheet Satırı">
        <Card><CardContent className="py-12 text-center">Kayıt bulunamadı.</CardContent></Card>
      </AppShell>
    );
  }

  const isPending = item.status === 'pending';
  const set = <K extends keyof MappedFields>(key: K, value: MappedFields[K]) =>
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));

  return (
    <AppShell title="Sheet Satırı İncelemesi">
      <div className="flex flex-wrap justify-between gap-2 mb-5">
        <Link href="/sheet-import"><Button variant="ghost" className="gap-1"><ArrowLeft className="w-4 h-4" />Sheet İçe Aktarım</Button></Link>
        <div className="flex flex-wrap gap-2">
          {isPending && (
            <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending} className="gap-1">
              <Save className="w-4 h-4" />Kaydet
            </Button>
          )}
          {isPending && (
            <Button variant="destructive" onClick={() => setConfirmAction('reject')} className="gap-1">
              <XCircle className="w-4 h-4" />Reddet
            </Button>
          )}
          {isPending && (
            <Button onClick={() => setConfirmAction('approve')} className="gap-1">
              <CheckCircle2 className="w-4 h-4" />Onayla
            </Button>
          )}
          {item.matchedOperationId && (
            <Button variant="outline" onClick={() => navigate(`/operations/${item.matchedOperationId}`)} className="gap-1">
              <ExternalLink className="w-4 h-4" />Operasyonu Aç
            </Button>
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-[#1e3a5f]">{item.sheetName} · Satır {item.rowNumber}</h1>
        {item.status === 'pending' && <Badge className="bg-gray-100 text-gray-800">Bekliyor</Badge>}
        {item.status === 'approved' && <Badge className="bg-emerald-100 text-emerald-800">Onaylandı</Badge>}
        {item.status === 'rejected' && <Badge className="bg-red-100 text-red-800">Reddedildi</Badge>}
        <span className="text-xs text-muted-foreground">Düzenleyen: {item.editedByEmail} · {formatDateTime(item.editedAt)}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Genel</CardTitle></CardHeader>
          <CardContent><SheetImportFieldGrid fields={GENERAL_FIELDS} value={form} onChange={setForm} idPrefix="general" disabled={!isPending} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Müşteri</CardTitle></CardHeader>
          <CardContent><SheetImportFieldGrid fields={CUSTOMER_FIELDS} value={form} onChange={setForm} idPrefix="customer" disabled={!isPending} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Yolcu Bilgileri</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <SheetImportFieldGrid fields={PASSENGER_FIELDS} value={form} onChange={setForm} idPrefix="passenger" disabled={!isPending} />
            <div className="text-sm">
              <label htmlFor="passenger-ages" className="text-xs text-muted-foreground block mb-1">Yaşlar (virgülle ayırın)</label>
              <Input
                id="passenger-ages"
                disabled={!isPending}
                value={agesText}
                onChange={e => setAgesText(e.target.value)}
                onBlur={() => {
                  const ages = agesText
                    .split(',')
                    .map(part => Number.parseInt(part.trim(), 10))
                    .filter(n => Number.isFinite(n) && n >= 0 && n <= 120);
                  set('passengerAges', ages.length > 0 ? ages : null);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
              Tur Bilgileri
              <TourProductMatchBadge status={item.tourProductMatchStatus} />
            </CardTitle>
          </CardHeader>
          <CardContent><SheetImportFieldGrid fields={TOUR_FIELDS} value={form} onChange={setForm} idPrefix="tour" disabled={!isPending} /></CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between flex-wrap gap-2">
              Gemi / Liman
              <PortCallMatchBadge status={item.portCallMatchStatus} />
            </CardTitle>
          </CardHeader>
          <CardContent><SheetImportFieldGrid fields={CRUISE_FIELDS} value={form} onChange={setForm} idPrefix="cruise" disabled={!isPending} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Operasyon Atamaları</CardTitle></CardHeader>
          <CardContent><SheetImportFieldGrid fields={ASSIGNMENT_FIELDS} value={form} onChange={setForm} idPrefix="assignment" disabled={!isPending} /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Hizmet Detayları</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="text-sm">
                <label className="text-xs text-muted-foreground block mb-1">Yemek</label>
                <Select value={form.mealIncluded} onValueChange={v => set('mealIncluded', v as MappedFields['mealIncluded'])} disabled={!isPending}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INCLUDED_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm">
                <label className="text-xs text-muted-foreground block mb-1">Girişler</label>
                <Select value={form.entranceIncluded} onValueChange={v => set('entranceIncluded', v as MappedFields['entranceIncluded'])} disabled={!isPending}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(INCLUDED_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-sm">
              <label htmlFor="special-requirements" className="text-xs text-muted-foreground block mb-1">Özel Notlar</label>
              <Textarea
                id="special-requirements"
                disabled={!isPending}
                value={form.specialRequirements ?? ''}
                onChange={e => set('specialRequirements', e.target.value || null)}
              />
            </div>
            <div className="text-sm">
              <label htmlFor="op-notes" className="text-xs text-muted-foreground block mb-1">Op Notları</label>
              <Textarea
                id="op-notes"
                disabled={!isPending}
                value={form.opNotes ?? ''}
                onChange={e => set('opNotes', e.target.value || null)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Rezervasyon Kaynağı</CardTitle></CardHeader>
          <CardContent><SheetImportFieldGrid fields={SOURCE_FIELDS} value={form} onChange={setForm} idPrefix="source" disabled={!isPending} /></CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              Finansal Özet (İçe Aktarılan)
              <Badge className="bg-gray-100 text-gray-700">Muhasebeye henüz işlenmedi</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent><SheetImportFieldGrid fields={FINANCIAL_FIELDS} value={form} onChange={setForm} idPrefix="financial" disabled={!isPending} /></CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="cursor-pointer select-none" onClick={() => setAuditOpen(open => !open)}>
          <CardTitle className="text-base flex items-center justify-between">
            İçe Aktarım Denetimi (Ham Satır)
            {auditOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </CardTitle>
        </CardHeader>
        {auditOpen && (
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">
              Bu bölüm yalnızca referans içindir; hiçbir alan buradan düzenlenmez. Yukarıdaki bölümler her zaman bu
              satırdan türetilir, bu satır asla değişmez.
            </p>
            <div className="max-h-96 overflow-y-auto space-y-1 text-xs">
              {Object.entries(item.rowData)
                .filter(([, v]) => v !== null && String(v).trim() !== '')
                .map(([k, v]) => (
                  <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>
                ))}
            </div>
          </CardContent>
        )}
      </Card>

      <Dialog open={!!confirmAction} onOpenChange={open => !open && setConfirmAction(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirmAction === 'approve' ? 'Satırı onayla' : 'Satırı reddet'}</DialogTitle>
            <DialogDescription>
              {item.sheetName} · Satır {item.rowNumber}
              {confirmAction === 'approve'
                ? ' — onaylandığında yukarıdaki alanlar kullanılarak yapılandırılmış bir operasyon kaydı oluşturulacak.'
                : ' — bu satır reddedilecek ve hiçbir kayıt oluşturulmayacak.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={approve.isPending || reject.isPending}>
              Vazgeç
            </Button>
            <Button
              variant={confirmAction === 'reject' ? 'destructive' : 'default'}
              onClick={() => (confirmAction === 'approve' ? approve.mutate() : reject.mutate())}
              disabled={approve.isPending || reject.isPending}
            >
              {confirmAction === 'approve' ? 'Onayla' : 'Reddet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

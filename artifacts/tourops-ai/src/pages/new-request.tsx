import { useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAnalyzeCustomerRequest, useCreateCustomer } from '@workspace/api-client-react';
import { getListCustomersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import {
  Sparkles, RotateCcw, UserPlus, Clipboard, X, BrainCircuit,
  Users, MapPin, Car, Languages, Star, AlertCircle, CalendarDays,
  MessageCircle, Mail, Phone, Globe, MoreHorizontal,
} from 'lucide-react';
import { CUSTOMER_TYPE_LABELS } from '@/lib/labels';

// ── Types ──────────────────────────────────────────────────────────────────────
type Analysis = {
  customerName:    string | null;
  startDate:       string | null;
  endDate:         string | null;
  adultCount:      number | null;
  childCount:      number | null;
  destination:     string | null;
  duration:        number | null;
  budget:          string | null;
  hotelCategory:   string | null;
  transferRequired: boolean | null;
  guideLanguage:   string | null;
  activities:      string | null;
  mealPreferences: string | null;
  specialRequests: string | null;
  customerType:    string | null;
  missingFields:   string[];
};

type Source = 'whatsapp' | 'email' | 'phone' | 'web' | 'other';

const SOURCE_OPTIONS: { value: Source; label: string; icon: React.ReactNode }[] = [
  { value: 'whatsapp', label: 'WhatsApp',   icon: <MessageCircle className="w-3.5 h-3.5" /> },
  { value: 'email',    label: 'E-posta',    icon: <Mail          className="w-3.5 h-3.5" /> },
  { value: 'phone',    label: 'Telefon',    icon: <Phone         className="w-3.5 h-3.5" /> },
  { value: 'web',      label: 'Web Formu',  icon: <Globe         className="w-3.5 h-3.5" /> },
  { value: 'other',    label: 'Diğer',      icon: <MoreHorizontal className="w-3.5 h-3.5" /> },
];

const EXAMPLE_MESSAGES: { label: string; text: string }[] = [
  {
    label: 'Cruise yolcusu Efes turu',
    text:  'Merhaba, 4 Eylül\'de Kuşadası\'na gelen cruise yolcusuyuz. Sabah 8\'de 2 yetişkin için yarım günlük Efes turu istiyoruz, öğleden önce limanda olmamız gerekiyor. İngilizce rehber tercih ediyoruz.',
  },
  {
    label: 'Havalimanı transferi',
    text:  'İzmir Adnan Menderes Havalimanı\'ndan Kuşadası\'na transfer istiyoruz. 12 Eylül saat 15:30\'da uçuşumuz var, 3 kişiyiz ve valizlerimiz mevcut. Fiyat alabilir miyim?',
  },
  {
    label: 'Özel grup Pamukkale',
    text:  '10 kişilik şirket grubumuz için 20–21 Eylül\'de 2 günlük Pamukkale ve Hierapolis turu planlıyoruz. Konfor sınıfı araç, Türkçe rehber ve öğle yemeği dahil olsun. Kişi başı bütçemiz 150 EUR civarı.',
  },
];

const FIELD_LABELS: Record<string, string> = {
  customerName:    'Ad Soyad',
  startDate:       'Başlangıç Tarihi',
  endDate:         'Bitiş Tarihi',
  adultCount:      'Yetişkin Sayısı',
  childCount:      'Çocuk Sayısı',
  destination:     'Destinasyon',
  duration:        'Süre (gün)',
  budget:          'Bütçe',
  hotelCategory:   'Otel Kategorisi',
  guideLanguage:   'Rehber Dili',
  activities:      'Aktiviteler',
  mealPreferences: 'Yemek Tercihleri',
  specialRequests: 'Özel İstekler',
  customerType:    'Müşteri Tipi',
  transferRequired:'Transfer',
};

const NONE = 'Belirtilmedi';

// ── Helpers ────────────────────────────────────────────────────────────────────
function val(v: string | number | null | undefined): string {
  if (v == null || v === '') return NONE;
  return String(v);
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function GroupCard({
  icon, title, children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <span className="text-primary">{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {children}
      </CardContent>
    </Card>
  );
}

function FieldDisplay({
  label, value: v, missing, fullWidth,
}: {
  label: string; value: string; missing?: boolean; fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
        {missing && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-600 bg-orange-50">
            Eksik
          </Badge>
        )}
      </div>
      <p className={`text-sm font-medium ${v === NONE ? 'text-muted-foreground italic' : 'text-foreground'}`}>
        {v}
      </p>
    </div>
  );
}

function EditableField({
  field, label, type = 'text', form, setForm, missing, fullWidth,
}: {
  field: string; label: string; type?: string;
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  missing?: boolean; fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-xs text-muted-foreground font-medium">{label}</label>
        {missing && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-600 bg-orange-50">
            Eksik
          </Badge>
        )}
      </div>
      <Input
        type={type}
        value={form[field] ?? ''}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        className="h-8 text-sm"
        data-testid={`input-request-${field}`}
      />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function NewRequestPage() {
  const [, setLocation]  = useLocation();
  const { toast }        = useToast();
  const qc               = useQueryClient();
  const analyzeMutation  = useAnalyzeCustomerRequest();
  const createMutation   = useCreateCustomer();

  const [message,  setMessage]  = useState('');
  const [source,   setSource]   = useState<Source>('whatsapp');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [form,     setForm]     = useState<Record<string, string>>({});

  // ── Actions ──────────────────────────────────────────────────────────────────
  function handleAnalyze() {
    if (!message.trim()) {
      toast({ title: 'Lütfen müşteri mesajını girin', variant: 'destructive' });
      return;
    }
    analyzeMutation.mutate({ data: { message } }, {
      onSuccess: (data) => {
        const d = data as unknown as Analysis;
        setAnalysis(d);
        setForm({
          customerName:    d.customerName    ?? '',
          startDate:       d.startDate       ?? '',
          endDate:         d.endDate         ?? '',
          adultCount:      d.adultCount?.toString()  ?? '',
          childCount:      d.childCount?.toString()  ?? '',
          destination:     d.destination     ?? '',
          duration:        d.duration?.toString()    ?? '',
          budget:          d.budget          ?? '',
          hotelCategory:   d.hotelCategory   ?? '',
          guideLanguage:   d.guideLanguage   ?? '',
          activities:      d.activities      ?? '',
          mealPreferences: d.mealPreferences ?? '',
          specialRequests: d.specialRequests ?? '',
          customerType:    d.customerType    ?? 'individual',
        });
        toast({
          title:       'Analiz tamamlandı',
          description: d.missingFields?.length
            ? `${d.missingFields.length} eksik alan tespit edildi`
            : 'Tüm bilgiler başarıyla çıkarıldı',
        });
      },
      onError: () => toast({ title: 'Analiz başarısız', description: 'Lütfen tekrar deneyin', variant: 'destructive' }),
    });
  }

  function handleCreate() {
    if (!form.customerName?.trim()) {
      toast({ title: 'Ad Soyad zorunludur', variant: 'destructive' });
      return;
    }
    createMutation.mutate({ data: {
      name:            form.customerName,
      customerType:    form.customerType || 'individual',
      phone:           form.phone    ?? undefined,
      email:           form.email    ?? undefined,
      travelPreferences: [form.activities, form.mealPreferences, form.specialRequests]
        .filter(Boolean).join(', ') || undefined,
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

  const handleReset = useCallback(() => {
    setAnalysis(null);
    setForm({});
    setMessage('');
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setMessage(text);
    } catch {
      toast({ title: 'Panoya erişilemedi', variant: 'destructive' });
    }
  }, [toast]);

  const missing = analysis?.missingFields ?? [];
  const isMissing = (f: string) => missing.includes(f);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <AppShell title="Yeni Müşteri Talebi">
      {/* Page header */}
      <div className="mb-6">
        <p className="text-sm text-muted-foreground max-w-2xl">
          WhatsApp, e-posta veya telefon görüşmesi notunu yapıştırın; TourPilot bilgileri otomatik olarak düzenlesin.
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        {/* ── LEFT: Input ────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Source selector */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Kaynak:</span>
            <div className="flex gap-1.5 flex-wrap">
              {SOURCE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSource(opt.value)}
                  className={`
                    inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                    border transition-colors min-h-[36px]
                    ${source === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                    }
                  `}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message textarea card */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Müşteri Mesajı
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="relative">
                <Textarea
                  placeholder="Müşteri mesajını buraya yapıştırın…"
                  rows={7}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  className="resize-none pr-8 text-sm"
                  data-testid="textarea-customer-message"
                />
                {message && (
                  <button
                    onClick={() => setMessage('')}
                    className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Temizle"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Char count + paste */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {message.length} karakter
                </span>
                {'clipboard' in navigator && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePaste}
                    className="gap-1.5 h-7 text-xs px-2"
                  >
                    <Clipboard className="w-3 h-3" />
                    Yapıştır
                  </Button>
                )}
              </div>

              {/* Example shortcuts */}
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground font-medium">Örnek talepler:</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_MESSAGES.map(ex => (
                    <button
                      key={ex.label}
                      onClick={() => setMessage(ex.text)}
                      className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-border bg-muted/40
                                 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors
                                 min-h-[36px]"
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Analyze button */}
              <div className="flex gap-2 pt-1">
                <Button
                  onClick={handleAnalyze}
                  disabled={analyzeMutation.isPending || !message.trim()}
                  className="gap-2 min-h-[44px]"
                  data-testid="button-analyze-request"
                >
                  {analyzeMutation.isPending ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                      Talep analiz ediliyor…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      AI ile Analiz Et
                    </>
                  )}
                </Button>
                {analysis && (
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="gap-2 min-h-[44px]"
                    data-testid="button-reset-request"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Sıfırla
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: Preview / Result ─────────────────────────────────────── */}
        <div className="space-y-4">
          {analyzeMutation.isPending ? (
            /* Loading skeleton */
            <Card className="border-border/60">
              <CardContent className="py-10 flex flex-col items-center gap-4">
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Yapay zeka talep analiz ediyor…</p>
              </CardContent>
            </Card>
          ) : analysis ? (
            /* Analysis result */
            <>
              {/* Summary banner */}
              {missing.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-orange-700">
                    <span className="font-semibold">{missing.length} eksik alan:</span>{' '}
                    {missing.map(f => FIELD_LABELS[f] ?? f).join(', ')}
                  </p>
                </div>
              )}

              {/* Müşteri ve Grup */}
              <GroupCard icon={<Users className="w-4 h-4" />} title="Müşteri ve Grup">
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <label className="text-xs text-muted-foreground font-medium">Ad Soyad *</label>
                    {isMissing('customerName') && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-600 bg-orange-50">Eksik</Badge>
                    )}
                  </div>
                  <Input
                    value={form.customerName ?? ''}
                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    placeholder="Ad Soyad"
                    className="h-8 text-sm"
                    data-testid="input-request-customerName"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1">Müşteri Tipi</label>
                  <Select
                    value={form.customerType ?? 'individual'}
                    onValueChange={v => setForm(f => ({ ...f, customerType: v }))}
                  >
                    <SelectTrigger className="h-8 text-sm" data-testid="select-request-customerType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <EditableField field="adultCount"  label="Yetişkin Sayısı" type="number" form={form} setForm={setForm} missing={isMissing('adultCount')} />
                <EditableField field="childCount"  label="Çocuk Sayısı"    type="number" form={form} setForm={setForm} missing={isMissing('childCount')} />
              </GroupCard>

              {/* Tur Bilgileri */}
              <GroupCard icon={<CalendarDays className="w-4 h-4" />} title="Tur Bilgileri">
                <EditableField field="destination"  label="Destinasyon"       form={form} setForm={setForm} missing={isMissing('destination')}  fullWidth />
                <EditableField field="startDate"    label="Başlangıç Tarihi"  type="date" form={form} setForm={setForm} missing={isMissing('startDate')} />
                <EditableField field="endDate"      label="Bitiş Tarihi"      type="date" form={form} setForm={setForm} missing={isMissing('endDate')} />
                <EditableField field="duration"     label="Süre (gün)"        type="number" form={form} setForm={setForm} missing={isMissing('duration')} />
                <EditableField field="budget"       label="Bütçe"             form={form} setForm={setForm} missing={isMissing('budget')} />
                <EditableField field="hotelCategory" label="Otel Kategorisi"  form={form} setForm={setForm} missing={isMissing('hotelCategory')} />
              </GroupCard>

              {/* Ulaşım */}
              <GroupCard icon={<Car className="w-4 h-4" />} title="Ulaşım">
                <div className="sm:col-span-2 flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-medium">Transfer</span>
                  {analysis.transferRequired == null ? (
                    <span className="text-sm text-muted-foreground italic">{NONE}</span>
                  ) : (
                    <Badge variant={analysis.transferRequired ? 'default' : 'secondary'}>
                      {analysis.transferRequired ? 'Gerekli' : 'Gerekli Değil'}
                    </Badge>
                  )}
                  {isMissing('transferRequired') && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-300 text-orange-600 bg-orange-50">Eksik</Badge>
                  )}
                </div>
              </GroupCard>

              {/* Rehber ve Dil */}
              <GroupCard icon={<Languages className="w-4 h-4" />} title="Rehber ve Dil">
                <EditableField field="guideLanguage" label="Rehber Dili" form={form} setForm={setForm} missing={isMissing('guideLanguage')} fullWidth />
              </GroupCard>

              {/* Özel İstekler */}
              <GroupCard icon={<Star className="w-4 h-4" />} title="Özel İstekler">
                <EditableField field="activities"      label="Aktiviteler"       form={form} setForm={setForm} missing={isMissing('activities')}      fullWidth />
                <EditableField field="mealPreferences" label="Yemek Tercihleri"  form={form} setForm={setForm} missing={isMissing('mealPreferences')} fullWidth />
                <EditableField field="specialRequests" label="Özel İstekler"     form={form} setForm={setForm} missing={isMissing('specialRequests')} fullWidth />
              </GroupCard>

              {/* Eksik Bilgiler */}
              {missing.length > 0 && (
                <GroupCard icon={<AlertCircle className="w-4 h-4" />} title="Eksik Bilgiler">
                  <div className="sm:col-span-2 flex flex-wrap gap-1.5">
                    {missing.map(f => (
                      <Badge key={f} variant="outline" className="border-orange-300 text-orange-600 bg-orange-50">
                        {FIELD_LABELS[f] ?? f}
                      </Badge>
                    ))}
                  </div>
                </GroupCard>
              )}

              {/* Action row */}
              <div className="flex gap-3 pt-1">
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="gap-2 min-h-[44px]"
                  data-testid="button-create-from-request"
                >
                  <UserPlus className="w-4 h-4" />
                  {createMutation.isPending ? 'Kaydediliyor…' : 'Müşteri Oluştur'}
                </Button>
              </div>
            </>
          ) : (
            /* Empty state */
            <Card className="border-dashed border-border/70 bg-muted/20">
              <CardContent className="py-10 px-6 flex flex-col items-center text-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <BrainCircuit className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground mb-1">AI Analiz Önizlemesi</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Müşteri mesajını yapıştırın ve analiz başlatın. Sistem şunları otomatik tanımlar:
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-left w-full max-w-xs">
                  {[
                    'Tur türü', 'Destinasyon', 'Tarih', 'Kişi sayısı',
                    'Dil', 'Transfer ihtiyacı', 'Araç tercihi', 'Özel istekler',
                    'Eksik bilgiler',
                  ].map(item => (
                    <div key={item} className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-primary/60 shrink-0" />
                      <span className="text-xs text-muted-foreground">{item}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}

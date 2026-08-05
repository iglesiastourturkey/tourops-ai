import { useState } from 'react';
import { Link, useParams, useLocation } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  useGetQuotation, useUpdateQuotationStatus, useDuplicateQuotation,
  useConvertQuotationToOperation, useGenerateEmail,
  useGetCustomer, useGetTour, useListTourDays, useGetAgencySettings,
} from '@workspace/api-client-react';
import {
  getGetQuotationQueryKey,
  getListQuotationsQueryKey,
  getGetCustomerQueryKey,
  getGetTourQueryKey,
  getListTourDaysQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Copy, GitBranch, Mail, FileDown } from 'lucide-react';
import { QUOTATION_STATUS_LABELS, QUOTATION_STATUS_COLORS, formatCurrency, formatDate } from '@/lib/labels';
import { generateQuotationPdf } from '@/lib/pdf-export';

const STATUS_OPTIONS = ['sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised'];
const EMAIL_TYPES = [
  { value: 'quotation', label: 'Teklif E-postası' },
  { value: 'follow_up', label: 'Takip E-postası' },
  { value: 'confirmation', label: 'Onay E-postası' },
];

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailType, setEmailType] = useState('quotation');
  const [emailContext, setEmailContext] = useState('');
  const [generatedEmail, setGeneratedEmail] = useState<{ subject: string; body: string } | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);

  const { data: quotation, isLoading } = useGetQuotation(id, {
    query: { enabled: !!id, queryKey: getGetQuotationQueryKey(id) },
  });

  const customerId = quotation?.customerId ?? null;
  const tourId = quotation?.tourId ?? null;

  const { data: customer } = useGetCustomer(customerId!, {
    query: {
      enabled: !!customerId,
      queryKey: getGetCustomerQueryKey(customerId!),
    },
  });

  const { data: tour } = useGetTour(tourId!, {
    query: {
      enabled: !!tourId,
      queryKey: getGetTourQueryKey(tourId!),
    },
  });

  const { data: tourDays } = useListTourDays(tourId!, {
    query: {
      enabled: !!tourId,
      queryKey: getListTourDaysQueryKey(tourId!),
    },
  });

  const { data: agencySettings } = useGetAgencySettings();

  const statusMutation  = useUpdateQuotationStatus();
  const duplicateMutation = useDuplicateQuotation();
  const convertMutation   = useConvertQuotationToOperation();
  const emailMutation     = useGenerateEmail();

  function handleStatusChange(status: string) {
    statusMutation.mutate({ id, data: { status } }, {
      onSuccess: () => {
        toast({ title: 'Durum güncellendi' });
        qc.invalidateQueries({ queryKey: getGetQuotationQueryKey(id) });
      },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleDuplicate() {
    duplicateMutation.mutate({ id }, {
      onSuccess: (q) => { toast({ title: 'Teklif kopyalandı' }); setLocation(`/quotations/${q.id}`); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleConvert() {
    if (!confirm('Bu teklifi operasyona dönüştürmek istiyor musunuz?')) return;
    convertMutation.mutate({ id }, {
      onSuccess: (op) => {
        toast({ title: 'Operasyon oluşturuldu' });
        qc.invalidateQueries({ queryKey: getGetQuotationQueryKey(id) });
        qc.invalidateQueries({ queryKey: getListQuotationsQueryKey() });
        setLocation(`/operations/${op.id}`);
      },
      onError: (error) => {
        const operationId = (error as { data?: { operationId?: number } })?.data?.operationId;
        toast({
          title: operationId ? 'Teklif zaten dönüştürülmüş' : 'Dönüştürme başarısız',
          description: operationId ? `Bağlı operasyon: OP-${operationId}` : undefined,
          variant: 'destructive',
        });
        if (operationId) setLocation(`/operations/${operationId}`);
      },
    });
  }

  function handleGenerateEmail() {
    emailMutation.mutate({
      data: {
        templateType: emailType,
        context: emailContext || `Teklif No: ${quotation?.number}, Fiyat: ${quotation?.finalPrice} ${quotation?.currency}`,
      },
    }, {
      onSuccess: (result) => { setGeneratedEmail(result as unknown as { subject: string; body: string }); },
      onError: () => toast({ title: 'E-posta oluşturulamadı', variant: 'destructive' }),
    });
  }

  async function handleDownloadPdf() {
    if (!quotation) return;
    setIsPdfLoading(true);
    try {
      await generateQuotationPdf(
        quotation,
        customer ?? null,
        tour ?? null,
        tourDays ?? [],
        agencySettings ?? null,
      );
    } catch {
      toast({
        title: 'PDF oluşturulamadı',
        description: 'PDF oluşturulurken bir hata oluştu. Lütfen tekrar deneyin.',
        variant: 'destructive',
      });
    } finally {
      setIsPdfLoading(false);
    }
  }

  if (isLoading) return <AppShell title="Teklif Detayı"><Skeleton className="h-96 rounded-xl" /></AppShell>;
  if (!quotation) return <AppShell title="Teklif Bulunamadı"><div className="text-muted-foreground">Teklif bulunamadı.</div></AppShell>;

  return (
    <AppShell title={quotation.number}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <Link href="/quotations">
          <Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-quotations">
            <ArrowLeft className="w-4 h-4" />Teklifler
          </Button>
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={quotation.status} onValueChange={handleStatusChange} disabled={quotation.status === 'converted'}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-quotation-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{QUOTATION_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={isPdfLoading}
            className="gap-1.5 h-8"
            data-testid="button-download-pdf"
          >
            <FileDown className="w-3.5 h-3.5" />
            {isPdfLoading ? 'Hazırlanıyor...' : 'PDF İndir'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEmailDialogOpen(true)} className="gap-1.5 h-8" data-testid="button-generate-email">
            <Mail className="w-3.5 h-3.5" />E-posta Oluştur
          </Button>
          <Button size="sm" variant="outline" onClick={handleDuplicate} disabled={duplicateMutation.isPending} className="gap-1.5 h-8" data-testid="button-duplicate-quotation">
            <Copy className="w-3.5 h-3.5" />Kopyala
          </Button>
          {quotation.convertedOperationId ? (
            <Link href={`/operations/${quotation.convertedOperationId}`}>
              <Button size="sm" variant="outline" className="gap-1.5 h-8" data-testid="button-open-converted-operation">
                <GitBranch className="w-3.5 h-3.5" />OP-{quotation.convertedOperationId} Aç
              </Button>
            </Link>
          ) : (
            <Button size="sm" onClick={handleConvert} disabled={convertMutation.isPending || quotation.status === 'converted'} className="gap-1.5 h-8" data-testid="button-convert-to-operation">
              <GitBranch className="w-3.5 h-3.5" />Operasyona Dönüştür
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Teklif Bilgileri</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Teklif No" value={quotation.number} />
            <Row label="Durum" value={<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${QUOTATION_STATUS_COLORS[quotation.status]}`}>{QUOTATION_STATUS_LABELS[quotation.status]}</span>} />
            {quotation.convertedOperationId && <Row label="Bağlı Operasyon" value={<Link href={`/operations/${quotation.convertedOperationId}`} className="text-primary hover:underline">OP-{quotation.convertedOperationId} Aç</Link>} />}
            <Row label="Son Geçerlilik" value={formatDate(quotation.expiresAt)} />
            <Row label="Para Birimi" value={quotation.currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Fiyatlandırma</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Ara Toplam" value={formatCurrency(quotation.subtotal, quotation.currency)} />
            <Row label="İndirim" value={formatCurrency(quotation.discount, quotation.currency)} />
            <Row label="Toplam Fiyat" value={<span className="font-bold text-primary">{formatCurrency(quotation.finalPrice, quotation.currency)}</span>} />
          </CardContent>
        </Card>

        {quotation.includedServices && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Dahil Hizmetler</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground whitespace-pre-line">{quotation.includedServices}</p></CardContent>
          </Card>
        )}

        {quotation.excludedServices && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Hariç Hizmetler</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground whitespace-pre-line">{quotation.excludedServices}</p></CardContent>
          </Card>
        )}

        {quotation.paymentTerms && (
          <Card>
            <CardHeader><CardTitle className="text-sm">Ödeme Koşulları</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">{quotation.paymentTerms}</p></CardContent>
          </Card>
        )}

        {quotation.cancellationPolicy && (
          <Card>
            <CardHeader><CardTitle className="text-sm">İptal Politikası</CardTitle></CardHeader>
            <CardContent><p className="text-sm text-muted-foreground">{quotation.cancellationPolicy}</p></CardContent>
          </Card>
        )}
      </div>

      {/* Email Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={v => { setEmailDialogOpen(v); if (!v) setGeneratedEmail(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>E-posta Oluştur</DialogTitle></DialogHeader>
          {!generatedEmail ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">E-posta Türü</label>
                <Select value={emailType} onValueChange={setEmailType}>
                  <SelectTrigger data-testid="select-email-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{EMAIL_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Ek Bağlam (opsiyonel)</label>
                <Textarea value={emailContext} onChange={e => setEmailContext(e.target.value)} rows={3} placeholder="Ek bilgi veya özel talepler..." data-testid="textarea-email-context" />
              </div>
              <Button onClick={handleGenerateEmail} disabled={emailMutation.isPending} className="w-full" data-testid="button-generate-email-submit">
                {emailMutation.isPending ? 'Oluşturuluyor...' : 'E-posta Oluştur'}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Konu</label>
                <Input value={generatedEmail.subject} onChange={e => setGeneratedEmail(g => g ? { ...g, subject: e.target.value } : null)} data-testid="input-generated-email-subject" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">İçerik</label>
                <Textarea value={generatedEmail.body} onChange={e => setGeneratedEmail(g => g ? { ...g, body: e.target.value } : null)} rows={10} data-testid="textarea-generated-email-body" />
              </div>
              <Button variant="outline" onClick={() => setGeneratedEmail(null)} className="w-full">Yeniden Oluştur</Button>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setEmailDialogOpen(false)}>Kapat</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

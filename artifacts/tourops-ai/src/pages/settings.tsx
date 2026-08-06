import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient as useTanstackQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useGetAgencySettings, useUpdateAgencySettings, useListExchangeRates, useUpdateExchangeRate, useCreateExchangeRate, useDeleteExchangeRate, useListEmailTemplates, useUpdateEmailTemplate, useCreateEmailTemplate, useGetMyProfile } from '@workspace/api-client-react';
import { getGetAgencySettingsQueryKey, getListExchangeRatesQueryKey, getListEmailTemplatesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Save, Plus, Trash2, Mail, HardDrive, RefreshCw, Unplug, ShieldCheck } from 'lucide-react';
import { useProfile, ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';
import { reservationApi, type GoogleIntegration } from '@/lib/reservation-api';
import { GoogleIntegrationCard } from '@/components/GoogleIntegrationCard';

const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];
const EMAIL_TYPES = ['quotation', 'follow_up', 'confirmation', 'cancellation', 'welcome', 'custom'];
const EMAIL_TYPE_LABELS: Record<string, string> = { quotation: 'Teklif', follow_up: 'Takip', confirmation: 'Onay', cancellation: 'İptal', welcome: 'Hoş Geldiniz', custom: 'Özel' };

export default function SettingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { role } = useProfile();
  /** Only admin can mutate settings; operations can read */
  const isAdmin = role === 'admin';

  const { data: agencySettings, isLoading: agencyLoading } = useGetAgencySettings();
  const { data: exchangeRates, isLoading: ratesLoading } = useListExchangeRates();
  const { data: emailTemplates, isLoading: templatesLoading } = useListEmailTemplates();
  const { data: profile, isLoading: profileLoading } = useGetMyProfile();

  const updateAgencyMutation = useUpdateAgencySettings();
  const updateRateMutation = useUpdateExchangeRate();
  const createRateMutation = useCreateExchangeRate();
  const deleteRateMutation = useDeleteExchangeRate();
  const updateTemplateMutation = useUpdateEmailTemplate();
  const createTemplateMutation = useCreateEmailTemplate();
  const googleConnection = useQuery({ queryKey: ['google-connection'], queryFn: reservationApi.googleStatus, enabled: isAdmin || role === 'super_admin' });
  const connectGoogle = useMutation({
    mutationFn: reservationApi.authorize,
    onSuccess: ({ authorizationUrl }) => { window.location.assign(authorizationUrl); },
    onError: error => toast({ title: 'Google bağlantısı başlatılamadı', description: error.message, variant: 'destructive' }),
  });
  const disconnectGoogle = useMutation({
    mutationFn: reservationApi.disconnect,
    onSuccess: () => { toast({ title: 'Google Workspace bağlantısı kaldırıldı' }); void googleConnection.refetch(); },
    onError: error => toast({ title: 'Bağlantı kaldırılamadı', description: error.message, variant: 'destructive' }),
  });

  const [agencyForm, setAgencyForm] = useState({ name: '', address: '', phone: '', email: '', website: '', defaultCurrency: 'TRY', defaultProfitMargin: 20, minProfitWarning: 10, defaultQuotationValidity: 7, cancellationPolicy: '', paymentTerms: '', cruiseSafetyBufferMinutes: 30 });
  const [editRates, setEditRates] = useState<Record<number, number>>({});
  const [rateDialogOpen, setRateDialogOpen] = useState(false);
  const [newRate, setNewRate] = useState({ fromCurrency: 'EUR', toCurrency: 'TRY', rate: 1 });
  const [selectedTemplate, setSelectedTemplate] = useState<{ id?: number; name: string; type: string; subject: string; body: string } | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [newTemplateDialogOpen, setNewTemplateDialogOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', type: 'quotation', subject: '', body: '', language: 'tr' });
  const [disconnectTarget, setDisconnectTarget] = useState<GoogleIntegration | null>(null);

  useEffect(() => {
    if (agencySettings) {
      setAgencyForm({
        name: agencySettings.name ?? '', address: agencySettings.address ?? '', phone: agencySettings.phone ?? '',
        email: agencySettings.email ?? '', website: agencySettings.website ?? '', defaultCurrency: agencySettings.defaultCurrency ?? 'TRY',
        defaultProfitMargin: agencySettings.defaultProfitMargin ?? 20, minProfitWarning: agencySettings.minProfitWarning ?? 10,
        defaultQuotationValidity: agencySettings.defaultQuotationValidity ?? 7, cancellationPolicy: agencySettings.cancellationPolicy ?? '',
        paymentTerms: agencySettings.paymentTerms ?? '', cruiseSafetyBufferMinutes: agencySettings.cruiseSafetyBufferMinutes ?? 30,
      });
    }
  }, [agencySettings]);

  function handleSaveAgency() {
    updateAgencyMutation.mutate({ data: agencyForm }, {
      onSuccess: () => { toast({ title: 'Ajans bilgileri güncellendi' }); qc.invalidateQueries({ queryKey: getGetAgencySettingsQueryKey() }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleSaveRate(id: number) {
    const rate = editRates[id];
    if (!rate) return;
    updateRateMutation.mutate({ id, data: { rate } }, {
      onSuccess: () => { toast({ title: 'Kur güncellendi' }); qc.invalidateQueries({ queryKey: getListExchangeRatesQueryKey() }); delete editRates[id]; setEditRates({ ...editRates }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleCreateRate() {
    createRateMutation.mutate({ data: { ...newRate, rate: Number(newRate.rate) } }, {
      onSuccess: () => { toast({ title: 'Kur eklendi' }); qc.invalidateQueries({ queryKey: getListExchangeRatesQueryKey() }); setRateDialogOpen(false); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleDeleteRate(id: number) {
    if (!confirm('Bu kuru silmek istiyor musunuz?')) return;
    deleteRateMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: 'Kur silindi' }); qc.invalidateQueries({ queryKey: getListExchangeRatesQueryKey() }); },
      onError: () => toast({ title: 'Hata', description: 'Kur silinemedi', variant: 'destructive' }),
    });
  }

  function handleSaveTemplate() {
    if (!selectedTemplate) return;
    if (selectedTemplate.id) {
      updateTemplateMutation.mutate({ id: selectedTemplate.id, data: selectedTemplate }, {
        onSuccess: () => { toast({ title: 'Şablon güncellendi' }); qc.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey() }); setTemplateDialogOpen(false); },
        onError: () => toast({ title: 'Hata', variant: 'destructive' }),
      });
    }
  }

  function handleCreateTemplate() {
    createTemplateMutation.mutate({ data: newTemplate }, {
      onSuccess: () => { toast({ title: 'Şablon oluşturuldu' }); qc.invalidateQueries({ queryKey: getListEmailTemplatesQueryKey() }); setNewTemplateDialogOpen(false); setNewTemplate({ name: '', type: 'quotation', subject: '', body: '', language: 'tr' }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  const AF = ({ label, field, type = 'text' }: { label: string; field: keyof typeof agencyForm; type?: string }) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <Input type={type} value={(agencyForm as Record<string, unknown>)[field] as string} onChange={e => setAgencyForm(f => ({ ...f, [field]: type === 'number' ? Number(e.target.value) : e.target.value }))} data-testid={`input-agency-${field}`} />
    </div>
  );

  return (
    <AppShell title="Ayarlar">
      <Tabs defaultValue="agency">
        <TabsList className="mb-4">
          <TabsTrigger value="agency" data-testid="tab-agency">Ajans Bilgileri</TabsTrigger>
          <TabsTrigger value="rates" data-testid="tab-rates">Kur Tablosu</TabsTrigger>
          <TabsTrigger value="templates" data-testid="tab-templates">E-posta Şablonları</TabsTrigger>
          <TabsTrigger value="account" data-testid="tab-account">Hesap</TabsTrigger>
          {(isAdmin || role === 'super_admin') && <TabsTrigger value="google" data-testid="tab-google">Google Workspace</TabsTrigger>}
        </TabsList>

        {/* AGENCY */}
        <TabsContent value="agency">
          {agencyLoading ? <Skeleton className="h-96 rounded-xl" /> : (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Ajans Bilgileri</CardTitle>
                {isAdmin && <Button onClick={handleSaveAgency} disabled={updateAgencyMutation.isPending} size="sm" className="gap-1.5" data-testid="button-save-agency"><Save className="w-4 h-4" />{updateAgencyMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button>}
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AF label="Ajans Adı" field="name" />
                <AF label="Telefon" field="phone" />
                <AF label="E-posta" field="email" />
                <AF label="Website" field="website" />
                <div className="md:col-span-2"><AF label="Adres" field="address" /></div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Varsayılan Para Birimi</label>
                  <Select value={agencyForm.defaultCurrency} onValueChange={v => setAgencyForm(f => ({ ...f, defaultCurrency: v }))}>
                    <SelectTrigger data-testid="select-default-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <AF label="Varsayılan Kar Marjı (%)" field="defaultProfitMargin" type="number" />
                <AF label="Min. Kar Uyarı (%)" field="minProfitWarning" type="number" />
                <AF label="Teklif Geçerlilik (gün)" field="defaultQuotationValidity" type="number" />
                <AF label="Kruvaziyer Güvenlik Tamponu (dk)" field="cruiseSafetyBufferMinutes" type="number" />
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">İptal Politikası</label>
                  <Textarea value={agencyForm.cancellationPolicy} onChange={e => setAgencyForm(f => ({ ...f, cancellationPolicy: e.target.value }))} rows={3} data-testid="textarea-agency-cancellationPolicy" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Ödeme Koşulları</label>
                  <Textarea value={agencyForm.paymentTerms} onChange={e => setAgencyForm(f => ({ ...f, paymentTerms: e.target.value }))} rows={3} data-testid="textarea-agency-paymentTerms" />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* EXCHANGE RATES */}
        <TabsContent value="rates">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Döviz Kurları</h3>
            {isAdmin && <Button size="sm" onClick={() => setRateDialogOpen(true)} className="gap-1.5" data-testid="button-add-rate"><Plus className="w-3.5 h-3.5" />Kur Ekle</Button>}
          </div>
          {ratesLoading && <Skeleton className="h-32 rounded-xl mb-3" />}
          <div className="border rounded-lg overflow-hidden bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kaynak</TableHead>
                  <TableHead>Hedef</TableHead>
                  <TableHead>Kur</TableHead>
                  <TableHead className="w-32">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(exchangeRates ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Kur tanımlanmamış</TableCell></TableRow>
                ) : (exchangeRates ?? []).map(rate => (
                  <TableRow key={rate.id} data-testid={`row-rate-${rate.id}`}>
                    <TableCell className="font-mono font-bold">{rate.fromCurrency}</TableCell>
                    <TableCell className="font-mono font-bold">{rate.toCurrency}</TableCell>
                    <TableCell>
                      <Input type="number" step="0.001" className="h-7 w-28 text-sm" value={editRates[rate.id] ?? rate.rate} onChange={e => setEditRates(r => ({ ...r, [rate.id]: parseFloat(e.target.value) }))} data-testid={`input-rate-${rate.id}`} />
                    </TableCell>
                    <TableCell>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleSaveRate(rate.id)} data-testid={`button-save-rate-${rate.id}`}>Kaydet</Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeleteRate(rate.id)} data-testid={`button-delete-rate-${rate.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* EMAIL TEMPLATES */}
        <TabsContent value="templates">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">E-posta Şablonları</h3>
            {isAdmin && <Button size="sm" onClick={() => setNewTemplateDialogOpen(true)} className="gap-1.5" data-testid="button-add-template"><Plus className="w-3.5 h-3.5" />Yeni Şablon</Button>}
          </div>
          {templatesLoading && <Skeleton className="h-32 rounded-xl mb-3" />}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(emailTemplates ?? []).map(t => (
              <Card key={t.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => { setSelectedTemplate({ id: t.id, name: t.name, type: t.type, subject: t.subject, body: t.body }); setTemplateDialogOpen(true); }} data-testid={`card-template-${t.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm">{t.name}</p>
                    <span className="text-xs px-2 py-0.5 rounded bg-accent text-accent-foreground">{EMAIL_TYPE_LABELS[t.type] ?? t.type}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{t.subject}</p>
                </CardContent>
              </Card>
            ))}
            {(emailTemplates ?? []).length === 0 && <div className="md:col-span-2 text-center text-muted-foreground py-12 text-sm">Henüz şablon eklenmemiş</div>}
          </div>
        </TabsContent>

        {/* ACCOUNT */}
        <TabsContent value="account">
          {profileLoading ? <Skeleton className="h-40 rounded-xl max-w-md" /> : (
            <Card className="max-w-md">
              <CardHeader><CardTitle className="text-base">Hesap Bilgileri</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Ad</label><p className="text-sm font-medium">{profile?.name ?? '-'}</p></div>
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">E-posta</label><p className="text-sm font-medium">{profile?.email ?? '-'}</p></div>
                <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Rol</label><span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">{ROLE_LABELS[profile?.role as UserRole] ?? 'Personel'}</span></div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {(isAdmin || role === 'super_admin') && <TabsContent value="google">
          {googleConnection.isLoading ? <Skeleton className="h-72 w-full" /> : (
            <div className="max-w-4xl space-y-4">
              {!googleConnection.data?.configured && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-medium">Google OAuth henüz yapılandırılmamış.</p>
                  <p className="mt-1">Bağlantıları etkinleştirmek için şu sunucu ayarlarını ekleyin: {(googleConnection.data?.missingConfiguration ?? []).join(', ')}.</p>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <GoogleIntegrationCard integration="gmail" title="Gmail Rezervasyon Bağlantısı" description="TourPilot etiketli rezervasyon e-postalarını okumak ve sisteme aktarmak için Gmail hesabınızı bağlayın." icon={<Mail className="h-5 w-5" />} scope="https://www.googleapis.com/auth/gmail.readonly" connection={googleConnection.data?.connection ?? null} configured={googleConnection.data?.configured ?? false} pending={connectGoogle.isPending || disconnectGoogle.isPending} onConnect={() => connectGoogle.mutate('gmail')} onDisconnect={() => setDisconnectTarget('gmail')} />
                <GoogleIntegrationCard integration="drive" title="Google Drive Bağlantısı" description="Rezervasyon dosyalarına ve TourPilot tarafından oluşturulan veya seçtiğiniz Drive dosyalarına erişmek için hesabınızı bağlayın." icon={<HardDrive className="h-5 w-5" />} scope="https://www.googleapis.com/auth/drive.file" connection={googleConnection.data?.connection ?? null} configured={googleConnection.data?.configured ?? false} pending={connectGoogle.isPending || disconnectGoogle.isPending} onConnect={() => connectGoogle.mutate('drive')} onDisconnect={() => setDisconnectTarget('drive')} />
              </div>
            </div>
          )}
        </TabsContent>}
      </Tabs>

      <Dialog open={!!disconnectTarget} onOpenChange={open => { if (!open) setDisconnectTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{disconnectTarget === 'gmail' ? 'Gmail bağlantısı kesilsin mi?' : 'Google Drive bağlantısı kesilsin mi?'}</DialogTitle>
            <DialogDescription>
              Bu işlem mevcut içe aktarılmış e-postaları, oluşturulmuş operasyonları veya önceki Drive kayıtlarını silmez.
              {googleConnection.data?.connection?.grantedScopes?.filter(scope => scope === 'https://www.googleapis.com/auth/gmail.readonly' || scope === 'https://www.googleapis.com/auth/drive.file').length === 1 && ' Son Google izni kaldırıldığı için Google erişim belirteci de iptal edilir.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisconnectTarget(null)}>Vazgeç</Button>
            <Button variant="destructive" disabled={disconnectGoogle.isPending} onClick={() => { if (disconnectTarget) disconnectGoogle.mutate(disconnectTarget, { onSuccess: () => setDisconnectTarget(null) }); }}>
              {disconnectGoogle.isPending ? 'Kesiliyor...' : 'Bağlantıyı Kes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rate Dialog */}
      <Dialog open={rateDialogOpen} onOpenChange={setRateDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Yeni Kur Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Kaynak Para Birimi</label>
              <Select value={newRate.fromCurrency} onValueChange={v => setNewRate(r => ({ ...r, fromCurrency: v }))}>
                <SelectTrigger data-testid="select-rate-from"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Hedef Para Birimi</label>
              <Select value={newRate.toCurrency} onValueChange={v => setNewRate(r => ({ ...r, toCurrency: v }))}>
                <SelectTrigger data-testid="select-rate-to"><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Kur</label><Input type="number" step="0.001" value={newRate.rate} onChange={e => setNewRate(r => ({ ...r, rate: parseFloat(e.target.value) }))} data-testid="input-new-rate" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateRate} disabled={createRateMutation.isPending} data-testid="button-save-new-rate">{createRateMutation.isPending ? 'Ekleniyor...' : 'Ekle'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Template Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={v => { setTemplateDialogOpen(v); if (!v) setSelectedTemplate(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Şablon Düzenle</DialogTitle></DialogHeader>
          {selectedTemplate && (
            <div className="space-y-3">
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Ad</label><Input value={selectedTemplate.name} onChange={e => setSelectedTemplate(t => t ? { ...t, name: e.target.value } : null)} data-testid="input-template-name" /></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Konu</label><Input value={selectedTemplate.subject} onChange={e => setSelectedTemplate(t => t ? { ...t, subject: e.target.value } : null)} data-testid="input-template-subject" /></div>
              <div><label className="text-xs font-medium text-muted-foreground mb-1 block">İçerik</label><Textarea value={selectedTemplate.body} onChange={e => setSelectedTemplate(t => t ? { ...t, body: e.target.value } : null)} rows={8} data-testid="textarea-template-body" /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>İptal</Button>
            <Button onClick={handleSaveTemplate} disabled={updateTemplateMutation.isPending} data-testid="button-save-template">{updateTemplateMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Template Dialog */}
      <Dialog open={newTemplateDialogOpen} onOpenChange={setNewTemplateDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Yeni Şablon</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Ad *</label><Input value={newTemplate.name} onChange={e => setNewTemplate(t => ({ ...t, name: e.target.value }))} data-testid="input-new-template-name" /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tür</label>
              <Select value={newTemplate.type} onValueChange={v => setNewTemplate(t => ({ ...t, type: v }))}>
                <SelectTrigger data-testid="select-new-template-type"><SelectValue /></SelectTrigger>
                <SelectContent>{EMAIL_TYPES.map(t => <SelectItem key={t} value={t}>{EMAIL_TYPE_LABELS[t] ?? t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Konu</label><Input value={newTemplate.subject} onChange={e => setNewTemplate(t => ({ ...t, subject: e.target.value }))} data-testid="input-new-template-subject" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">İçerik</label><Textarea value={newTemplate.body} onChange={e => setNewTemplate(t => ({ ...t, body: e.target.value }))} rows={6} data-testid="textarea-new-template-body" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTemplateDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateTemplate} disabled={createTemplateMutation.isPending} data-testid="button-save-new-template">{createTemplateMutation.isPending ? 'Oluşturuluyor...' : 'Oluştur'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

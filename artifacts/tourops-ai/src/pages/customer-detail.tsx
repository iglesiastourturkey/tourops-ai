import { useState, useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGetCustomer, useUpdateCustomer } from '@workspace/api-client-react';
import { getGetCustomerQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save } from 'lucide-react';
import { CUSTOMER_TYPE_LABELS, PASSPORT_STATUS_LABELS } from '@/lib/labels';

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: customer, isLoading } = useGetCustomer(id, { query: { enabled: !!id, queryKey: getGetCustomerQueryKey(id) } });
  const updateMutation = useUpdateCustomer();

  const [form, setForm] = useState({ name: '', company: '', nationality: '', language: '', phone: '', email: '', whatsapp: '', customerType: 'individual', travelPreferences: '', dietaryRestrictions: '', accessibilityRequirements: '', passportStatus: 'not_requested', notes: '' });

  useEffect(() => {
    if (customer) setForm({ name: customer.name ?? '', company: customer.company ?? '', nationality: customer.nationality ?? '', language: customer.language ?? '', phone: customer.phone ?? '', email: customer.email ?? '', whatsapp: customer.whatsapp ?? '', customerType: customer.customerType ?? 'individual', travelPreferences: customer.travelPreferences ?? '', dietaryRestrictions: customer.dietaryRestrictions ?? '', accessibilityRequirements: customer.accessibilityRequirements ?? '', passportStatus: customer.passportStatus ?? 'not_requested', notes: customer.notes ?? '' });
  }, [customer]);

  function handleSave() {
    if (!form.name.trim()) { toast({ title: 'Ad zorunludur', variant: 'destructive' }); return; }
    updateMutation.mutate({ id, data: form }, {
      onSuccess: () => { toast({ title: 'Müşteri güncellendi' }); qc.invalidateQueries({ queryKey: getGetCustomerQueryKey(id) }); },
      onError: () => toast({ title: 'Hata', description: 'Müşteri güncellenemedi', variant: 'destructive' }),
    });
  }

  const F = ({ label, field, placeholder = '' }: { label: string; field: keyof typeof form; placeholder?: string }) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <Input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} placeholder={placeholder} data-testid={`input-customer-${field}`} />
    </div>
  );

  if (isLoading) {
    return <AppShell title="Müşteri Detayı"><Skeleton className="h-96 rounded-xl" /></AppShell>;
  }

  if (!customer) {
    return (
      <AppShell title="Müşteri Bulunamadı">
        <div className="mb-4"><Link href="/customers"><Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="w-4 h-4" />Müşteriler</Button></Link></div>
        <p className="text-muted-foreground">Müşteri bulunamadı veya erişim izniniz yok.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={customer.name}>
      <div className="mb-4">
        <Link href="/customers"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-customers"><ArrowLeft className="w-4 h-4" />Müşteriler</Button></Link>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Müşteri Bilgileri</CardTitle>
          <Button onClick={handleSave} disabled={updateMutation.isPending} size="sm" className="gap-1.5" data-testid="button-save-customer">
            <Save className="w-4 h-4" />{updateMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <F label="Ad Soyad *" field="name" placeholder="Ad Soyad" />
          <F label="Şirket" field="company" placeholder="Şirket adı" />
          <F label="Uyruk" field="nationality" placeholder="Uyruk" />
          <F label="Dil" field="language" placeholder="Konuşulan dil" />
          <F label="Telefon" field="phone" placeholder="+90..." />
          <F label="E-posta" field="email" placeholder="ornek@mail.com" />
          <F label="WhatsApp" field="whatsapp" placeholder="+90..." />
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Müşteri Tipi</label>
            <Select value={form.customerType} onValueChange={v => setForm(f => ({ ...f, customerType: v }))}>
              <SelectTrigger data-testid="select-detail-customer-type"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Pasaport Durumu</label>
            <Select value={form.passportStatus} onValueChange={v => setForm(f => ({ ...f, passportStatus: v }))}>
              <SelectTrigger data-testid="select-passport-status"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PASSPORT_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <F label="Seyahat Tercihleri" field="travelPreferences" placeholder="Seyahat tercihleri..." />
          <F label="Diyet Kısıtlamaları" field="dietaryRestrictions" placeholder="Diyet kısıtlamaları..." />
          <F label="Engel Durumu" field="accessibilityRequirements" placeholder="Erişilebilirlik gereksinimleri..." />
          <div className="md:col-span-2"><F label="Notlar" field="notes" placeholder="Ek notlar..." /></div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

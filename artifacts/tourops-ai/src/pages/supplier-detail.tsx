import { useState, useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useGetSupplier, useUpdateSupplier } from '@workspace/api-client-react';
import { getGetSupplierQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save } from 'lucide-react';
import { SUPPLIER_CATEGORY_LABELS } from '@/lib/labels';

export default function SupplierDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0');
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: supplier, isLoading } = useGetSupplier(id, { query: { enabled: !!id, queryKey: getGetSupplierQueryKey(id) } });
  const updateMutation = useUpdateSupplier();
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', email: '', website: '', address: '', city: '', category: 'hotel', currency: 'TRY', notes: '', taxNumber: '', bankDetails: '' });

  useEffect(() => {
    if (supplier) setForm({ name: supplier.name ?? '', contactPerson: supplier.contactPerson ?? '', phone: supplier.phone ?? '', email: supplier.email ?? '', website: supplier.website ?? '', address: supplier.address ?? '', city: supplier.city ?? '', category: supplier.category ?? 'hotel', currency: supplier.currency ?? 'TRY', notes: supplier.notes ?? '', taxNumber: supplier.taxNumber ?? '', bankDetails: supplier.bankDetails ?? '' });
  }, [supplier]);

  function handleSave() {
    updateMutation.mutate({ id, data: form }, {
      onSuccess: () => { toast({ title: 'Tedarikçi güncellendi' }); qc.invalidateQueries({ queryKey: getGetSupplierQueryKey(id) }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  const F = ({ label, field, placeholder = '' }: { label: string; field: keyof typeof form; placeholder?: string }) => (
    <div><label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label><Input value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))} placeholder={placeholder} data-testid={`input-supplier-${field}`} /></div>
  );

  return (
    <AppShell title={supplier?.name ?? 'Tedarikçi Detayı'}>
      <div className="mb-4"><Link href="/suppliers"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-suppliers"><ArrowLeft className="w-4 h-4" />Tedarikçiler</Button></Link></div>
      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Tedarikçi Bilgileri</CardTitle>
            <Button onClick={handleSave} disabled={updateMutation.isPending} size="sm" className="gap-1.5" data-testid="button-save-supplier"><Save className="w-4 h-4" />{updateMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <F label="Ad *" field="name" placeholder="Tedarikçi adı" />
            <F label="İletişim Kişisi" field="contactPerson" placeholder="Ad Soyad" />
            <F label="Telefon" field="phone" placeholder="+90..." />
            <F label="E-posta" field="email" placeholder="ornek@mail.com" />
            <F label="Website" field="website" placeholder="https://" />
            <F label="Şehir" field="city" placeholder="Şehir" />
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Kategori</label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-supplier-detail-category"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SUPPLIER_CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Para Birimi</label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{['TRY','EUR','USD','GBP'].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <F label="Vergi No" field="taxNumber" placeholder="Vergi numarası" />
            <F label="Adres" field="address" placeholder="Adres" />
            <div className="md:col-span-2"><F label="Banka Bilgileri" field="bankDetails" placeholder="IBAN vb." /></div>
            <div className="md:col-span-2"><F label="Notlar" field="notes" placeholder="Notlar..." /></div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

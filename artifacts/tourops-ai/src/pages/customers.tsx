import { useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useListCustomers, useCreateCustomer, useDeleteCustomer } from '@workspace/api-client-react';
import { getListCustomersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Trash2, ExternalLink } from 'lucide-react';
import { CUSTOMER_TYPE_LABELS, PASSPORT_STATUS_LABELS, PASSPORT_STATUS_COLORS } from '@/lib/labels';

export default function CustomersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', nationality: '', language: '', phone: '', email: '', whatsapp: '', customerType: 'individual', notes: '' });

  const { data: customers, isLoading } = useListCustomers();
  const createMutation = useCreateCustomer();
  const deleteMutation = useDeleteCustomer();

  const filtered = (customers ?? []).filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase()) || false;
    const matchType = typeFilter === 'all' || c.customerType === typeFilter;
    return matchSearch && matchType;
  });

  function handleCreate() {
    if (!form.name.trim()) { toast({ title: 'Ad zorunludur', variant: 'destructive' }); return; }
    createMutation.mutate({ data: form }, {
      onSuccess: () => {
        toast({ title: 'Müşteri oluşturuldu' });
        qc.invalidateQueries({ queryKey: getListCustomersQueryKey() });
        setDialogOpen(false);
        setForm({ name: '', company: '', nationality: '', language: '', phone: '', email: '', whatsapp: '', customerType: 'individual', notes: '' });
      },
      onError: () => toast({ title: 'Hata', description: 'Müşteri oluşturulamadı', variant: 'destructive' }),
    });
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" müşterisini silmek istediğinize emin misiniz?`)) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: 'Müşteri silindi' }); qc.invalidateQueries({ queryKey: getListCustomersQueryKey() }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  return (
    <AppShell title="Müşteriler">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Ad, e-posta ara..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-customers" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48" data-testid="select-customer-type-filter"><SelectValue placeholder="Tüm Tipler" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Tipler</SelectItem>
            {Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setDialogOpen(true)} className="gap-2" data-testid="button-new-customer">
          <Plus className="w-4 h-4" /> Yeni Müşteri
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad Soyad</TableHead>
              <TableHead className="hidden md:table-cell">Şirket</TableHead>
              <TableHead className="hidden lg:table-cell">Telefon</TableHead>
              <TableHead>Müşteri Tipi</TableHead>
              <TableHead className="hidden md:table-cell">Pasaport</TableHead>
              <TableHead className="w-20">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-10">Müşteri bulunamadı</TableCell></TableRow>
            ) : filtered.map(c => (
              <TableRow key={c.id} data-testid={`row-customer-${c.id}`}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{c.company ?? '-'}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">{c.phone ?? '-'}</TableCell>
                <TableCell>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-medium">
                    {CUSTOMER_TYPE_LABELS[c.customerType] ?? c.customerType}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PASSPORT_STATUS_COLORS[c.passportStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                    {PASSPORT_STATUS_LABELS[c.passportStatus] ?? c.passportStatus}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link href={`/customers/${c.id}`}>
                      <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-view-customer-${c.id}`}><ExternalLink className="w-3.5 h-3.5" /></Button>
                    </Link>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(c.id, c.name)} data-testid={`button-delete-customer-${c.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Yeni Müşteri</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Ad Soyad *</label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-customer-name" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Şirket</label><Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Şirket adı" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Uyruk</label><Input value={form.nationality} onChange={e => setForm(f => ({ ...f, nationality: e.target.value }))} placeholder="Uyruk" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Telefon</label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+90..." /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">E-posta</label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="ornek@mail.com" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">WhatsApp</label><Input value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} placeholder="+90..." /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Müşteri Tipi</label>
              <Select value={form.customerType} onValueChange={v => setForm(f => ({ ...f, customerType: v }))}>
                <SelectTrigger data-testid="select-customer-type"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CUSTOMER_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Notlar</label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Ek notlar..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-customer">
              {createMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

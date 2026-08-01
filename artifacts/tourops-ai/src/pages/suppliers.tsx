import { useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useListSuppliers, useCreateSupplier, useDeleteSupplier } from '@workspace/api-client-react';
import { getListSuppliersQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Trash2, ExternalLink, Star } from 'lucide-react';
import { SUPPLIER_CATEGORY_LABELS } from '@/lib/labels';

const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];

export default function SuppliersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', email: '', city: '', category: 'hotel', currency: 'TRY', notes: '' });

  const { data: suppliers, isLoading } = useListSuppliers();
  const createMutation = useCreateSupplier();
  const deleteMutation = useDeleteSupplier();

  const filtered = (suppliers ?? []).filter(s => {
    const ms = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.city?.toLowerCase().includes(search.toLowerCase());
    const mc = catFilter === 'all' || s.category === catFilter;
    return ms && mc;
  });

  function handleCreate() {
    if (!form.name.trim()) { toast({ title: 'Ad zorunludur', variant: 'destructive' }); return; }
    createMutation.mutate({ data: form }, {
      onSuccess: () => { toast({ title: 'Tedarikçi oluşturuldu' }); qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); setDialogOpen(false); setForm({ name: '', contactPerson: '', phone: '', email: '', city: '', category: 'hotel', currency: 'TRY', notes: '' }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  function handleDelete(id: number, name: string) {
    if (!confirm(`"${name}" tedarikçisini silmek istiyor musunuz?`)) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: 'Tedarikçi silindi' }); qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); },
      onError: () => toast({ title: 'Hata', variant: 'destructive' }),
    });
  }

  return (
    <AppShell title="Tedarikçiler">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Ad, şehir ara..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-suppliers" />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44" data-testid="select-category-filter"><SelectValue placeholder="Tüm Kategoriler" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Kategoriler</SelectItem>
            {Object.entries(SUPPLIER_CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setDialogOpen(true)} className="gap-2" data-testid="button-new-supplier"><Plus className="w-4 h-4" />Yeni Tedarikçi</Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead className="hidden md:table-cell">Şehir</TableHead>
              <TableHead>Kategori</TableHead>
              <TableHead className="hidden lg:table-cell">Para Birimi</TableHead>
              <TableHead className="hidden lg:table-cell">Puan</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="w-20">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Tedarikçi bulunamadı</TableCell></TableRow>
            ) : filtered.map(s => (
              <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{s.city ?? '-'}</TableCell>
                <TableCell><span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-medium">{SUPPLIER_CATEGORY_LABELS[s.category] ?? s.category}</span></TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">{s.currency}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {s.rating != null ? (
                    <div className="flex items-center gap-1"><Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" /><span className="text-sm">{s.rating}</span></div>
                  ) : <span className="text-muted-foreground text-sm">-</span>}
                </TableCell>
                <TableCell><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.isActive ? 'Aktif' : 'Pasif'}</span></TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Link href={`/suppliers/${s.id}`}><Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-view-supplier-${s.id}`}><ExternalLink className="w-3.5 h-3.5" /></Button></Link>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(s.id, s.name)} data-testid={`button-delete-supplier-${s.id}`}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Yeni Tedarikçi</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Ad *</label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Tedarikçi adı" data-testid="input-supplier-name" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">İletişim Kişisi</label><Input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder="Ad Soyad" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Telefon</label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+90..." /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">E-posta</label><Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="ornek@mail.com" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Şehir</label><Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Şehir" /></div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Kategori</label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="select-supplier-category"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SUPPLIER_CATEGORY_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Para Birimi</label>
              <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><label className="text-xs font-medium text-muted-foreground mb-1 block">Notlar</label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notlar..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-supplier">{createMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

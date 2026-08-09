import { useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useListSuppliers, useCreateSupplier, useDeleteSupplier, useUpdateSupplier, useListProfiles } from '@workspace/api-client-react';
import { getListSuppliersQueryKey, getListProfilesQueryKey } from '@workspace/api-client-react';
import { usePermission } from '@/hooks/usePermission';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, MoreHorizontal, ExternalLink, Archive, Trash2, Star, Car, Info, Users, UserCog } from 'lucide-react';
import { SUPPLIER_CATEGORY_LABELS } from '@/lib/labels';

const CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP'];

/**
 * Drivers have no dedicated entity — they are suppliers tagged category='driver',
 * the same way freelance guides are modeled. The Şoförler tab is a focused view
 * over the very same CRUD endpoints, not a separate resource.
 */
const DRIVER_CATEGORY = 'driver';
const EMPTY_DRIVER_FORM = { name: '', phone: '', vehiclePlate: '', vehicleInfo: '' };

export default function SuppliersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [form, setForm] = useState({ name: '', contactPerson: '', phone: '', email: '', city: '', category: 'hotel', currency: 'TRY', notes: '' });
  const [tab, setTab] = useState('all');
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [driverForm, setDriverForm] = useState(EMPTY_DRIVER_FORM);

  const { data: suppliers, isLoading } = useListSuppliers();
  const createMutation = useCreateSupplier();
  const deleteMutation = useDeleteSupplier();
  const archiveMutation = useUpdateSupplier();

  const filtered = (suppliers ?? []).filter(s => {
    const isArchived = !!s.archivedAt;
    if (!showArchived && isArchived) return false;
    if (showArchived && !isArchived) return false;
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

  // Active (non-archived) drivers, newest first — the list order the API already returns.
  const drivers = (suppliers ?? []).filter(s => s.category === DRIVER_CATEGORY && !s.archivedAt);

  // ── Guides ────────────────────────────────────────────────────────────────
  // Guides are user accounts, not suppliers, so this tab is a read-only view.
  // Creating/inviting/editing a user is gated on users.manage, which the seed
  // matrix grants to no role — only super_admin passes it. Rendering those
  // actions here would show buttons that 403 for every role that can actually
  // reach this page, so management stays on /users and is linked, not copied.
  const canManageUsers = usePermission('users', 'manage');
  const guidesQuery = useListProfiles(
    { role: 'guide' },
    { query: { enabled: tab === 'guides', queryKey: getListProfilesQueryKey({ role: 'guide' }) } },
  );
  const guides = guidesQuery.data ?? [];

  function handleCreateDriver() {
    const name = driverForm.name.trim();
    if (!name) { toast({ title: 'Ad Soyad zorunludur', variant: 'destructive' }); return; }
    if (createMutation.isPending) return;
    createMutation.mutate({
      data: {
        name,
        // contactPerson mirrors the name so the operation assignment dialog,
        // which reads `contactPerson || name`, shows the driver either way.
        contactPerson: name,
        phone:         driverForm.phone.trim(),
        vehiclePlate:  driverForm.vehiclePlate.trim().toUpperCase(),
        vehicleInfo:   driverForm.vehicleInfo.trim(),
        category:      DRIVER_CATEGORY,
        currency:      'TRY',
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Şoför eklendi' });
        qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() });
        setDriverDialogOpen(false);
        setDriverForm(EMPTY_DRIVER_FORM);
      },
      onError: () => toast({ title: 'Hata', description: 'Şoför eklenemedi', variant: 'destructive' }),
    });
  }

  function handleArchive(id: number, name: string) {
    archiveMutation.mutate({ id, data: { archivedAt: new Date().toISOString() } }, {
      onSuccess: () => { toast({ title: `"${name}" arşivlendi` }); qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); },
      onError: () => toast({ title: 'Arşivleme başarısız', variant: 'destructive' }),
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: `"${name}" silindi` }); qc.invalidateQueries({ queryKey: getListSuppliersQueryKey() }); setDeleteTarget(null); },
      onError: () => { setDeleteTarget(null); toast({ title: 'Silme başarısız', variant: 'destructive' }); },
    });
  }

  return (
    <AppShell title="Tedarikçiler">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="all" data-testid="tab-suppliers-all">Tümü</TabsTrigger>
          <TabsTrigger value="drivers" className="gap-1.5" data-testid="tab-suppliers-drivers">
            <Car className="w-3.5 h-3.5" />Şoförler
          </TabsTrigger>
          <TabsTrigger value="guides" className="gap-1.5" data-testid="tab-suppliers-guides">
            <UserCog className="w-3.5 h-3.5" />Rehberler
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
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
        <Button
          variant={showArchived ? 'secondary' : 'outline'}
          onClick={() => setShowArchived(s => !s)}
          className="gap-2"
          data-testid="button-toggle-archived-suppliers"
        >
          <Archive className="w-4 h-4" />{showArchived ? 'Aktif Tedarikçiler' : 'Arşivlenenler'}
        </Button>
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
              <TableHead className="w-12">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                {showArchived ? 'Arşivlenmiş tedarikçi bulunamadı' : 'Tedarikçi bulunamadı'}
              </TableCell></TableRow>
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
                <TableCell>
                  {s.archivedAt ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">Arşiv</span>
                  ) : (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.isActive ? 'Aktif' : 'Pasif'}</span>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-menu-supplier-${s.id}`}>
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/suppliers/${s.id}`} className="flex items-center gap-2 cursor-pointer">
                          <ExternalLink className="w-3.5 h-3.5" />Görüntüle / Düzenle
                        </Link>
                      </DropdownMenuItem>
                      {!s.archivedAt && (
                        <DropdownMenuItem className="gap-2" onClick={() => handleArchive(s.id, s.name)}>
                          <Archive className="w-3.5 h-3.5" />Arşivle
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2 text-destructive focus:text-destructive"
                        onClick={() => setDeleteTarget({ id: s.id, name: s.name })}
                        data-testid={`button-delete-supplier-${s.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />Sil
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
        </TabsContent>

        {/* ── Drivers tab ─────────────────────────────────────────────────── */}
        <TabsContent value="drivers">
          {/* Guides are user accounts, not suppliers — point people to the right
              page before they try to add one here. */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 mb-4">
            <p className="text-sm text-blue-900 flex items-start gap-2 flex-1 min-w-0">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Burası yalnızca <strong>şoförler</strong> içindir. Rehberler sistemde kullanıcı hesabı
                olarak tutulur — rehber eklemek için Kullanıcılar sayfasını kullanın.
              </span>
            </p>
            <Button asChild variant="outline" size="sm" className="gap-1.5 shrink-0 bg-white">
              <Link href="/users" data-testid="link-users-from-drivers">
                <Users className="w-3.5 h-3.5" />Kullanıcılar
              </Link>
            </Button>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Kayıtlı Şoförler</h3>
            <Button onClick={() => setDriverDialogOpen(true)} size="sm" className="gap-1.5" data-testid="button-new-driver">
              <Plus className="w-3.5 h-3.5" />Şoför Ekle
            </Button>
          </div>

          <div className="border rounded-lg overflow-x-auto bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad Soyad</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Plaka</TableHead>
                  <TableHead className="hidden md:table-cell">Araç</TableHead>
                  <TableHead className="w-12">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                )) : drivers.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    Henüz şoför eklenmemiş
                  </TableCell></TableRow>
                ) : drivers.map(d => (
                  <TableRow key={d.id} data-testid={`row-driver-${d.id}`}>
                    <TableCell className="font-medium">{d.contactPerson || d.name}</TableCell>
                    <TableCell className="text-muted-foreground">{d.phone || '-'}</TableCell>
                    <TableCell className="font-mono text-sm">{d.vehiclePlate || '-'}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{d.vehicleInfo || '-'}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`button-menu-driver-${d.id}`}>
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/suppliers/${d.id}`} className="flex items-center gap-2 cursor-pointer">
                              <ExternalLink className="w-3.5 h-3.5" />Görüntüle / Düzenle
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2" onClick={() => handleArchive(d.id, d.contactPerson || d.name)}>
                            <Archive className="w-3.5 h-3.5" />Arşivle
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="gap-2 text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ id: d.id, name: d.contactPerson || d.name })}
                            data-testid={`button-delete-driver-${d.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />Sil
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Guides tab (read-only) ──────────────────────────────────────── */}
        <TabsContent value="guides">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 mb-4">
            <p className="text-sm text-blue-900 flex items-start gap-2 flex-1 min-w-0">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Rehberler tedarikçi değil, <strong>kullanıcı hesabıdır</strong>. Buradaki liste yalnızca
                görüntülemek içindir; rehber davet etme, rol ve aktiflik değişiklikleri Kullanıcılar
                sayfasından yapılır.
              </span>
            </p>
            {canManageUsers && (
              <Button asChild variant="outline" size="sm" className="gap-1.5 shrink-0 bg-white">
                <Link href="/users" data-testid="link-users-from-guides">
                  <Users className="w-3.5 h-3.5" />Kullanıcılar'da Yönet
                </Link>
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm">Kayıtlı Rehberler</h3>
            {guides.length > 0 && (
              <span className="text-xs text-muted-foreground">{guides.length} rehber</span>
            )}
          </div>

          {guidesQuery.isError ? (
            // Listing guides needs profile read access (admin, operations,
            // super_admin); accounting can open this page but not this list.
            // Anything else is a fault, not a permission boundary — saying
            // "you are not authorised" for a network blip would be a lie.
            <div className="border rounded-lg bg-card px-4 py-10 text-center text-sm text-muted-foreground">
              {(guidesQuery.error as { status?: number } | null)?.status === 403
                ? 'Rehber listesini görüntüleme yetkiniz bulunmuyor.'
                : 'Rehber listesi yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.'}
            </div>
          ) : (
            <div className="border rounded-lg overflow-x-auto bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad Soyad</TableHead>
                    <TableHead>E-posta</TableHead>
                    <TableHead className="w-28">Durum</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {guidesQuery.isLoading ? Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
                  )) : guides.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-10">
                      Henüz rehber hesabı yok
                    </TableCell></TableRow>
                  ) : guides.map(g => (
                    <TableRow key={g.id} data-testid={`row-guide-${g.id}`}>
                      <TableCell className="font-medium">{g.name || '-'}</TableCell>
                      <TableCell className="text-muted-foreground break-all">{g.email}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${g.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {g.isActive ? 'Aktif' : 'Pasif'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Create driver dialog ───────────────────────────────────────────── */}
      <Dialog open={driverDialogOpen} onOpenChange={open => { setDriverDialogOpen(open); if (!open) setDriverForm(EMPTY_DRIVER_FORM); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Yeni Şoför</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Ad Soyad *</label>
              <Input value={driverForm.name} onChange={e => setDriverForm(f => ({ ...f, name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-driver-supplier-name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Telefon</label>
              <Input value={driverForm.phone} onChange={e => setDriverForm(f => ({ ...f, phone: e.target.value }))} placeholder="+90 5xx..." data-testid="input-driver-supplier-phone" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Plaka</label>
              <Input value={driverForm.vehiclePlate} onChange={e => setDriverForm(f => ({ ...f, vehiclePlate: e.target.value }))} placeholder="35 AA 000" className="font-mono" data-testid="input-driver-supplier-plate" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Araç Bilgisi</label>
              <Input value={driverForm.vehicleInfo} onChange={e => setDriverForm(f => ({ ...f, vehicleInfo: e.target.value }))} placeholder="Mercedes Sprinter · 16 kişilik" data-testid="input-driver-supplier-vehicle" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDriverDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreateDriver} disabled={createMutation.isPending} data-testid="button-create-driver">
              {createMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create dialog ──────────────────────────────────────────────────── */}
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

      {/* ── Delete confirm dialog ──────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tedarikçiyi sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
              data-testid="button-confirm-delete-supplier"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

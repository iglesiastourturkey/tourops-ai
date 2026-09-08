/**
 * Personnel Management (Phase 2D.2) — admin/operations-facing UI over the
 * canonical Resource/Guide-Driver identity foundation introduced in Phase
 * 2D.1 (see docs/architecture/phase2d1-personnel-identity-foundation.md).
 *
 * "Personel" (real-world personnel identity — this page) is deliberately
 * kept separate from "Kullanıcı Yönetimi" (/users, TourPilot login/access
 * accounts). A Resource here does not require, and does not create, a
 * login — see ACCOUNT LINK on the detail page for the one explicit,
 * optional bridge between the two (linkedProfileId), which this page never
 * sets on create.
 *
 * Search/type/active filtering is server-side (GET /resources?type=&active=&q=),
 * matching what personnelListRead (artifacts/api-server/src/lib/personnel-read.ts)
 * already supports — no client-side filtering re-implemented here.
 *
 * Identity-matching visibility (EXACT_MATCH / ALIAS_MATCH / AMBIGUOUS /
 * UNMATCHED, see lib/personnel-identity.ts) is intentionally NOT surfaced
 * anywhere in this phase: the list/detail read models never return a
 * matching verdict, and none is fabricated here. The full review/matching
 * workflow (e.g. for a future Excel/performance-workbook import) is
 * deferred to Phase 2C.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useListResources, useCreateResource, getListResourcesQueryKey, type ResourceListItem } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { usePermission } from '@/hooks/usePermission';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, IdCard } from 'lucide-react';
import { RESOURCE_TYPE_LABELS } from '@/lib/labels';

type TypeFilter = 'all' | 'GUIDE' | 'DRIVER';
type ActiveFilter = 'all' | 'active' | 'inactive';

const EMPTY_FORM = { type: 'GUIDE' as 'GUIDE' | 'DRIVER', name: '', phone: '', email: '', languages: '', company: '', licenseNumber: '', notes: '' };

function StatusChip({ active }: { active: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {active ? 'Aktif' : 'Pasif'}
    </span>
  );
}

function LinkedChip({ hasLinkedLogin }: { hasLinkedLogin: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hasLinkedLogin ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
      {hasLinkedLogin ? 'Bağlı' : 'Bağlı Değil'}
    </span>
  );
}

export default function PersonnelPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canCreate = usePermission('personnel', 'create');

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const params = {
    ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
    ...(activeFilter !== 'all' ? { active: activeFilter === 'active' } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  };
  const { data: personnel, isLoading, isError, refetch } = useListResources(params, {
    query: { queryKey: getListResourcesQueryKey(params) },
  });

  const createMutation = useCreateResource();

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function handleCreate() {
    const name = form.name.trim();
    if (!name) { toast({ title: 'Ad Soyad zorunludur', variant: 'destructive' }); return; }
    createMutation.mutate({
      data: {
        type: form.type,
        name,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        languages: form.languages.trim() || undefined,
        company: form.company.trim() || undefined,
        licenseNumber: form.licenseNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Personel oluşturuldu' });
        qc.invalidateQueries({ queryKey: ['/api/resources'] });
        setDialogOpen(false);
        resetForm();
      },
      onError: (err) => {
        // Backend validation errors (400 { error, issues? }) are surfaced
        // directly rather than a generic message — see resources.ts.
        const data = (err as { data?: unknown } | null)?.data;
        const detail = data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>)['error'])
          : undefined;
        toast({ title: 'Personel oluşturulamadı', description: detail, variant: 'destructive' });
      },
    });
  }

  const rows: ResourceListItem[] = personnel ?? [];
  const noResultsFromFilter = !isLoading && !isError && rows.length === 0 && (search.trim() !== '' || typeFilter !== 'all' || activeFilter !== 'all');
  const trulyEmpty = !isLoading && !isError && rows.length === 0 && search.trim() === '' && typeFilter === 'all' && activeFilter === 'all';

  return (
    <AppShell title="Personel">
      <p className="text-xs text-muted-foreground mb-4">
        Rehber ve şoförlerin kanonik kimlik kayıtları. Bu sayfa TourPilot giriş hesaplarından
        (<Link href="/users" className="underline">Kullanıcı Yönetimi</Link>) ayrıdır — bir personel
        kaydının giriş hesabı olması gerekmez.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Ad, telefon, e-posta, şirket ara..."
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-personnel"
          />
        </div>
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as TypeFilter)}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-personnel-type-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Türler</SelectItem>
            <SelectItem value="GUIDE">{RESOURCE_TYPE_LABELS['GUIDE']}</SelectItem>
            <SelectItem value="DRIVER">{RESOURCE_TYPE_LABELS['DRIVER']}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activeFilter} onValueChange={v => setActiveFilter(v as ActiveFilter)}>
          <SelectTrigger className="w-full sm:w-40" data-testid="select-personnel-active-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="inactive">Pasif</SelectItem>
          </SelectContent>
        </Select>
        {canCreate && (
          <Button onClick={() => setDialogOpen(true)} className="gap-2" data-testid="button-new-personnel">
            <Plus className="w-4 h-4" />Yeni Personel
          </Button>
        )}
      </div>

      {/* Desktop / tablet: table with progressively-hidden columns. */}
      <div className="hidden sm:block border rounded-lg overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ad</TableHead>
              <TableHead>Tür</TableHead>
              <TableHead className="hidden md:table-cell">Telefon</TableHead>
              <TableHead className="hidden lg:table-cell">E-posta</TableHead>
              <TableHead className="hidden xl:table-cell">Diller</TableHead>
              <TableHead className="hidden lg:table-cell">Lisans No</TableHead>
              <TableHead className="hidden xl:table-cell">Şirket</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead>Hesap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={9}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            )) : isError ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center">
                <p className="text-destructive mb-3">Personel listesi yüklenemedi.</p>
                <Button variant="outline" onClick={() => refetch()}>Yeniden Dene</Button>
              </TableCell></TableRow>
            ) : trulyEmpty ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                Henüz personel kaydı yok
              </TableCell></TableRow>
            ) : noResultsFromFilter ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                Arama kriterlerine uygun personel bulunamadı
              </TableCell></TableRow>
            ) : rows.map(p => (
              <TableRow key={p.id} data-testid={`row-personnel-${p.id}`}>
                <TableCell className="font-medium">
                  <Link href={`/personnel/${p.id}`} className="hover:underline">{p.name}</Link>
                </TableCell>
                <TableCell><span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-medium">{RESOURCE_TYPE_LABELS[p.type] ?? p.type}</span></TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{p.phone ?? '-'}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground truncate max-w-[200px]">{p.email ?? '-'}</TableCell>
                <TableCell className="hidden xl:table-cell text-muted-foreground">{p.languages ?? '-'}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">{p.licenseNumber ?? '-'}</TableCell>
                <TableCell className="hidden xl:table-cell text-muted-foreground truncate max-w-[160px]">{p.company ?? '-'}</TableCell>
                <TableCell><StatusChip active={p.active} /></TableCell>
                <TableCell><LinkedChip hasLinkedLogin={p.hasLinkedLogin} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: compact cards, no table at all. */}
      <div className="sm:hidden space-y-3">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)
          : isError ? <Card><CardContent className="py-8 text-center"><p className="text-destructive mb-3">Personel listesi yüklenemedi.</p><Button variant="outline" onClick={() => refetch()}>Yeniden Dene</Button></CardContent></Card>
          : trulyEmpty ? <Card><CardContent className="py-10 text-center text-muted-foreground">Henüz personel kaydı yok</CardContent></Card>
          : noResultsFromFilter ? <Card><CardContent className="py-10 text-center text-muted-foreground">Arama kriterlerine uygun personel bulunamadı</CardContent></Card>
          : rows.map(p => (
            <Link key={p.id} href={`/personnel/${p.id}`}>
              <Card className="hover:bg-accent/40 transition-colors" data-testid={`card-personnel-${p.id}`}>
                <CardContent className="p-4 space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent text-accent-foreground font-medium shrink-0">{RESOURCE_TYPE_LABELS[p.type] ?? p.type}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{p.phone ?? 'Telefon yok'}{p.company ? ` · ${p.company}` : ''}</div>
                  <div className="flex items-center gap-2 pt-1">
                    <StatusChip active={p.active} />
                    <LinkedChip hasLinkedLogin={p.hasLinkedLogin} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
      </div>

      {/* ── Create dialog ──────────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={open => { setDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><IdCard className="w-4 h-4" />Yeni Personel</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tür *</label>
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as 'GUIDE' | 'DRIVER' }))}>
                <SelectTrigger data-testid="select-new-personnel-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="GUIDE">{RESOURCE_TYPE_LABELS['GUIDE']}</SelectItem>
                  <SelectItem value="DRIVER">{RESOURCE_TYPE_LABELS['DRIVER']}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Ad Soyad *</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ad Soyad" data-testid="input-new-personnel-name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Telefon</label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+90 5xx..." />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">E-posta</label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="ornek@mail.com" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Diller</label>
              <Input value={form.languages} onChange={e => setForm(f => ({ ...f, languages: e.target.value }))} placeholder="TR, EN, DE" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Lisans No</label>
              <Input value={form.licenseNumber} onChange={e => setForm(f => ({ ...f, licenseNumber: e.target.value }))} placeholder="Lisans/ehliyet no" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Şirket</label>
              <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Bağlı olduğu şirket (varsa)" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notlar</label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notlar..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>İptal</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-create-personnel">
              {createMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

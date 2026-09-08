/**
 * Personnel detail (Phase 2D.2). See personnel.tsx (list page) for the
 * broader context and the Personel/Kullanıcı Yönetimi separation.
 *
 * Editing respects the Phase 2D.1 write contract exactly
 * (artifacts/api-server/src/lib/personnel-write.ts): `type` is immutable
 * after creation and is never rendered as an editable field here — only
 * shown, read-only, in the IDENTITY section. All other business validation
 * (email format, field lengths, etc.) is left to the backend; this page
 * only checks that name is non-empty before submitting, and otherwise
 * surfaces backend validation errors directly.
 *
 * ACCOUNT LINK shows only the safe linkedProfile summary the backend
 * already returns (id, name, email, role, isActive) — never a raw fetch of
 * the profiles table from the frontend, and never a UI path to create a
 * new login from here (see personnel.tsx's file comment).
 *
 * Identity-matching visibility (EXACT_MATCH / ALIAS_MATCH / AMBIGUOUS /
 * UNMATCHED) is deliberately not shown — see personnel.tsx's file comment.
 */
import { useState, useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  useGetResource, useUpdateResource, useCreateResourceAlias, useDeleteResourceAlias,
  getGetResourceQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { usePermission } from '@/hooks/usePermission';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Save, Plus, Trash2, Link2, Link2Off } from 'lucide-react';
import { RESOURCE_TYPE_LABELS, RESOURCE_ALIAS_SOURCE_LABELS } from '@/lib/labels';

const EMPTY_FORM = { name: '', phone: '', email: '', languages: '', company: '', licenseNumber: '', notes: '', active: true };
const ALIAS_SOURCES = ['MANUAL', 'SHEET_IMPORT', 'PERFORMANCE_2026', 'LEGACY_OPERATION'] as const;

function backendError(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    return String((data as Record<string, unknown>)['error']);
  }
  return fallback;
}

export default function PersonnelDetailPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? '0', 10);
  const { toast } = useToast();
  const qc = useQueryClient();
  const canUpdate = usePermission('personnel', 'update');

  const { data: resource, isLoading, isError } = useGetResource(id, {
    query: { enabled: !!id, queryKey: getGetResourceQueryKey(id) },
  });
  const updateMutation = useUpdateResource();
  const createAliasMutation = useCreateResourceAlias();
  const deleteAliasMutation = useDeleteResourceAlias();

  const [form, setForm] = useState(EMPTY_FORM);
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false);
  const [aliasForm, setAliasForm] = useState<{ alias: string; source: typeof ALIAS_SOURCES[number] }>({ alias: '', source: 'MANUAL' });
  const [deleteAliasTarget, setDeleteAliasTarget] = useState<{ id: number; alias: string } | null>(null);

  useEffect(() => {
    if (resource) {
      setForm({
        name: resource.name ?? '',
        phone: resource.phone ?? '',
        email: resource.email ?? '',
        languages: resource.languages ?? '',
        company: resource.company ?? '',
        licenseNumber: resource.licenseNumber ?? '',
        notes: resource.notes ?? '',
        active: resource.active,
      });
    }
  }, [resource]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetResourceQueryKey(id) });
    qc.invalidateQueries({ queryKey: ['/api/resources'] });
  }

  function handleSave() {
    if (!form.name.trim()) { toast({ title: 'Ad Soyad zorunludur', variant: 'destructive' }); return; }
    updateMutation.mutate({
      id,
      data: {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        languages: form.languages.trim() || null,
        company: form.company.trim() || null,
        licenseNumber: form.licenseNumber.trim() || null,
        notes: form.notes.trim() || null,
        active: form.active,
      },
    }, {
      onSuccess: () => { toast({ title: 'Personel güncellendi' }); invalidate(); },
      onError: (err) => toast({ title: 'Hata', description: backendError(err, 'Personel güncellenemedi'), variant: 'destructive' }),
    });
  }

  function handleAddAlias() {
    const alias = aliasForm.alias.trim();
    if (!alias) { toast({ title: 'Takma ad zorunludur', variant: 'destructive' }); return; }
    createAliasMutation.mutate({ id, data: { alias, source: aliasForm.source } }, {
      onSuccess: () => {
        toast({ title: 'Takma ad eklendi' });
        invalidate();
        setAliasDialogOpen(false);
        setAliasForm({ alias: '', source: 'MANUAL' });
      },
      onError: (err) => toast({ title: 'Hata', description: backendError(err, 'Takma ad eklenemedi'), variant: 'destructive' }),
    });
  }

  function confirmDeleteAlias() {
    if (!deleteAliasTarget) return;
    const { id: aliasId, alias } = deleteAliasTarget;
    deleteAliasMutation.mutate({ id, aliasId }, {
      onSuccess: () => { toast({ title: `"${alias}" silindi` }); invalidate(); setDeleteAliasTarget(null); },
      onError: (err) => { setDeleteAliasTarget(null); toast({ title: 'Hata', description: backendError(err, 'Takma ad silinemedi'), variant: 'destructive' }); },
    });
  }

  const F = ({ label, field, placeholder = '' }: { label: string; field: 'name' | 'phone' | 'email' | 'languages' | 'company' | 'licenseNumber' | 'notes'; placeholder?: string }) => (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <Input
        value={form[field]}
        onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
        placeholder={placeholder}
        disabled={!canUpdate}
        data-testid={`input-personnel-${field}`}
      />
    </div>
  );

  if (isLoading) {
    return <AppShell title="Personel Detayı"><Skeleton className="h-96 rounded-xl" /></AppShell>;
  }

  if (isError || !resource) {
    return (
      <AppShell title="Personel Bulunamadı">
        <div className="mb-4"><Link href="/personnel"><Button variant="ghost" size="sm" className="gap-1.5"><ArrowLeft className="w-4 h-4" />Personel</Button></Link></div>
        <p className="text-muted-foreground">Personel bulunamadı veya erişim izniniz yok.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title={resource.name}>
      <div className="mb-4"><Link href="/personnel"><Button variant="ghost" size="sm" className="gap-1.5" data-testid="button-back-personnel"><ArrowLeft className="w-4 h-4" />Personel</Button></Link></div>

      <div className="space-y-4">
        {/* ── IDENTITY + CONTACT + PROFESSIONAL ─────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Kimlik &amp; İletişim</CardTitle>
            {canUpdate && (
              <Button onClick={handleSave} disabled={updateMutation.isPending} size="sm" className="gap-1.5" data-testid="button-save-personnel">
                <Save className="w-4 h-4" />{updateMutation.isPending ? 'Kaydediliyor...' : 'Kaydet'}
              </Button>
            )}
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              {/* Type is immutable after creation (personnel-write.ts) — shown
                  read-only, never rendered as an editable Select. */}
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tür</label>
              <Input value={RESOURCE_TYPE_LABELS[resource.type] ?? resource.type} disabled data-testid="input-personnel-type-readonly" />
            </div>
            <F label="Ad Soyad *" field="name" placeholder="Ad Soyad" />
            <F label="Telefon" field="phone" placeholder="+90 5xx..." />
            <F label="E-posta" field="email" placeholder="ornek@mail.com" />
            <F label="Diller" field="languages" placeholder="TR, EN, DE" />
            <F label="Lisans No" field="licenseNumber" placeholder="Lisans/ehliyet no" />
            <F label="Şirket" field="company" placeholder="Bağlı olduğu şirket (varsa)" />
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Durum</label>
              <Select value={form.active ? 'active' : 'inactive'} onValueChange={v => setForm(f => ({ ...f, active: v === 'active' }))} disabled={!canUpdate}>
                <SelectTrigger data-testid="select-personnel-active"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="inactive">Pasif</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><F label="Notlar" field="notes" placeholder="Notlar..." /></div>
            <div className="md:col-span-2 pt-1 border-t text-xs text-muted-foreground">
              Normalize edilmiş ad (eşleştirme için, sadece bilgi amaçlı): <span className="font-mono">{resource.normalizedName}</span>
            </div>
          </CardContent>
        </Card>

        {/* ── ACCOUNT LINK ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Hesap Bağlantısı</CardTitle></CardHeader>
          <CardContent>
            {resource.linkedProfile ? (
              <div className="flex items-center gap-3">
                <Link2 className="w-4 h-4 text-blue-600 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">{resource.linkedProfile.name || resource.linkedProfile.email}</div>
                  <div className="text-muted-foreground">{resource.linkedProfile.email} · {resource.linkedProfile.role}{!resource.linkedProfile.isActive ? ' · Pasif hesap' : ''}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Link2Off className="w-4 h-4 shrink-0" />Bağlı bir TourPilot hesabı yok.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── ALIASES ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Takma Adlar ({resource.aliases.length})</CardTitle>
            {canUpdate && (
              <Button onClick={() => setAliasDialogOpen(true)} size="sm" variant="outline" className="gap-1.5" data-testid="button-add-alias">
                <Plus className="w-3.5 h-3.5" />Takma Ad Ekle
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {resource.aliases.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Henüz takma ad kaydı yok</p>
            ) : (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Takma Ad</TableHead>
                      <TableHead>Kaynak</TableHead>
                      <TableHead className="hidden md:table-cell">Normalize</TableHead>
                      {canUpdate && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resource.aliases.map(a => (
                      <TableRow key={a.id} data-testid={`row-alias-${a.id}`}>
                        <TableCell className="font-medium">{a.alias}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{RESOURCE_ALIAS_SOURCE_LABELS[a.source] ?? a.source}</TableCell>
                        <TableCell className="hidden md:table-cell text-muted-foreground text-xs font-mono">{a.normalizedAlias}</TableCell>
                        {canUpdate && (
                          <TableCell>
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteAliasTarget({ id: a.id, alias: a.alias })}
                              data-testid={`button-delete-alias-${a.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── SYSTEM ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Sistem</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-muted-foreground">
            <div>Oluşturulma: {new Date(resource.createdAt).toLocaleString('tr-TR')}</div>
            <div>Son Güncelleme: {new Date(resource.updatedAt).toLocaleString('tr-TR')}</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Add alias dialog ───────────────────────────────────────────────── */}
      <Dialog open={aliasDialogOpen} onOpenChange={open => { setAliasDialogOpen(open); if (!open) setAliasForm({ alias: '', source: 'MANUAL' }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Takma Ad Ekle</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Takma Ad *</label>
              <Input value={aliasForm.alias} onChange={e => setAliasForm(f => ({ ...f, alias: e.target.value }))} placeholder="Örn. farklı yazımı" data-testid="input-alias-value" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Kaynak</label>
              <Select value={aliasForm.source} onValueChange={v => setAliasForm(f => ({ ...f, source: v as typeof ALIAS_SOURCES[number] }))}>
                <SelectTrigger data-testid="select-alias-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALIAS_SOURCES.map(s => <SelectItem key={s} value={s}>{RESOURCE_ALIAS_SOURCE_LABELS[s] ?? s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAliasDialogOpen(false)}>İptal</Button>
            <Button onClick={handleAddAlias} disabled={createAliasMutation.isPending} data-testid="button-confirm-add-alias">
              {createAliasMutation.isPending ? 'Ekleniyor...' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete alias confirm dialog ──────────────────────────────────── */}
      <AlertDialog open={!!deleteAliasTarget} onOpenChange={open => { if (!open) setDeleteAliasTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Takma adı sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteAliasTarget?.alias}</strong> takma adı kaldırılacak. Bu işlem personel kaydını etkilemez, geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteAlias}
              data-testid="button-confirm-delete-alias"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

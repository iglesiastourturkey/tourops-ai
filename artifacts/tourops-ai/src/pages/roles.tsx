import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/clerk-appearance';
import { ShieldCheck, Users, AlertCircle } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface RoleMeta  { name: string; displayName: string; sortOrder: number }
interface Permission { id: number; module: string; action: string }
interface RolePerm   { id: number; roleName: string; permissionId: number; granted: boolean }

interface MatrixData {
  roles:       RoleMeta[];
  permissions: Permission[];
  matrix:      RolePerm[];
}

// ── Labels ───────────────────────────────────────────────────────────────────
const MODULE_LABELS: Record<string, string> = {
  dashboard:        'Kontrol Paneli',
  customers:        'Müşteriler',
  suppliers:        'Tedarikçiler',
  tours:            'Turlar',
  quotations:       'Teklifler',
  operations:       'Operasyon Planlama',
  guide_workspace:  'Rehber Çalışma Alanı',
  field_operations: 'Operasyon Merkezi',
  incidents:        'Olaylar',
  receipts:         'Fişler',
  documents:        'Belgeler',
  accounting:       'Muhasebe',
  accounting_ai:    'Muhasebe AI',
  reports:          'Raporlar',
  notifications:    'Bildirimler',
  users:            'Kullanıcılar',
  roles:            'Rol Yönetimi',
  settings:         'Ayarlar',
  system_control:   'Sistem Kontrolü',
  exports:          'Dışa Aktarım',
  ai:               'Yapay Zeka',
};

const ACTION_LABELS: Record<string, string> = {
  view:     'Görüntüle',
  create:   'Oluştur',
  update:   'Güncelle',
  delete:   'Sil',
  approve:  'Onayla',
  assign:   'Ata',
  upload:   'Yükle',
  download: 'İndir',
  export:   'Dışa Aktar',
  manage:   'Yönet',
  archive:  'Arşivle',
};

// action colour hints
const ACTION_BADGE: Record<string, string> = {
  delete:  'destructive',
  approve: 'default',
  manage:  'default',
  assign:  'secondary',
};

// Roles shown in matrix (super_admin always has everything)
const MATRIX_ROLES = ['admin', 'operations', 'accounting', 'guide', 'field_operations'];

async function customFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function RolesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null); // `${roleName}.${permId}`

  const { data, isLoading, error } = useQuery<MatrixData>({
    queryKey: ['roles-matrix'],
    queryFn:  () => customFetch<MatrixData>(`${API_BASE}/roles`),
    staleTime: 60_000,
  });

  const toggle = useMutation({
    mutationFn: ({ roleName, permId, granted }: { roleName: string; permId: number; granted: boolean }) => {
      setPending(`${roleName}.${permId}`);
      return customFetch<{ ok: boolean }>(`${API_BASE}/roles/${roleName}/permissions/${permId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ granted }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles-matrix'] });
      setPending(null);
    },
    onError: (err: Error) => {
      setPending(null);
      toast({ title: 'Hata', description: err.message, variant: 'destructive' });
    },
  });

  // Build fast lookup: `${roleName}.${permId}` → granted
  const lookup = new Map<string, boolean>();
  if (data) {
    for (const rp of data.matrix) {
      lookup.set(`${rp.roleName}.${rp.permissionId}`, rp.granted);
    }
  }

  // Group permissions by module, maintaining action order
  const ACTION_ORDER = ['view','create','update','delete','approve','assign','upload','download','export','manage','archive'];
  const byModule = new Map<string, Permission[]>();
  if (data) {
    for (const p of data.permissions) {
      if (!byModule.has(p.module)) byModule.set(p.module, []);
      byModule.get(p.module)!.push(p);
    }
    // Sort each module's actions
    for (const [, perms] of byModule) {
      perms.sort((a, b) => ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action));
    }
  }

  const displayedRoles = data?.roles.filter(r => MATRIX_ROLES.includes(r.name))
    .sort((a, b) => a.sortOrder - b.sortOrder) ?? [];

  return (
    <AppShell title="Rol Yetki Matrisi">
      <div className="max-w-full space-y-4">
        {/* Header info */}
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-3 py-3">
            <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              Süper yönetici hesabının tüm yetkiler üzerinde kalıcı erişimi vardır ve bu matris aracılığıyla
              kısıtlanamaz. Değişiklikler anında geçerli olur; izin önbelleği 5 dakika içinde yenilenir.
            </p>
          </CardContent>
        </Card>

        {/* Loading */}
        {isLoading && (
          <Card>
            <CardContent className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="border-destructive">
            <CardContent className="p-6 text-destructive text-sm">
              Yetki matrisi yüklenemedi: {(error as Error).message}
            </CardContent>
          </Card>
        )}

        {/* Matrix */}
        {data && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Modül × Yetki Matrisi</CardTitle>
                <Badge variant="secondary" className="ml-auto">
                  <Users className="w-3 h-3 mr-1" />
                  Süper Yönetici her yetkiye sahip
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-56">Modül / İşlem</th>
                      {displayedRoles.map(role => (
                        <th key={role.name} className="px-3 py-2.5 font-medium text-center min-w-[90px]">
                          {role.displayName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(byModule.entries()).map(([module, perms]) => (
                      <>
                        {/* Module header row */}
                        <tr key={`module-${module}`} className="bg-muted/30 border-y border-dashed border-muted-foreground/20">
                          <td colSpan={displayedRoles.length + 1} className="px-4 py-1.5">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              {MODULE_LABELS[module] ?? module}
                            </span>
                          </td>
                        </tr>

                        {/* Action rows */}
                        {perms.map(perm => (
                          <tr key={perm.id} className="border-b last:border-b-0 hover:bg-muted/10 transition-colors">
                            <td className="px-4 py-2 text-muted-foreground pl-8 flex items-center gap-1.5">
                              <span>{ACTION_LABELS[perm.action] ?? perm.action}</span>
                              {ACTION_BADGE[perm.action] === 'destructive' && (
                                <span className="text-[10px] text-destructive font-medium border border-destructive/30 rounded px-1">!!</span>
                              )}
                            </td>
                            {displayedRoles.map(role => {
                              const key     = `${role.name}.${perm.id}`;
                              const granted = lookup.get(key) ?? false;
                              const busy    = pending === key;
                              return (
                                <td key={role.name} className="px-3 py-2 text-center">
                                  <Checkbox
                                    checked={granted}
                                    disabled={busy || toggle.isPending}
                                    onCheckedChange={checked => {
                                      toggle.mutate({ roleName: role.name, permId: perm.id, granted: !!checked });
                                    }}
                                    className="mx-auto"
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

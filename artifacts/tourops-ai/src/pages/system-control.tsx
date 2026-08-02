import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/clerk-appearance';
import {
  CheckCircle2, Wrench, BookOpen, Power, AlertTriangle, Clock, Shield,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
type SystemMode = 'active' | 'maintenance' | 'read_only' | 'disabled';

interface SystemSettings {
  id:                           number;
  systemMode:                   SystemMode;
  maintenanceMessage:           string | null;
  maintenanceStartAt:           string | null;
  maintenanceEndAt:             string | null;
  maintenanceAllowedProfileIds: number[] | null;
  updatedAt:                    string;
  allowedUsers: Array<{ id: number; name: string | null; email: string | null }>;
}

interface AuditRow {
  log:   { id: number; eventType: string; oldValue: unknown; newValue: unknown; createdAt: string };
  actor: { id: number; name: string | null; email: string | null } | null;
}

// ── Mode config ───────────────────────────────────────────────────────────────
const MODES: {
  value:       SystemMode;
  label:       string;
  description: string;
  icon:        React.ComponentType<{ className?: string }>;
  color:       string;
  bg:          string;
  border:      string;
}[] = [
  {
    value: 'active', label: '🟢 Aktif', description: 'Normal operasyon. Tüm kullanıcılar tüm işlemleri gerçekleştirebilir.',
    icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-300',
  },
  {
    value: 'maintenance', label: '🟡 Bakım', description: 'Süper yönetici ve seçilen kullanıcılar dışında herkes bakım sayfasını görür.',
    icon: Wrench, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-300',
  },
  {
    value: 'read_only', label: '🔵 Salt Okunur', description: 'POST / PUT / PATCH / DELETE işlemleri engellenir. Görüntüleme serbesttir.',
    icon: BookOpen, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-300',
  },
  {
    value: 'disabled', label: '🔴 Devre Dışı', description: 'Yalnızca süper yönetici sisteme erişebilir. Diğer tüm kullanıcılar engellenir.',
    icon: Power, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-300',
  },
];

async function customFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SystemControlPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [targetMode,    setTargetMode]    = useState<SystemMode | null>(null);
  const [confirmOpen,   setConfirmOpen]   = useState(false);
  const [maintMsg,      setMaintMsg]      = useState('');
  const [maintStart,    setMaintStart]    = useState('');
  const [maintEnd,      setMaintEnd]      = useState('');

  const { data: settings, isLoading } = useQuery<SystemSettings>({
    queryKey: ['system-settings'],
    queryFn:  () => customFetch<SystemSettings>(`${API_BASE}/system/settings`),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const { data: auditData } = useQuery<{ logs: AuditRow[]; total: number }>({
    queryKey: ['audit-system'],
    queryFn:  () => customFetch<{ logs: AuditRow[]; total: number }>(
      `${API_BASE}/audit?eventType=system_mode_changed&limit=10`,
    ),
    staleTime: 30_000,
  });

  const patchSettings = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<SystemSettings>(`${API_BASE}/system/settings`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['system-settings'] });
      qc.invalidateQueries({ queryKey: ['audit-system'] });
      setConfirmOpen(false);
      setTargetMode(null);
      toast({ title: 'Sistem modu güncellendi' });
    },
    onError: (err: Error) => {
      toast({ title: 'Hata', description: err.message, variant: 'destructive' });
    },
  });

  function openConfirm(mode: SystemMode) {
    setTargetMode(mode);
    if (settings?.maintenanceMessage) setMaintMsg(settings.maintenanceMessage);
    setConfirmOpen(true);
  }

  function applyMode() {
    if (!targetMode) return;
    const body: Record<string, unknown> = { systemMode: targetMode };
    if (targetMode === 'maintenance') {
      body['maintenanceMessage'] = maintMsg || null;
      body['maintenanceStartAt'] = maintStart || null;
      body['maintenanceEndAt']   = maintEnd   || null;
    }
    patchSettings.mutate(body);
  }

  function saveMaintSettings() {
    patchSettings.mutate({
      maintenanceMessage: maintMsg || null,
      maintenanceStartAt: maintStart || null,
      maintenanceEndAt:   maintEnd   || null,
    });
  }

  const currentMode = settings?.systemMode ?? 'active';
  const currentCfg  = MODES.find(m => m.value === currentMode)!;

  return (
    <AppShell title="Sistem Kontrolü">
      <div className="max-w-3xl space-y-6">
        {/* Current status */}
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <Card className={`${currentCfg.border} border-2 ${currentCfg.bg}`}>
            <CardContent className="flex items-center gap-4 py-4">
              <currentCfg.icon className={`w-8 h-8 ${currentCfg.color}`} />
              <div>
                <div className={`font-semibold text-lg ${currentCfg.color}`}>{currentCfg.label}</div>
                <div className="text-sm text-muted-foreground">{currentCfg.description}</div>
              </div>
              <Badge variant="outline" className="ml-auto text-xs">
                <Clock className="w-3 h-3 mr-1" />
                {settings ? new Date(settings.updatedAt).toLocaleString('tr-TR') : '—'}
              </Badge>
            </CardContent>
          </Card>
        )}

        {/* Safety notice */}
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-start gap-2 py-3">
            <Shield className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-amber-800">
              Süper yönetici her modda sisteme erişebilir — kendinizi asla kilitleyemezsiniz.
              Değişiklikler anında etkin olur ve denetim kaydına işlenir.
            </p>
          </CardContent>
        </Card>

        {/* Mode selector */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mod Seçimi</CardTitle>
            <CardDescription>Moda tıklayarak değiştirin.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MODES.map(mode => {
              const isActive = currentMode === mode.value;
              return (
                <button
                  key={mode.value}
                  onClick={() => !isActive && openConfirm(mode.value)}
                  disabled={isActive || isLoading}
                  className={`
                    text-left p-4 rounded-lg border-2 transition-all
                    ${isActive ? `${mode.border} ${mode.bg} cursor-default` : 'border-border hover:border-muted-foreground/50 cursor-pointer'}
                  `}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <mode.icon className={`w-4 h-4 ${isActive ? mode.color : 'text-muted-foreground'}`} />
                    <span className={`font-medium text-sm ${isActive ? mode.color : ''}`}>{mode.label}</span>
                    {isActive && <Badge className="ml-auto text-[10px] py-0">Aktif</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{mode.description}</p>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Maintenance settings (only when in maintenance mode) */}
        {currentMode === 'maintenance' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="w-4 h-4" /> Bakım Ayarları
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Bakım Mesajı</Label>
                <Textarea
                  placeholder="Kullanıcılara gösterilecek mesaj..."
                  value={maintMsg !== '' ? maintMsg : (settings?.maintenanceMessage ?? '')}
                  onChange={e => setMaintMsg(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Başlangıç Zamanı</Label>
                  <Input type="datetime-local" value={maintStart || settings?.maintenanceStartAt?.slice(0,16) || ''} onChange={e => setMaintStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Bitiş Zamanı</Label>
                  <Input type="datetime-local" value={maintEnd || settings?.maintenanceEndAt?.slice(0,16) || ''} onChange={e => setMaintEnd(e.target.value)} />
                </div>
              </div>
              {(settings?.allowedUsers ?? []).length > 0 && (
                <div>
                  <Label className="mb-1.5 block">Erişim İzni Verilen Kullanıcılar</Label>
                  <div className="flex flex-wrap gap-2">
                    {settings!.allowedUsers.map(u => (
                      <Badge key={u.id} variant="secondary">{u.name ?? u.email ?? `#${u.id}`}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <Button onClick={saveMaintSettings} disabled={patchSettings.isPending} size="sm">
                {patchSettings.isPending ? 'Kaydediliyor…' : 'Bakım Ayarlarını Kaydet'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Audit log */}
        {(auditData?.logs ?? []).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Son Mod Değişiklikleri</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y">
                {auditData!.logs.map(row => {
                  const oldMode = (row.log.oldValue as { mode?: string })?.mode;
                  const newMode = (row.log.newValue as { mode?: string })?.mode;
                  return (
                    <li key={row.log.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground text-xs w-32 flex-shrink-0">
                        {new Date(row.log.createdAt).toLocaleString('tr-TR')}
                      </span>
                      <span className="flex-1">
                        <span className="font-medium">{row.actor?.name ?? row.actor?.email ?? 'Bilinmiyor'}</span>
                        {' '}modu değiştirdi:{' '}
                        <span className="text-muted-foreground">{oldMode}</span>
                        {' → '}
                        <span className="font-medium">{newMode}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={open => { if (!open) { setConfirmOpen(false); setTargetMode(null); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Sistem Modunu Değiştir
            </DialogTitle>
          </DialogHeader>

          {targetMode && (
            <>
              <p className="text-sm text-muted-foreground">
                Sistem modu <strong>{MODES.find(m=>m.value===currentMode)?.label}</strong>'dan{' '}
                <strong>{MODES.find(m=>m.value===targetMode)?.label}</strong>'ya alınacak.
                {targetMode === 'disabled' && (
                  <span className="block mt-1 text-destructive font-medium">
                    Tüm kullanıcılar sisteme erişimi kaybeder. Yalnızca süper yönetici giriş yapabilir.
                  </span>
                )}
              </p>

              {targetMode === 'maintenance' && (
                <div className="space-y-3 mt-2">
                  <div className="space-y-1.5">
                    <Label>Bakım Mesajı (isteğe bağlı)</Label>
                    <Textarea
                      placeholder="Bakım sırasında kullanıcılara gösterilecek mesaj..."
                      value={maintMsg}
                      onChange={e => setMaintMsg(e.target.value)}
                      rows={2}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setConfirmOpen(false); setTargetMode(null); }}>
              İptal
            </Button>
            <Button
              variant={targetMode === 'disabled' ? 'destructive' : 'default'}
              onClick={applyMode}
              disabled={patchSettings.isPending}
            >
              {patchSettings.isPending ? 'Uygulanıyor…' : 'Onayla ve Uygula'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

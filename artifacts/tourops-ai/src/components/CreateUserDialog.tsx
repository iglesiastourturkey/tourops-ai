import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';
import { customFetch } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/api-base';

export const MANUAL_CREATION_ROLES: UserRole[] = ['admin', 'operations', 'guide', 'accounting', 'field_operations'];

function apiErrMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message);
  return 'Bilinmeyen hata';
}

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the role is fixed and the selector is hidden — e.g. creating a guide from the Suppliers page. */
  lockedRole?: UserRole;
}

/** Creates a user directly with a server-generated temporary password (no Clerk
 *  invitation email). The API hard-restricts this to super_admin regardless of the
 *  users.manage grant (routes/users.ts: "Manuel kullanıcı oluşturma yalnızca süper
 *  yöneticiye açıktır"), so callers must gate visibility on the caller's actual
 *  role, not just usePermission('users','manage').
 *  Shared by the Users page (any MANUAL_CREATION_ROLES role) and the Suppliers →
 *  Rehberler tab (role locked to 'guide'). */
export function CreateUserDialog({ open, onOpenChange, lockedRole }: CreateUserDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>(lockedRole ?? 'guide');
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const temporaryPassword = crypto.getRandomValues(new Uint32Array(4)).join('').slice(0, 12) + 'aA!';
      return customFetch<{ temporaryPassword: string }>(`${API_BASE}/users/manual`, {
        method: 'POST',
        body: JSON.stringify({ name, username, email, phone, role, temporaryPassword }),
      });
    },
    onSuccess: (data) => {
      onOpenChange(false);
      setName(''); setUsername(''); setEmail(''); setPhone(''); setRole(lockedRole ?? 'guide');
      setTempPassword(data.temporaryPassword);
      qc.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'Kullanıcı oluşturuldu', description: 'Geçici şifreyi şimdi güvenli şekilde paylaşın.' });
    },
    onError: (err) => toast({ title: 'Kullanıcı oluşturulamadı', description: apiErrMsg(err), variant: 'destructive' }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || username.length < 3) {
      toast({ title: 'Hata', description: 'Ad soyad ve en az 3 karakterlik kullanıcı adı zorunludur', variant: 'destructive' });
      return;
    }
    createMutation.mutate();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{lockedRole ? `${ROLE_LABELS[lockedRole]} Oluştur` : 'Yeni Kullanıcı Oluştur'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="manual-name">Ad Soyad <span className="text-destructive">*</span></Label>
              <Input id="manual-name" placeholder="Ahmet Yılmaz" value={name}
                onChange={e => setName(e.target.value)} disabled={createMutation.isPending} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-username">Kullanıcı Adı <span className="text-destructive">*</span></Label>
              <Input id="manual-username" placeholder="ahmet_yilmaz" value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32))}
                disabled={createMutation.isPending} autoCapitalize="none" autoCorrect="off" required />
              <p className="text-xs text-muted-foreground">3–32 karakter: a-z, 0-9 ve alt çizgi.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-email">E-posta <span className="text-muted-foreground">(opsiyonel)</span></Label>
              <Input id="manual-email" type="email" placeholder="ornek@sirket.com" value={email}
                onChange={e => setEmail(e.target.value)} disabled={createMutation.isPending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-phone">Telefon <span className="text-muted-foreground">(opsiyonel)</span></Label>
              <Input id="manual-phone" type="tel" placeholder="+90 555 555 55 55" value={phone}
                onChange={e => setPhone(e.target.value)} disabled={createMutation.isPending} />
            </div>
            {!lockedRole && (
              <div className="space-y-1.5">
                <Label htmlFor="manual-role">Rol <span className="text-destructive">*</span></Label>
                <Select value={role} onValueChange={v => setRole(v as UserRole)} disabled={createMutation.isPending}>
                  <SelectTrigger id="manual-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MANUAL_CREATION_ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Geçici şifre oluşturulacak ve kullanıcı ilk girişinde değiştirmek zorunda olacaktır.
            </p>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>İptal</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Oluşturuluyor…' : 'Kullanıcı Oluştur'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Temporary password reveal (shown exactly once) ─────────────────── */}
      <Dialog open={!!tempPassword} onOpenChange={() => setTempPassword(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Geçici Şifre Oluşturuldu</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-xs text-orange-800 leading-relaxed">
              ⚠️ Bu şifreyi güvenli bir kanal üzerinden kullanıcıya iletin.
              <strong> Şifre bir daha gösterilmeyecektir.</strong> Kullanıcı ilk girişinde
              yeni bir şifre belirlemek zorunda kalacaktır.
            </div>
            <div className="flex gap-2">
              <Input readOnly value={tempPassword ?? ''} className="font-mono tracking-widest text-sm" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(tempPassword ?? '');
                  toast({ title: 'Kopyalandı' });
                }}
              >
                Kopyala
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setTempPassword(null)}>Anladım, Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

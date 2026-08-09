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

export const VALID_ROLES: UserRole[] = ['super_admin', 'admin', 'operations', 'guide', 'accounting', 'field_operations'];

function apiErrMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message);
  return 'Bilinmeyen hata';
}

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the role is fixed and the selector is hidden — e.g. inviting a guide from the Suppliers page. */
  lockedRole?: UserRole;
}

/** Sends a Clerk invitation for the given role. Shared by the Users page (any role,
 *  role picker shown) and the Suppliers → Rehberler tab (role locked to 'guide'). */
export function InviteUserDialog({ open, onOpenChange, lockedRole }: InviteUserDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>(lockedRole ?? 'guide');

  const inviteMutation = useMutation({
    mutationFn: () => customFetch<{ ok: boolean }>(`${API_BASE}/users/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, name, role }),
    }),
    onSuccess: () => {
      toast({ title: 'Davet gönderildi', description: `${email} adresine davet iletildi.` });
      onOpenChange(false);
      setEmail(''); setName(''); setRole(lockedRole ?? 'guide');
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => toast({ title: 'Davet gönderilemedi', description: apiErrMsg(err), variant: 'destructive' }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes('@')) {
      toast({ title: 'Hata', description: 'Geçerli bir e-posta adresi giriniz', variant: 'destructive' });
      return;
    }
    inviteMutation.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lockedRole ? `${ROLE_LABELS[lockedRole]} Davet Et` : 'Kullanıcı Davet Et'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="inv-name">Ad Soyad</Label>
            <Input id="inv-name" placeholder="Ahmet Yılmaz" value={name}
              onChange={e => setName(e.target.value)} disabled={inviteMutation.isPending} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-email">E-posta <span className="text-destructive">*</span></Label>
            <Input id="inv-email" type="email" placeholder="ornek@sirket.com" value={email}
              onChange={e => setEmail(e.target.value)} disabled={inviteMutation.isPending} required />
          </div>
          {!lockedRole && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-role">Rol <span className="text-destructive">*</span></Label>
              <Select value={role} onValueChange={v => setRole(v as UserRole)} disabled={inviteMutation.isPending}>
                <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VALID_ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Davetiye Clerk üzerinden iletilecektir. Kullanıcı ilk girişte bu role atanacaktır.
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={inviteMutation.isPending}>İptal</Button>
            <Button type="submit" disabled={inviteMutation.isPending}>
              {inviteMutation.isPending ? 'Gönderiliyor…' : 'Davet Gönder'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';
import { customFetch } from '@workspace/api-client-react';
import {
  UserPlus, MoreVertical, ShieldOff, KeyRound, RefreshCw, UserCheck, UserX,
} from 'lucide-react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

const VALID_ROLES: UserRole[] = ['super_admin', 'admin', 'operations', 'guide', 'accounting'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichedUser {
  id: number;
  clerkUserId: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastSignInAt: number | null;
  imageUrl: string | null;
}

interface Invitation {
  id: string;
  emailAddress: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  role: string | null;
  createdAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiErrMsg(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: string }).message);
  return 'Bilinmeyen hata';
}

function formatDate(val: string | number | null | undefined): string {
  if (!val) return '—';
  const ms = typeof val === 'number' ? val : Date.parse(val);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function initials(name: string, email: string): string {
  if (name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

const INVITE_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Bekliyor', className: 'bg-yellow-100 text-yellow-800 border-0' },
  accepted: { label: 'Kabul Edildi', className: 'bg-green-100 text-green-800 border-0' },
  expired: { label: 'Süresi Doldu', className: 'bg-gray-100 text-gray-600 border-0' },
  revoked: { label: 'İptal Edildi', className: 'bg-red-100 text-red-700 border-0' },
};

// ── Main component ────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { userId: myClerkUserId } = useAuth();

  // ── Invite dialog ────────────────────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('guide');

  // ── Password reset link dialog ───────────────────────────────────────────
  const [resetLink, setResetLink] = useState<string | null>(null);

  // ── Fetch users & invitations ────────────────────────────────────────────
  const usersQuery = useQuery<EnrichedUser[]>({
    queryKey: ['users'],
    queryFn: () => customFetch<EnrichedUser[]>(`${API_BASE}/users`),
  });

  const invitesQuery = useQuery<Invitation[]>({
    queryKey: ['invitations'],
    queryFn: () => customFetch<Invitation[]>(`${API_BASE}/invitations`),
  });

  const users = usersQuery.data ?? [];
  const invitations = invitesQuery.data ?? [];

  // Count active super_admins for last-SA protection in UI
  const activeSuperAdminCount = users.filter(u => u.role === 'super_admin' && u.isActive).length;

  // ── Patch user ───────────────────────────────────────────────────────────
  const patchUser = useMutation({
    mutationFn: ({ clerkUserId, data }: { clerkUserId: string; data: { role?: string; isActive?: boolean } }) =>
      customFetch<EnrichedUser>(`${API_BASE}/users/${clerkUserId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast({ title: 'Kullanıcı güncellendi' }); },
    onError: (err) => toast({ title: 'Hata', description: apiErrMsg(err), variant: 'destructive' }),
  });

  // ── Invite mutation ──────────────────────────────────────────────────────
  const inviteMutation = useMutation({
    mutationFn: () => customFetch<{ ok: boolean }>(`${API_BASE}/users/invite`, {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, name: inviteName, role: inviteRole }),
    }),
    onSuccess: () => {
      toast({ title: 'Davet gönderildi', description: `${inviteEmail} adresine davet iletildi.` });
      setInviteOpen(false); setInviteEmail(''); setInviteName(''); setInviteRole('guide');
      qc.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (err) => toast({ title: 'Davet gönderilemedi', description: apiErrMsg(err), variant: 'destructive' }),
  });

  // ── Revoke sessions ──────────────────────────────────────────────────────
  const revokeSessions = useMutation({
    mutationFn: (clerkUserId: string) =>
      customFetch<{ ok: boolean; revokedCount: number }>(`${API_BASE}/users/${clerkUserId}/revoke-sessions`, { method: 'POST' }),
    onSuccess: (data) =>
      toast({ title: 'Oturumlar sonlandırıldı', description: `${data.revokedCount} aktif oturum kapatıldı.` }),
    onError: (err) => toast({ title: 'Hata', description: apiErrMsg(err), variant: 'destructive' }),
  });

  // ── Password reset link ──────────────────────────────────────────────────
  const passwordResetMutation = useMutation({
    mutationFn: (clerkUserId: string) =>
      customFetch<{ url: string; token: string }>(`${API_BASE}/users/${clerkUserId}/password-reset`, { method: 'POST' }),
    onSuccess: (data) => setResetLink(data.url || `https://app.url/sign-in?__clerk_ticket=${data.token}`),
    onError: (err) => toast({ title: 'Hata', description: apiErrMsg(err), variant: 'destructive' }),
  });

  // ── Invitation actions ───────────────────────────────────────────────────
  const revokeInvite = useMutation({
    mutationFn: (id: string) => customFetch<{ ok: boolean }>(`${API_BASE}/invitations/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => { toast({ title: 'Davet iptal edildi' }); qc.invalidateQueries({ queryKey: ['invitations'] }); },
    onError: (err) => toast({ title: 'Hata', description: apiErrMsg(err), variant: 'destructive' }),
  });

  const resendInvite = useMutation({
    mutationFn: (id: string) => customFetch<{ ok: boolean }>(`${API_BASE}/invitations/${id}/resend`, { method: 'POST' }),
    onSuccess: () => { toast({ title: 'Davet yeniden gönderildi' }); qc.invalidateQueries({ queryKey: ['invitations'] }); },
    onError: (err) => toast({ title: 'Hata', description: apiErrMsg(err), variant: 'destructive' }),
  });

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
      toast({ title: 'Hata', description: 'Geçerli bir e-posta adresi giriniz', variant: 'destructive' });
      return;
    }
    inviteMutation.mutate();
  }

  return (
    <AppShell title="Kullanıcı Yönetimi">

      {/* ── Invite dialog ───────────────────────────────────────── */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Kullanıcı Davet Et</DialogTitle></DialogHeader>
          <form onSubmit={handleInviteSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-name">Ad Soyad</Label>
              <Input id="inv-name" placeholder="Ahmet Yılmaz" value={inviteName}
                onChange={e => setInviteName(e.target.value)} disabled={inviteMutation.isPending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">E-posta <span className="text-destructive">*</span></Label>
              <Input id="inv-email" type="email" placeholder="ornek@sirket.com" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} disabled={inviteMutation.isPending} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-role">Rol <span className="text-destructive">*</span></Label>
              <Select value={inviteRole} onValueChange={v => setInviteRole(v as UserRole)} disabled={inviteMutation.isPending}>
                <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VALID_ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Davetiye Clerk üzerinden iletilecektir. Kullanıcı ilk girişte bu role atanacaktır.
            </p>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={inviteMutation.isPending}>İptal</Button>
              <Button type="submit" disabled={inviteMutation.isPending}>
                {inviteMutation.isPending ? 'Gönderiliyor…' : 'Davet Gönder'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Password reset link dialog ──────────────────────────── */}
      <Dialog open={!!resetLink} onOpenChange={() => setResetLink(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Şifre Sıfırlama Bağlantısı</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Aşağıdaki bağlantıyı kullanıcıya gönderin. Bu bağlantı 24 saat geçerlidir ve
            kullanıcının oturum açmasına izin verir.
          </p>
          <div className="flex gap-2 mt-2">
            <Input readOnly value={resetLink ?? ''} className="text-xs" />
            <Button variant="outline" size="sm" onClick={() => {
              navigator.clipboard.writeText(resetLink ?? '');
              toast({ title: 'Kopyalandı' });
            }}>Kopyala</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetLink(null)}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Main content ─────────────────────────────────────────── */}
      <Tabs defaultValue="users">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="users">Kullanıcılar</TabsTrigger>
            <TabsTrigger value="invitations">Davetler</TabsTrigger>
          </TabsList>
          <Button size="sm" className="gap-1.5" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4" />
            Kullanıcı Davet Et
          </Button>
        </div>

        {/* ── Users tab ─────────────────────────────────────────── */}
        <TabsContent value="users">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Aktif Kullanıcılar
                {usersQuery.isSuccess && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">({users.length})</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {usersQuery.isLoading ? (
                <div className="p-6 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kullanıcı</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Durum</TableHead>
                        <TableHead>Son Giriş</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Kullanıcı bulunamadı</TableCell>
                        </TableRow>
                      )}
                      {users.map(user => {
                        const isSelf = !!myClerkUserId && user.clerkUserId === myClerkUserId;
                        const isLastSA = user.role === 'super_admin' && user.isActive && activeSuperAdminCount <= 1;

                        return (
                          <TableRow key={user.id}>
                            {/* ── User identity ── */}
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={user.imageUrl ?? undefined} />
                                  <AvatarFallback className="text-xs">{initials(user.name, user.email)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="font-medium text-sm truncate">
                                    {user.name || '—'}
                                    {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(Siz)</span>}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">{user.email || '—'}</div>
                                </div>
                              </div>
                            </TableCell>

                            {/* ── Role dropdown ── */}
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Select
                                      value={user.role}
                                      onValueChange={v => patchUser.mutate({ clerkUserId: user.clerkUserId, data: { role: v } })}
                                      disabled={isSelf || patchUser.isPending}
                                    >
                                      <SelectTrigger className="w-38 h-8 text-xs" data-testid={`role-${user.id}`}>
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {VALID_ROLES.map(r => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                  </span>
                                </TooltipTrigger>
                                {isSelf && <TooltipContent>Kendi rolünüzü değiştiremezsiniz</TooltipContent>}
                              </Tooltip>
                            </TableCell>

                            {/* ── Status badge ── */}
                            <TableCell>
                              {user.isActive
                                ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-0 text-xs">Aktif</Badge>
                                : <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-0 text-xs">Pasif</Badge>
                              }
                            </TableCell>

                            {/* ── Last sign-in ── */}
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDate(user.lastSignInAt)}
                            </TableCell>

                            {/* ── Actions menu ── */}
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">

                                  {/* Deactivate / Reactivate */}
                                  {!isSelf && !isLastSA && (
                                    <DropdownMenuItem
                                      onClick={() => patchUser.mutate({ clerkUserId: user.clerkUserId, data: { isActive: !user.isActive } })}
                                      className={user.isActive ? 'text-orange-600' : 'text-green-600'}
                                    >
                                      {user.isActive
                                        ? <><UserX className="w-4 h-4 mr-2" />Devre Dışı Bırak</>
                                        : <><UserCheck className="w-4 h-4 mr-2" />Etkinleştir</>
                                      }
                                    </DropdownMenuItem>
                                  )}

                                  {/* Revoke sessions */}
                                  {!isSelf && (
                                    <DropdownMenuItem
                                      onClick={() => revokeSessions.mutate(user.clerkUserId)}
                                    >
                                      <ShieldOff className="w-4 h-4 mr-2" />
                                      Oturumları Kapat
                                    </DropdownMenuItem>
                                  )}

                                  {/* Password reset link */}
                                  {!isSelf && (
                                    <DropdownMenuItem onClick={() => passwordResetMutation.mutate(user.clerkUserId)}>
                                      <KeyRound className="w-4 h-4 mr-2" />
                                      Şifre Sıfırlama Bağlantısı
                                    </DropdownMenuItem>
                                  )}

                                  {/* Disabled self-actions hint */}
                                  {isSelf && (
                                    <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                      Kendi hesabınız için işlem yapılamaz
                                    </DropdownMenuItem>
                                  )}

                                  {!isSelf && isLastSA && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                        Son aktif süper yönetici devre dışı bırakılamaz
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Invitations tab ───────────────────────────────────── */}
        <TabsContent value="invitations">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Davetler
                {invitesQuery.isSuccess && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">({invitations.length})</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {invitesQuery.isLoading ? (
                <div className="p-6 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>E-posta</TableHead>
                        <TableHead>Rol</TableHead>
                        <TableHead>Durum</TableHead>
                        <TableHead>Gönderildi</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitations.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">Henüz davet gönderilmedi</TableCell>
                        </TableRow>
                      )}
                      {invitations.map(inv => {
                        const statusMeta = INVITE_STATUS_LABELS[inv.status] ?? { label: inv.status, className: '' };
                        const isPending = inv.status === 'pending';

                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="text-sm">{inv.emailAddress}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {inv.role ? ROLE_LABELS[inv.role as UserRole] ?? inv.role : '—'}
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-xs ${statusMeta.className}`}>{statusMeta.label}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDate(inv.createdAt)}
                            </TableCell>
                            <TableCell>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  {(isPending || inv.status === 'expired') && (
                                    <DropdownMenuItem onClick={() => resendInvite.mutate(inv.id)} disabled={resendInvite.isPending}>
                                      <RefreshCw className="w-4 h-4 mr-2" />
                                      Yeniden Gönder
                                    </DropdownMenuItem>
                                  )}
                                  {isPending && (
                                    <DropdownMenuItem
                                      className="text-red-600"
                                      onClick={() => revokeInvite.mutate(inv.id)}
                                      disabled={revokeInvite.isPending}
                                    >
                                      <UserX className="w-4 h-4 mr-2" />
                                      İptal Et
                                    </DropdownMenuItem>
                                  )}
                                  {!isPending && inv.status !== 'expired' && (
                                    <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                                      İşlem yapılamaz
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

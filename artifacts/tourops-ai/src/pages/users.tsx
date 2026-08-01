import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useProfile, ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';
import { customFetch } from '@workspace/api-client-react';

const BASE = import.meta.env.BASE_URL ?? '/';
const API_BASE = BASE.endsWith('/') ? `${BASE}api` : `${BASE}/api`;

const VALID_ROLES: UserRole[] = ['admin', 'operations', 'guide', 'accounting'];

interface UserProfile {
  id: number;
  clerkUserId: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { role: myRole } = useProfile();
  const { userId: myClerkUserId } = useAuth();

  const { data: users, isLoading } = useQuery<UserProfile[]>({
    queryKey: ['users'],
    queryFn: () => customFetch<UserProfile[]>(`${API_BASE}/users`),
    enabled: myRole === 'admin',
  });

  const patchUser = useMutation({
    mutationFn: ({ clerkUserId, data }: { clerkUserId: string; data: { role?: string; isActive?: boolean } }) =>
      customFetch<UserProfile>(`${API_BASE}/users/${clerkUserId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'Kullanıcı güncellendi' });
    },
    onError: () => {
      toast({ title: 'Hata', description: 'Güncelleme başarısız', variant: 'destructive' });
    },
  });

  function handleRoleChange(clerkUserId: string, role: string) {
    patchUser.mutate({ clerkUserId, data: { role } });
  }

  function handleToggleActive(clerkUserId: string, currentlyActive: boolean) {
    patchUser.mutate({ clerkUserId, data: { isActive: !currentlyActive } });
  }

  return (
    <AppShell title="Kullanıcı Yönetimi">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kullanıcılar</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ad</TableHead>
                    <TableHead>E-posta</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="w-36">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(users ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Kullanıcı bulunamadı
                      </TableCell>
                    </TableRow>
                  )}
                  {(users ?? []).map(user => {
                    const isSelf = user.clerkUserId === myClerkUserId;
                    return (
                      <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                        <TableCell className="font-medium">{user.name ?? '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onValueChange={v => handleRoleChange(user.clerkUserId, v)}
                            disabled={isSelf || patchUser.isPending}
                          >
                            <SelectTrigger className="w-36 h-8 text-xs" data-testid={`select-role-${user.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {VALID_ROLES.map(r => (
                                <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {user.isActive ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-0">Aktif</Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 hover:bg-red-100 border-0">Pasif</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant={user.isActive ? 'outline' : 'default'}
                            className="h-7 text-xs"
                            disabled={isSelf || patchUser.isPending}
                            onClick={() => handleToggleActive(user.clerkUserId, user.isActive)}
                            data-testid={`button-toggle-active-${user.id}`}
                          >
                            {user.isActive ? 'Devre Dışı' : 'Etkinleştir'}
                          </Button>
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
    </AppShell>
  );
}

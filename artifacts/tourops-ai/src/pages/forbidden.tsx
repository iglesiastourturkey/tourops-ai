import { useLocation } from 'wouter';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useProfile } from '@/contexts/ProfileContext';

/** Returns the appropriate home path for the role, never /forbidden. */
function homePathForRole(role: string | null): string {
  if (role === 'guide') return '/operations';
  return '/dashboard';
}

export default function ForbiddenPage() {
  const { role, isLoading } = useProfile();
  const [, navigate] = useLocation();

  // Do not derive a destination until the profile has loaded — prevents redirect
  // loops where null role resolves to /dashboard and the user bounces back here.
  const homePath = isLoading ? null : homePathForRole(role);

  function handleBack() {
    if (homePath) navigate(homePath);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-10 pb-10 flex flex-col items-center text-center gap-4">
          <div className="rounded-full bg-destructive/10 p-4">
            <Lock className="w-10 h-10 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Yetkisiz Erişim</h1>
          <p className="text-muted-foreground text-sm">
            Bu sayfaya erişim yetkiniz bulunmamaktadır.
          </p>
          <Button
            variant="outline"
            className="mt-2"
            disabled={isLoading}
            onClick={handleBack}
          >
            {role === 'guide' ? 'Operasyonlara Dön' : 'Kontrol Paneline Dön'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { Link } from 'wouter';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ForbiddenPage() {
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
          <Link href="/dashboard">
            <Button variant="outline" className="mt-2">Kontrol Paneline Dön</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

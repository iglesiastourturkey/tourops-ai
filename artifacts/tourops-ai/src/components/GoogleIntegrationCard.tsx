import type { ReactNode } from 'react';
import { RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { GoogleIntegration, GoogleConnectionStatus } from '@/lib/reservation-api';

type Props = {
  integration: GoogleIntegration;
  title: string;
  description: string;
  icon: ReactNode;
  scope: string;
  connection: GoogleConnectionStatus['connection'];
  configured: boolean;
  pending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Henüz erişim yapılmadı';
}

export function GoogleIntegrationCard({ integration, title, description, icon, scope, connection, configured, pending, onConnect, onDisconnect }: Props) {
  const connected = connection?.status === 'connected' && connection.grantedScopes.includes(scope);
  const integrationName = integration === 'gmail' ? 'Gmail' : 'Google Drive';
  return (
    <Card data-testid={`card-google-${integration}`}>
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[#0B1F3A]"><span className="rounded-md bg-primary/10 p-2 text-primary">{icon}</span><CardTitle className="text-base">{title}</CardTitle></div>
          <Badge variant={connected ? 'default' : 'secondary'}>{connected ? 'Bağlı' : 'Bağlı Değil'}</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p><span className="text-muted-foreground">Google hesabı:</span> <strong>{connection.googleAccountEmail ?? 'Bağlı hesap'}</strong></p>
            <p><span className="text-muted-foreground">İzin:</span> <span className="break-all text-xs">{scope}</span></p>
            {integration === 'drive' && <p><span className="text-muted-foreground">Erişim:</span> {connection.driveAccessSummary ?? 'Uygulamanın oluşturduğu veya seçtiğiniz dosyalar'}</p>}
            <p><span className="text-muted-foreground">Son başarılı erişim:</span> {formatDate(connection.lastSuccessfulAccessAt)}</p>
            {connection.lastError && <p className="text-destructive">{connection.lastError}</p>}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <ShieldCheck className="mb-2 h-4 w-4 text-primary" />
            Yalnızca gerekli {integrationName} izni istenir. Hesap parolası ve erişim belirteçleri hiçbir zaman bu ekranda gösterilmez.
          </div>
        )}
        {connected ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onConnect} disabled={pending} className="gap-1.5" data-testid={`button-refresh-google-${integration}`}><RefreshCw className="h-4 w-4" />Bağlantıyı Yenile</Button>
            <Button variant="destructive" onClick={onDisconnect} disabled={pending} className="gap-1.5" data-testid={`button-disconnect-google-${integration}`}><Unplug className="h-4 w-4" />Bağlantıyı Kes</Button>
          </div>
        ) : (
          <Button onClick={onConnect} disabled={!configured || pending} data-testid={`button-connect-google-${integration}`}>
            {pending ? 'Yönlendiriliyor...' : `${integrationName}'ı Bağla`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
import { Inbox, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { MicrosoftConnectionStatus } from '@/lib/reservation-api';

const OUTLOOK_SCOPE = 'https://graph.microsoft.com/Mail.Read';

type Props = {
  connection: MicrosoftConnectionStatus['connection'];
  configured: boolean;
  pending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Henüz erişim yapılmadı';
}

export function OutlookIntegrationCard({ connection, configured, pending, onConnect, onDisconnect }: Props) {
  const connected = connection?.status === 'connected' && connection.grantedScopes.includes(OUTLOOK_SCOPE);
  return (
    <Card data-testid="card-outlook">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-[#0B1F3A]"><span className="rounded-md bg-primary/10 p-2 text-primary"><Inbox className="h-5 w-5" /></span><CardTitle className="text-base">Outlook Rezervasyon Bağlantısı</CardTitle></div>
          <Badge variant={connected ? 'default' : 'secondary'}>{connected ? 'Bağlı' : 'Bağlı Değil'}</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">TourPilot kategorili rezervasyon e-postalarını okumak ve sisteme aktarmak için Outlook hesabınızı bağlayın.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <p><span className="text-muted-foreground">Microsoft hesabı:</span> <strong>{connection.microsoftAccountEmail ?? 'Bağlı hesap'}</strong></p>
            <p><span className="text-muted-foreground">İzin:</span> <span className="break-all text-xs">{OUTLOOK_SCOPE}</span></p>
            <p><span className="text-muted-foreground">Son başarılı erişim:</span> {formatDate(connection.lastSuccessfulAccessAt)}</p>
            {connection.lastError && <p className="text-destructive">{connection.lastError}</p>}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            <ShieldCheck className="mb-2 h-4 w-4 text-primary" />
            Yalnızca gerekli Outlook izni istenir. Hesap parolası ve erişim belirteçleri hiçbir zaman bu ekranda gösterilmez.
          </div>
        )}
        {connected ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onConnect} disabled={pending} className="gap-1.5" data-testid="button-refresh-outlook"><RefreshCw className="h-4 w-4" />Bağlantıyı Yenile</Button>
            <Button variant="destructive" onClick={onDisconnect} disabled={pending} className="gap-1.5" data-testid="button-disconnect-outlook"><Unplug className="h-4 w-4" />Bağlantıyı Kes</Button>
          </div>
        ) : (
          <Button onClick={onConnect} disabled={!configured || pending} data-testid="button-connect-outlook">
            {pending ? 'Yönlendiriliyor...' : "Outlook'u Bağla"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

import { AppShell } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import {
  CircleAlert,
  Clock3,
  Loader2,
  Mail,
  MessageSquareText,
  Send,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import {
  type CommunicationWorkflowStatus,
  useCommunicationsStatus,
} from '@/lib/communications-api';

const moduleDefinitions = [
  {
    key: 'whatsapp-tour-sales',
    name: 'WhatsApp Tour Sales Assistant',
    description: 'Gelen tur talepleri ve satış konuşmaları için çalışma alanı.',
    icon: MessageSquareText,
  },
  {
    key: 'ai-remarketing',
    name: 'AI Remarketing & Customer Reactivation',
    description: 'İzinli müşteri segmentleri ve onaylı yeniden pazarlama taslakları.',
    icon: Mail,
  },
] as const;

const statusLabels: Record<CommunicationWorkflowStatus, string> = {
  not_connected: 'Bağlantı hazırlanıyor',
  running: 'Çalışıyor',
  succeeded: 'Başarılı',
  failed: 'Hata',
  pending_approval: 'Onay bekliyor',
};

const statusClasses: Record<CommunicationWorkflowStatus, string> = {
  not_connected: 'bg-secondary text-secondary-foreground',
  running: 'bg-blue-100 text-blue-800',
  succeeded: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  pending_approval: 'bg-amber-100 text-amber-800',
};

function formatEventTime(value: string | null) {
  if (!value) return 'Henüz olay alınmadı';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function CommunicationsPage() {
  const { data, isLoading, isError } = useCommunicationsStatus();
  const totals = data?.totals ?? { pendingApprovals: 0, openErrors: 0, processed: 0 };

  return (
    <AppShell title="İletişim & Otomasyonlar">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5" data-testid="communications-readonly-notice">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold text-amber-950">Güvenli salt-okunur mod</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Mesaj gönderimi, workflow kontrolü ve müşteri verisi değişikliği kapalıdır.
                Bu ekran yalnızca imzalı n8n durum özetlerini gösterir.
              </p>
              <p className="mt-2 text-xs text-amber-800" data-testid="communications-integration-mode">
                {isLoading
                  ? 'Entegrasyon durumu kontrol ediliyor…'
                  : isError
                    ? 'Durum servisine şu anda ulaşılamıyor.'
                    : data?.message ?? 'Entegrasyon güvenlik nedeniyle kapalı.'}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3" aria-label="İletişim merkezi özeti">
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground"><Clock3 className="h-4 w-4" />Bekleyen onay</div>
            <p className="mt-3 text-3xl font-semibold" data-testid="communications-pending-count">{totals.pendingApprovals}</p>
            <p className="mt-1 text-sm text-muted-foreground">İnsan onayı gerektiren taslaklar</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground"><CircleAlert className="h-4 w-4" />Açık hata</div>
            <p className="mt-3 text-3xl font-semibold" data-testid="communications-error-count">{totals.openErrors}</p>
            <p className="mt-1 text-sm text-muted-foreground">Workflow durum özetleri</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground"><Send className="h-4 w-4" />İşlenen kayıt</div>
            <p className="mt-3 text-3xl font-semibold" data-testid="communications-processed-count">{totals.processed}</p>
            <p className="mt-1 text-sm text-muted-foreground">Mesaj gönderme yetkisi yok</p>
          </div>
        </section>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Durumlar yükleniyor…
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-2" aria-label="Otomasyon modülleri">
          {moduleDefinitions.map(({ key, name, description, icon: Icon }) => {
            const live = data?.workflows.find(item => item.key === key);
            const status: CommunicationWorkflowStatus = live?.status ?? 'not_connected';

            return (
              <article key={key} className="rounded-xl border bg-card p-5" data-testid={key === 'whatsapp-tour-sales' ? 'communications-whatsapp-module' : 'communications-remarketing-module'}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3">
                    <div className="rounded-lg bg-primary/10 p-2.5 text-primary"><Icon className="h-5 w-5" /></div>
                    <div>
                      <h2 className="font-semibold">{name}</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>
                  </div>
                  <Badge className={statusClasses[status]}>{statusLabels[status]}</Badge>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Son olay</dt>
                    <dd className="mt-1 font-medium">{formatEventTime(live?.lastEventAt ?? null)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Son başarılı çalışma</dt>
                    <dd className="mt-1 font-medium">{formatEventTime(live?.lastSuccessAt ?? null)}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
                  <Workflow className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{live?.summary ?? 'İmzalı n8n durum olayı bekleniyor.'}</span>
                </div>
              </article>
            );
          })}
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Güvenlik sınırları</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Yalnızca allowlist edilmiş iki workflow durum olayı gönderebilir.</li>
            <li>İmzasız, eski, yanlış tenant veya duplicate olaylar reddedilir/tekilleştirilir.</li>
            <li>Outbound WhatsApp/e-posta ve workflow başlatma/durdurma bu fazda yoktur.</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

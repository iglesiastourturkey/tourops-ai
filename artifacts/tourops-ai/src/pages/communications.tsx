import { AppShell } from '@/components/AppShell';
import { Badge } from '@/components/ui/badge';
import { MessageSquareText, Mail, ShieldCheck, Clock3, Send, Workflow, CircleAlert } from 'lucide-react';

const modules = [
  {
    title: 'WhatsApp Tour Sales Assistant',
    description: 'Gelen tur talepleri ve satış konuşmaları için çalışma alanı.',
    icon: MessageSquareText,
    status: 'Bağlantı hazırlanıyor',
  },
  {
    title: 'AI Remarketing & Customer Reactivation',
    description: 'İzinli müşteri segmentleri ve onaylı yeniden pazarlama taslakları.',
    icon: Mail,
    status: 'Bağlantı hazırlanıyor',
  },
] as const;

export default function CommunicationsPage() {
  return (
    <AppShell title="İletişim & Otomasyonlar">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5" data-testid="communications-readonly-notice">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-semibold text-amber-950">Güvenli başlangıç modu</h2>
              <p className="mt-1 text-sm leading-6 text-amber-900">
                Bu merkez şu anda yalnızca görünürlük ve kontrol içindir. Mesaj gönderimi,
                n8n webhook bağlantısı ve müşteri verisi değişikliği kapalıdır.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3" aria-label="İletişim merkezi özeti">
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground"><Clock3 className="h-4 w-4" />Bekleyen onay</div>
            <p className="mt-3 text-3xl font-semibold" data-testid="communications-pending-count">0</p>
            <p className="mt-1 text-sm text-muted-foreground">Gönderim özelliği kapalı</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground"><CircleAlert className="h-4 w-4" />Açık hata</div>
            <p className="mt-3 text-3xl font-semibold" data-testid="communications-error-count">0</p>
            <p className="mt-1 text-sm text-muted-foreground">Henüz entegrasyon verisi yok</p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground"><Send className="h-4 w-4" />Gönderim durumu</div>
            <p className="mt-3 text-lg font-semibold">Kapalı</p>
            <p className="mt-1 text-sm text-muted-foreground">İnsan onayı olmadan gönderim yapılmaz</p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2" aria-label="Otomasyon modülleri">
          {modules.map(({ title, description, icon: Icon, status }) => (
            <article key={title} className="rounded-xl border bg-card p-5" data-testid={title.startsWith('WhatsApp') ? 'communications-whatsapp-module' : 'communications-remarketing-module'}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <div className="rounded-lg bg-primary/10 p-2.5 text-primary"><Icon className="h-5 w-5" /></div>
                  <div>
                    <h2 className="font-semibold">{title}</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                  </div>
                </div>
                <Badge variant="secondary">{status}</Badge>
              </div>
              <div className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
                <Workflow className="h-4 w-4" />
                n8n bağlantısı bu ilk sürümde etkin değildir.
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Sonraki güvenli adımlar</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Salt-okunur n8n durum olaylarını imzalı webhook ile almak.</li>
            <li>İzin, opt-out, frekans ve duplicate kontrolünü kalıcılaştırmak.</li>
            <li>İnsan onaylı taslak gönderimlerini ayrı bir güvenlik turunda açmak.</li>
          </ol>
        </section>
      </div>
    </AppShell>
  );
}

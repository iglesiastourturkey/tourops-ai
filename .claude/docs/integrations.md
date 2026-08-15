# TourPilot Entegrasyonlar

## Şu an aktif
- **Clerk** — Auth/RBAC. CLERK_SECRET_KEY backend'de, CLERK_PUBLISHABLE_KEY frontend'de (VITE_ prefix'i ile). Şu an development mode key'leri kullanılıyor — Iglesias pilotundan önce production mode'a geçiş yapılacak (bkz. roadmap.md).
- **Google Cloud Storage** — Dosya/makbuz depolama. Service account JSON key (GCS_SERVICE_ACCOUNT_KEY env var), Replit sidecar bağımlılığı kaldırıldı. Bucket: tourpilot-prod-storage, region: europe-west3 (Frankfurt).
- **OpenRouter** — AI extraction/özet çağrıları. Sadece backend üzerinden (artifacts/api-server/src/routes/ai.ts), client-side'a asla key sızdırılmaz.

## Planlanan (Master Plan Faz 2-3)
- **Microsoft Outlook/Graph** — Rezervasyon e-postalarını çekmek için. OAuth, manuel tarama ile başlayacak, message ID dedupe.
- **Google Workspace (Sheets)** — 2027 test kopyası üzerinde shadow-mode yazma. Formula/occupied-cell guard zorunlu, prod dosyaya asla test yazılmaz.
- **Viator / GetYourGuide** — Önce resmi API/partner erişimi denenecek, sonra email, browser automation en son çare.

## Genel ilke
Her yeni entegrasyonda: idempotency zorunlu, kritik dış yazma insan onayı gerektirir, secret'lar sadece env variable'larda tutulur.

## Viator Partner API (planlanan, henüz erişim yok)
- Spec dosyası: .claude/docs/integrations/viator/openapi.json
- Viator entegrasyonu yazılırken/gözden geçirilirken bu dosya BİRİNCİL API
  sözleşmesi olarak kabul edilir. Viator endpoint'leri, parametreleri, event
  tipleri veya response alanları uydurulmaz — internetten tahmin edilmez.
- exp-api-key header'ı asla frontend'e sızdırılmaz, sadece backend env variable.
- Geliştirme sandbox ortamında yapılır.
- Durum: API key/hesap onayı henüz alınmadı, başvuru süreci sürüyor.

## GetYourGuide Connectivity (planlanan, henüz erişim yok)
- Viator gibi basit API-key modeli DEĞİL — Integrator Portal onayı gerekiyor.
- Durum: Başvuru henüz başlatılmadı.

## Reservation Ingestion Engine (mimari not — M4 öncesi karar bekliyor, henüz implementasyon yok)

Bu bölüm, M4 (Outlook Integration) gerçek mail taramasına başlamadan önce
netleşmesi gereken şema kararını somutlaştırır. Aşağıdaki tasarım bir
**öneridir** — kod yazılmadan önce gözden geçirilip onaylanmalı (bkz.
operations-rules.md: "Drizzle şema değişiklikleri asla otomatik/onaysız
çalıştırılmaz").

### Neden şimdi gerekiyor

`reservation_email_imports.connection_id` şu an sadece `google_connections`'a
FK'li (bkz. `lib/db/migrations/0008_manual_reservations.sql`). Outlook OAuth
bağlantı katmanı (`outlook_connections`, `lib/db/migrations/0011_outlook_connections.sql`)
zaten var, ama Outlook mail'lerini aynı inbox tablosuna düşürmenin önünde bu
FK belirsizliği duruyor: connection_id tek bir provider'a ait, iki farklı
tabloya aynı anda işaret edemez.

### Önerilen çözüm: reservation_email_imports'u manuel-giriş desenini izleyerek genişlet

0008 migration'ı zaten aynı problemi bir kez çözmüştü (connection_id ve
gmail_message_id'yi nullable yapıp `source` kolonuyla ayırt ederek). Aynı
deseni tekrarlamak, yeni bir polimorfik tablo icat etmekten daha güvenli ve
mevcut koda daha az dokunuyor:

- `outlook_connection_id` (nullable, `outlook_connections.id`'e FK) ve
  `outlook_message_id` / `outlook_conversation_id` (nullable) kolonları eklenir.
- Mevcut `connection_id` kolonu isim olarak değişmez (prod veriyi bozan bir
  rename'den kaçınmak için) ama artık fiilen "google_connection_id" anlamına
  gelir — kod yorumu bunu netleştirir.
- Yeni unique index: `(outlook_connection_id, outlook_message_id)` —
  mevcut `(connection_id, gmail_message_id)` index'inin eşleniği.
- `source` kolonu zaten serbest text; `'outlook'` değeri şema değişikliği
  gerektirmeden kullanılabilir.
- Alternatif değerlendirildi ve elendi: ayrı bir polimorfik
  `reservation_connections` tablosu (id, source, external_ref) daha "temiz"
  görünüyor ama sadece iki OAuth-tabanlı kaynak (Gmail, Outlook) için
  gereksiz bir soyutlama katmanı ekliyor — Viator/GYG API-key tabanlı, bu
  polimorfizme ihtiyaç duymuyor (bkz. altta).

### integration_sync_state tablosu

Viator/GYG gibi cursor/polling tabanlı kaynaklar için (Outlook manuel
taramada cursor kavramı yok, bu tablo öncelikle Viator/GYG'yi hedefliyor):
- Kolonlar: `provider`, `last_cursor`, `last_successful_sync_at`, `status`,
  `last_error`.
- Cursor sadece başarılı bir senkronizasyondan sonra ilerler — yarım kalan
  bir senkron cursor'ı ileri almaz, aynı sayfa bir daha denenir (idempotency).

### reservation_events tablosu

Booking lifecycle'ını (NEW/UPDATED/CANCELLED/AMENDED) izlemek için, mevcut
`reservation_email_imports` durumundan (new/pending_review/.../draft_created)
ayrı bir kavram — bir booking'in kaynaktaki değişim geçmişi, TourPilot
içindeki işlenme durumu değil. `source + externalBookingId` ikilisi
(normalize edilmiş booking reference — bkz.
`normalizeBookingReference` in reservation-validation.ts) dedupe anahtarı
olarak kullanılır, tıpkı M3'teki duplicate-booking-reference kontrolünün
yaptığı gibi.

### Değişmeyen ilkeler
- Otomatik-güvenli işlemler (inbox'a ekle, duplicate kontrol, draft
  hazırlama) vs. onay-gerektiren işlemler (email/WhatsApp gönderme, Sheet'e
  yazma, rehber/şoför kesin atama) ayrımı korunur — human-in-the-loop ilkesi.
- Ön koşul: Faz 0 tamamen bitmeden (Clerk production mode, domain migration)
  bu modüle başlanmaz — master plan'ın "gate" kuralı. Faz 0 artık tamamlandı
  (bkz. roadmap.md, Clerk production geçişi notu), bu ön koşul karşılandı.
- Ön koşul: Viator/GYG gerçek API erişimi onaylanmadan implementasyon
  başlamaz (mock/tahmin veri ile gerçek entegrasyon kodu yazılmaz). Bu koşul
  Outlook'u kapsamaz — Outlook OAuth erişimi zaten mevcut (Azure App
  Registration tamamlandı, bkz. `outlook-provider.ts`).

### M4 implementasyonu için ön koşul durumu (15 Ağustos 2026 itibarıyla)
- ✅ Outlook OAuth bağlantı katmanı kodlandı ve merge edildi
- ✅ Faz 0 tamamlandı
- ⬜ Yukarıdaki şema önerisi onaylanmadı — M4'e (gerçek mail tarama) başlamadan
  önce netleşmeli
- ⬜ Render staging'de gerçek "Outlook'a Bağlan" akışı uçtan uca test edilmedi

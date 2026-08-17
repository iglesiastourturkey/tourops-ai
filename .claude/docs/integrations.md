# TourPilot Entegrasyonlar

## Şu an aktif
- **Clerk** — Auth/RBAC. CLERK_SECRET_KEY backend'de, CLERK_PUBLISHABLE_KEY frontend'de (VITE_ prefix'i ile). Şu an development mode key'leri kullanılıyor — Iglesias pilotundan önce production mode'a geçiş yapılacak (bkz. roadmap.md).
- **Google Cloud Storage** — Dosya/makbuz depolama. Service account JSON key (GCS_SERVICE_ACCOUNT_KEY env var), Replit sidecar bağımlılığı kaldırıldı. Bucket: tourpilot-prod-storage, region: europe-west3 (Frankfurt).
- **OpenRouter** — AI extraction/özet çağrıları. Sadece backend üzerinden (artifacts/api-server/src/routes/ai.ts), client-side'a asla key sızdırılmaz.
- **Microsoft Outlook/Graph** — Rezervasyon e-postalarını çekmek için, Gmail ile aynı desende. OAuth bağlan + manuel tarama (`TourPilot` kategori filtresi), `microsoft_connections` + `reservation_email_imports` üzerinden message ID dedupe. Detay: aşağıdaki Reservation Ingestion Engine bölümü.

## Planlanan (Master Plan Faz 2-3)
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

## Reservation Ingestion Engine

### Outlook — TAMAMLANDI (17 Ağustos 2026)

Gmail'in OAuth-bağlan → manuel tara → dedupe-import deseni Outlook/Microsoft
Graph için uygulandı. İki paralel implementasyon geliştirilmişti (biri
Cowork'ten, biri bu oturumdan); Cowork'ün `outlook_connections` tablosu ve
`0011_outlook_connections.sql` migration'ı **hiç production'a uygulanmadığı**
için güvenle kaldırıldı, aşağıdaki implementasyon tutuldu:

- `microsoft_connections` tablosu (`lib/db/src/schema/microsoft.ts`) —
  `google_connections`'ın birebir eşleniği: `(profileId, provider)` unique,
  token'lar `credential-encryption.ts` ile şifreli.
- `reservation_email_imports`'a eklenen nullable kolonlar (0008'in manuel-giriş
  desenini izleyerek): `microsoft_connection_id` (FK → `microsoft_connections`),
  `outlook_message_id`, `outlook_conversation_id`, artı
  `(microsoft_connection_id, outlook_message_id)` üzerinde partial unique index
  — mevcut `(connection_id, gmail_message_id)` index'inin eşleniği. Mevcut
  Gmail kolonlarına dokunulmadı. `source` zaten serbest text; `'outlook'`
  değeri şema değişikliği gerektirmeden kullanılıyor.
- Migration: `lib/db/migrations/0011_microsoft_connections.sql` — hem staging
  hem production'da çalıştırıldı ve doğrulandı.
- Backend: `artifacts/api-server/src/lib/outlook-provider.ts` (Graph OAuth +
  `/me/mailFolders/inbox/messages` taraması, `TourPilot` kategori filtresi,
  SDK yok) ve `artifacts/api-server/src/routes/outlook.ts`
  (`GET /outlook-connection/callback`, `GET /outlook-connection`,
  `POST /outlook-connection/authorize`, `DELETE /outlook-connection`,
  `POST /outlook-scan`).
- Frontend: Ayarlar → Google Workspace sekmesinde Outlook kartı,
  Rezervasyonlar sayfasında "Outlook'u Tara" butonu.
- Bilinen kısıt: Microsoft, Google'ın `/oauth2/revoke`'una eşdeğer bir
  tek-refresh-token iptal endpoint'i sunmuyor — bağlantı kesme sadece yerel
  satırı siliyor.
- Kalan risk: gerçek Azure AD OAuth akışı tarayıcıda uçtan uca tıklanarak
  test edilmedi (typecheck/build seviyesinde doğrulandı) — Render'da gerçek
  tenant ile bir kez manuel doğrulanmalı.

### Viator / GetYourGuide — henüz implementasyon yok (API erişimi bekleniyor)

Aşağıdaki iki tablo Outlook'u değil, cursor/polling tabanlı Viator/GYG
kaynaklarını hedefliyor — Outlook'un manuel tarama modelinde cursor kavramı
yok, bu yüzden onun için gerekmiyor:

- **integration_sync_state**: `provider`, `last_cursor`,
  `last_successful_sync_at`, `status`, `last_error`. Cursor sadece başarılı
  bir senkronizasyondan sonra ilerler — yarım kalan senkron cursor'ı ileri
  almaz, aynı sayfa bir daha denenir (idempotency).
- **reservation_events**: booking lifecycle'ını (NEW/UPDATED/CANCELLED/AMENDED)
  izler — `reservation_email_imports` durumundan (new/pending_review/.../
  draft_created) ayrı bir kavram, bir booking'in kaynaktaki değişim geçmişi.
  `source + externalBookingId` (normalize edilmiş booking reference — bkz.
  `normalizeBookingReference` in reservation-validation.ts) dedupe anahtarı
  olacak, tıpkı M3'teki duplicate-booking-reference kontrolü gibi.

Ön koşul: Viator/GYG gerçek API erişimi onaylanmadan implementasyon başlamaz
(mock/tahmin veri ile gerçek entegrasyon kodu yazılmaz). Faz 0 tamamlandı,
bu koşul artık sadece Viator/GYG'ye bağlı.

### Değişmeyen ilkeler
- Otomatik-güvenli işlemler (inbox'a ekle, duplicate kontrol, draft
  hazırlama) vs. onay-gerektiren işlemler (email/WhatsApp gönderme, Sheet'e
  yazma, rehber/şoför kesin atama) ayrımı korunur — human-in-the-loop ilkesi.

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

## Reservation Ingestion Engine (mimari taslak, henüz implementasyon yok)
- Outlook + Viator + GYG üç ayrı kaynak değil, tek bir dedupe katmanından
  (source + externalBookingId eşleştirmesi) geçecek.
- integration_sync_state tablosu: provider, lastCursor, lastSuccessfulSync,
  status, lastError — cursor sadece başarılı işlemden sonra ilerler.
- reservation_events tablosu: booking lifecycle (NEW/UPDATED/CANCELLED/AMENDED).
- Otomatik-güvenli işlemler (inbox'a ekle, duplicate kontrol, draft hazırlama)
  vs. onay-gerektiren işlemler (email/WhatsApp gönderme, Sheet'e yazma,
  rehber/şoför kesin atama) ayrımı korunur — human-in-the-loop ilkesi.
- Ön koşul: Faz 0 tamamen bitmeden (Clerk production mode, domain migration)
  bu modüle başlanmaz — master plan'ın "gate" kuralı.
- Ön koşul: Viator/GYG gerçek API erişimi onaylanmadan implementasyon
  başlamaz (mock/tahmin veri ile gerçek entegrasyon kodu yazılmaz).

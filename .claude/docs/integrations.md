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

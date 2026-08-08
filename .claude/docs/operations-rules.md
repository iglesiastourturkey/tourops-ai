# TourPilot Operasyon Kuralları

## Deployment
- main branch → otomatik deploy (Vercel frontend, Render backend)
- Her büyük değişiklik önce Neon staging branch'te test edilir, production branch'e sonra uygulanır
- Drizzle şema değişiklikleri (drizzle-kit push) asla otomatik/onaysız çalıştırılmaz

## Git
- Production secret hiçbir zaman commit edilmez, prompt'a yapıştırılmaz, loglanmaz
- Her büyük modül ayrı feature branch'te geliştirilir
- Commit öncesi git diff incelenir: secret, debug log, ilgisiz değişiklik taraması yapılır

## Test/Onay akışı
- Yeni bir route/permission değişikliği → RBAC server-side'da test edilir, sadece UI'da gizlemek yeterli sayılmaz
- TypeScript + production build geçmeden "tamamlandı" denmez
- Staging deploy sonrası smoke test: login, dashboard, operation read, API health, PWA asset/service worker

## Replit kullanımı
- Sadece development/prototipleme için
- Production'a hiçbir bağımlılığı olmayacak şekilde tutulur
- Replit'teki DATABASE_URL (heliumdb) yalnızca local/dev amaçlıdır, Neon staging/production ile karıştırılmaz

## Kritik işlemler (human-in-the-loop zorunlu)
- Google Sheets'e yazma
- Resmi bildirim (U-ETDS)
- Ödeme/finansal kayıt
- Müşteriye giden otomatik mesaj gönderimi

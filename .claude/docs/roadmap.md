# TourPilot Roadmap

## Phase 0 — Infrastructure
- Vercel frontend
- Render API
- Neon staging/production DB
- GitHub CI
- Clerk environment cleanup

## Phase 1 — Reservation Core
1. Reservation Inbox
2. Reservation Review Center
3. Duplicate & Validation Engine

## Phase 2 — Sources and Intelligence
4. Outlook Integration
5. AI Reservation Extraction
6. Reservation Rules Engine
7. Viator / GetYourGuide

## Phase 3 — Google Sheets and Finance
8. Google Workspace Connection
9. Sheet Template Analyzer
10. Sheet Mapping + Preview
11. Safe Sheet Sync / Shadow Mode
12. Kasa Automation

## Phase 4 — Operations
13. Operation Workspace
14. Resource Planning
15. Daily Operations Center

## Phase 5 — Communication and Daily Execution
16. Communication Center
17. Tour List / Print Center
18. End-of-Day Center

## Phase 6 — Advanced
19. U-ETDS Preparation
20. AI Operations Assistant

Do not skip prerequisite modules without justification.# TourPilot Roadmap Notes

## Faz 0 sonrası, Iglesias pilotundan önce yapılacaklar

- [ ] Clerk'i Development mode'dan Production mode'a geçir
  - Clerk Dashboard → ilgili instance → Production key'lerine geç (sk_live_..., pk_live_...)
  - Render'da CLERK_SECRET_KEY güncelle
  - Vercel'de VITE_CLERK_PUBLISHABLE_KEY güncelle
  - Neden: development modunda invitation/reset e-postaları ve bot koruması gerçek kullanıcı senaryosuna uygun davranmayabilir
  - Ne zaman: gerçek Iglesias Tour kullanıcıları sisteme girmeden hemen önce

## PR-based feature branch akışına geçince değerlendirilecek

- [ ] Vercel Marketplace üzerinden Neon native entegrasyonunu bağla
  - Her Preview Deployment (her PR) için otomatik izole Neon branch oluşturur (copy-on-write)
  - DATABASE_URL otomatik Vercel env'e enjekte edilir, elle kopyalamaya gerek kalmaz
  - Neon-Managed seçeneğini tercih et (Vercel-Managed değil) — mevcut Neon hesabımız zaten var, faturalamayı ayrı tutmak daha temiz
  - Not: Bu entegrasyon Render'ı kapsamaz, backend-database bağlantısı (Render → Neon) her koşulda elle yönetilecek
  - Ne zaman: main'e doğrudan push yerine gerçek feature-branch + PR review akışına geçilince (master plan Bölüm 15)

## Clerk production geçişi — TAMAMLANDI (10 Ağustos 2026)

- tourpilot.com.tr artık canonical domain, www apex'e 301 yönleniyor
- Clerk production instance kuruldu, DNS doğrulandı (clerk./accounts./clkmail.tourpilot.com.tr)
- İlk süper admin hesabı (aydin254@gmail.com) production'da oluşturuldu,
  eski dev clerk_user_id yeni production ID'siyle güncellendi
- publishableKeyFromHost kaldırıldı — artık sabit VITE_CLERK_PUBLISHABLE_KEY
  kullanılıyor, host'a göre dinamik key üretimi yok

## Bilinen kısıt: tourops-ai.vercel.app artık auth yapamaz
- Clerk production instance, kendi domain'i dışındaki origin'leri reddediyor
  (origin_invalid) — bu Clerk'in platform kısıtı, Satellite Domains
  (ücretli) olmadan çözülemiyor
- Bilinçli karar: .vercel.app'i Preview environment'a taşıyıp backend'e
  dual-instance auth desteği eklemek yerine, sadece tourpilot.com.tr'nin
  canonical adres olması kabul edildi
- .vercel.app adresi artık sadece Vercel'in kendi deployment overview'unda
  teknik bir referans, kullanıcıya açık bir giriş noktası değil

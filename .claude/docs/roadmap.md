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

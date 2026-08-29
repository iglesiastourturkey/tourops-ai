# Faz 3D-A — Review-Gated Historical Promotion (Design + Implementation)

## Faz 3C doğrulanmış temel (değişmedi)

Faz 3C (`docs/HISTORICAL_MIGRATION_PHASE3C.md`) tamamlandı ve geçti:

- 24 workbook, 742 worksheet, 3540 aday.
- Faz 3B: 3519 `staging_ready`, 18 `manual_review`, 3 `blocked`.
- `historical_operation_imports` tablosu (migration `0019`) yalnızca dedicated
  Neon staging branch'inde (`historical-migration-stage`) doğrulandı:
  3519 satır `pending` durumunda, idempotent tekrar-çalıştırma ve
  farklı-içerikli-çakışma testleri geçti.
- Migration `0019` hiçbir yerde production'a uygulanmadı; bu Faz da
  uygulamıyor.

Faz 3D-A, bu 3519 `pending` satırı **toplu olarak** operasyona dönüştürmez.
Amaç, sadece açıkça onaylanmış küçük bir kontrollü örneklemi (ilk kabul
testinde 3 satır) tek tek, insan onaylı ve tam idempotent biçimde
operasyona taşıyan mekanizmayı kodlamak.

## State machine

```
pending  -> approved   (historical_migration.approve)
pending  -> rejected   (historical_migration.reject)
approved -> imported   (historical_migration.promote)
```

Yasak (server-side, `historicalImportTransitionBlock()` ile zorlanır —
`artifacts/api-server/src/lib/historical-migration-promote-validation.ts`):

```
pending  -> imported
rejected -> imported
imported -> approved
imported -> pending
imported -> rejected
```

Bu implementasyonda `rejected -> pending` (reopen) YOK. Gerekirse ayrı,
açıkça onaylı ve audit'lenen bir aksiyon olarak eklenir — asla sessiz bir
durum değişikliği olarak değil.

## RBAC

`artifacts/api-server/src/lib/seed-permissions.ts` içine eklenen dört
permission, varsayılan olarak yalnızca `admin` rolüne verilir:

- `historical_migration.review`
- `historical_migration.approve`
- `historical_migration.reject`
- `historical_migration.promote`

Mevcut `requirePermission()` middleware'i (`lib/auth.ts`) HTTP route'larda
server-side zorunlu kılar. CLI'ların hiçbir Clerk/HTTP oturum bağlamı yok,
bu yüzden `--operator-profile-id <id>` alıp aynı yetki politikasını DB'den
doğrudan uygulayan bir yardımcı eklendi:
`artifacts/api-server/src/lib/historical-migration-operator.ts` ->
`verifyOperatorPermission(profileId, module, action)`:

1. `profiles` tablosundan profili okur — yoksa `operator_not_found`.
2. `profile.isActive` kontrol edilir — pasifse `operator_inactive`.
3. Var olan `hasPermission()` (`lib/permissions.ts`) ile
   `role_permissions`/`user_permissions` DB verisi üzerinden yetki
   değerlendirilir — `super_admin` için aynı bypass, ikinci bir RBAC
   politikası icat edilmedi.

`approveHistoricalImport()`/`rejectHistoricalImport()` (approve/reject
için) ve `historical:promote --apply` (promote için) bu fonksiyonu
**herhangi bir DB yazmadan önce** çağırır ve başarısızsa erken döner —
`--operator-profile-id` sırf verildi diye güvenilmez.

## Alan eşlemesi (mapping)

Faz 3B payload'ından (`historical_operation_imports.payload`) yalnızca
gerçekten `operations` ve `operation_reservation_details` şemasında var olan
alanlara yazılır (`historical-migration-promote-validation.ts` ->
`buildPromotionProjectionFromStaging`):

| payload alanı | hedef |
|---|---|
| `idempotencyKey` | `operations.sourceHistoricalKey` |
| `operation.sourceType/sourceBookingReference/startDate/endDate/pickupTime/notes` | aynı isimli `operations` kolonları |
| `reservationDetails.*` | aynı isimli `operation_reservation_details` kolonları |
| `customer.fullName` | **hiçbir yere yazılmaz** (bkz. aşağı) |
| `warnings[]` | yazılmaz (yalnızca staging satırında kalır) |

`customerId`, `tourId`, `portCallId`, `tourProductId`, `guideResourceId`,
`driverResourceId`, `vehicleId` her zaman `null` yazılır — asla tahmin
edilmez, asla otomatik eşlenmez. Ham metin (`itineraryRaw`, `pickupPoint`,
`externalOperator` vb.) korunur.

## customerId = NULL garantisi

`operations.customerId` şema seviyesinde nullable (`onDelete: "set null"`,
`.notNull()` yok — bkz. `lib/db/src/schema/operations.ts`). Faz 3D-A'nın
promotion insert'i (`historical-migration-promote.ts` içindeki
`tx.insert(operationsTable).values({...})`) `customerId` alanını hiç
içermiyor, yani sütun DB default'u olan `NULL`'da kalıyor. Kod hiçbir yerde
`customersTable`'a dokunmuyor (bkz. odaklı testteki
`!/customersTable/.test(CLI)` kontrolü). Bu teknik olarak imkansız değildi —
tam tersine şema zaten bunu destekliyordu — bu yüzden STOP/blocker raporu
gerekmedi.

## promoted_content_sha256 / idempotency

Migration `0020` (oluşturuldu, **uygulanmadı**) `historical_operation_imports`
tablosuna nullable `promoted_content_sha256 TEXT` ekliyor (format check:
boşsa ya da `^[0-9a-f]{64}$`).

Akış (`historical-migration-promote.ts` -> `promoteOne`):

1. Staged payload'ın `payload_sha256`'sı yeniden hesaplanır ve saklanan
   değerle karşılaştırılır (`verifyStagedPayloadIntegrity`). Uyuşmazsa
   promotion reddedilir — Faz 3C sonrası değiştirilmiş bir satır asla
   promote edilmez.
2. `buildPromotionProjectionFromStaging` yalnızca gerçekten yazılan alanları
   içeren deterministik bir projeksiyon üretir (bkz. mapping tablosu).
3. Aynı `sourceHistoricalKey`'e sahip var olan bir `operations` satırı
   (+ `operation_reservation_details`) varsa, `buildPromotionProjectionFromExisting`
   ile aynı şekilde bir projeksiyon yeniden kurulur.
4. Her iki projeksiyon da aynı canonical-JSON + SHA-256 algoritmasıyla
   hash'lenir (`sha256OfProjection`).
   - Var olan yoksa -> **inserted**.
   - Var olan var ve hash eşleşiyorsa -> **existing** (idempotent no-op).
   - Var olan var ve hash farklıysa -> **conflict** (fail closed, asla
     üzerine yazılmaz).
5. Başarılı ilk promotion'da `promoted_content_sha256` staging satırına
   yazılır — sonraki her idempotent tekrar bu değeri değil, her seferinde
   yeniden hesaplanan projeksiyonu karşılaştırır (payload veya DB durumu
   arada değişmişse bunu da yakalar).

Son güvence her zaman DB seviyesinde kalıyor:
`operations_source_historical_key_idx` (migration `0019`, zaten doğrulandı).

## Transaction / atomicity

Her kayıt kendi transaction'ında (`db.transaction` içinde `promoteOne`):

1. `pg_advisory_xact_lock(2026, 4)` — Faz 3C staging'in `(2026, 3)`
   kilidinden kasıtlı olarak farklı bir anahtar.
2. Staging satırını `FOR UPDATE` kilitle.
3. Durum kontrolü (`approved` değilse -> `blocked`, DB'ye yazmadan döner).
4. Payload bütünlük kontrolü (başarısızsa `PromotionRollback` fırlatılır,
   transaction tamamen geri alınır).
5. Projeksiyon + hash.
6. Var olan operasyon kontrolü (`FOR UPDATE`).
7. Çakışma varsa `PromotionRollback` fırlatılır (tam rollback).
8. Yoksa: `operations` insert (+ race durumunda `onConflictDoNothing` +
   yeniden okuma) ve `operation_reservation_details` insert.
9. Staging satırı `imported` + `imported_operation_id` + `imported_at` +
   `promoted_content_sha256` ile güncellenir.
10. Audit satırı **aynı transaction içinde** yazılır (`createAuditLog(..., tx)`
    — bkz. aşağıdaki audit atomicity bölümü).
11. COMMIT.

Herhangi bir adım (payload bütünlüğü, çakışma, audit insert başarısızlığı)
başarısız olursa: o kaydın transaction'ı **tamamen** geri alınır. `catch`
bloğu, rollback sonrası `last_error`'ı ve best-effort bir audit olayını
**ayrı, kısa bir transaction'da** yazar (rollback olmuş transaction kendi
audit satırını tutamaz).

**Batch = per-record transaction, tek dev transaction değil.** Trade-off:
batch'in tamamı atomik değil (bir kayıt başarısız olsa da diğerleri commit
edilmiş kalır), ama bu kasıtlı — bir kaydın gerçek çakışması, 3518 iyi
promotion'ı geri almamalı. Faz 3C staging importunun aksine (orada tüm
paket tek transaction'dı, çünkü "ya hep ya hiç" doğru semantikti), Faz 3D-A
kaydı kayıt bazında bağımsız insan onaylı birimler olarak ele alıyor.

## Audit atomicity

`artifacts/api-server/src/lib/audit.ts`'deki `createAuditLog()` artık
opsiyonel bir `executor` parametresi alıyor (varsayılan: modül seviyesi
`db`). Var olan ~20+ çağıran hiçbir şey değiştirmeden best-effort davranışını
koruyor (hata yutulur, iş akışını asla bozmaz). Ancak bir çağıran açıkça
kendi `tx`'ini geçerse (`strict` mod), audit insert hatası **fırlatılır** ve
transaction'ı geri alır — Faz 3D-A promotion/approve/reject bunu kullanıyor,
böylece "audit satırı olmadan asla commit olmaz" garantisi gerçek.

Var olan audit_logs şeması ve `createAuditLog` **aynen** yeniden kullanıldı;
paralel bir log mimarisi eklenmedi.

## Migration 0020 (oluşturuldu, UYGULANMADI)

`lib/db/migrations/0020_historical_promotion_approval.sql` —
`historical_operation_imports` tablosuna:

- `approved_by_operator_id INTEGER REFERENCES profiles(id)`
- `approved_at TIMESTAMPTZ`
- `rejected_by_operator_id INTEGER REFERENCES profiles(id)`
- `rejected_at TIMESTAMPTZ`
- `rejection_reason TEXT`
- `imported_operation_id INTEGER REFERENCES operations(id)`
- `imported_at TIMESTAMPTZ`
- `last_error TEXT`
- `review_notes TEXT`
- `approval_version INTEGER NOT NULL DEFAULT 1`
- `promoted_content_sha256 TEXT` (+ format CHECK)

`profiles.id` ve `operations.id` her ikisi de `serial`/`integer` PK
(`lib/db/src/schema/profiles.ts`, `lib/db/src/schema/operations.ts`'de
doğrulandı) — bu yüzden FK'lar `INTEGER`. Yıkıcı hiçbir ifade yok, veri
yeniden yazımı yok. **Hiçbir ortama uygulanmadı** — ne Neon staging branch'e
ne production'a. Uygulama, ayrı bir açık onay gerektiriyor.

## CLI: `historical:review` (approve/reject, tek kayıt, operator zorunlu)

```
pnpm --filter @workspace/api-server historical:review -- \
  --source-key <key> --approve \
  --operator-profile-id <id> --confirm-review TOURPILOT_2026_HISTORICAL_REVIEW

pnpm --filter @workspace/api-server historical:review -- \
  --source-key <key> --reject --reason "<gerekce>" \
  --operator-profile-id <id> --confirm-review TOURPILOT_2026_HISTORICAL_REVIEW
```

- `historical_operation_imports`'u `pending` dışına çıkarabilen **tek**
  giriş noktası. Tam olarak bir `--source-key`, tam olarak
  `--approve`/`--reject`'ten biri — toplu onay/red yolu yok.
- `--reject` için boş olmayan `--reason` zorunlu.
- `--operator-profile-id` zorunlu; eksikse hiçbir DB bağlantısından önce
  hata verir.
- Yazma için tam `--confirm-review TOURPILOT_2026_HISTORICAL_REVIEW`
  zorunlu — bu kontrol de herhangi bir `@workspace/db` import'undan önce
  yapılır, yanlış/eksik ifadeyle sıfır yazma garantisi.
- `HISTORICAL_STAGING_DATABASE_URL` + `HISTORICAL_STAGING_DATABASE_HOST`
  zorunlu, `DATABASE_URL`'e fallback yok, host `.neon.tech` ile bitmeli ve
  URL'nin hostname'iyle bire bir eşleşmeli.
- `NODE_ENV=production` ise DB bağlantısından ÖNCE hard fail.
- Gerçek işi tekrar uygulamaz: `approveHistoricalImport()` /
  `rejectHistoricalImport()`'u doğrudan çağırır (bkz. aşağıdaki bölüm) —
  bu servisler kendi içlerinde operatörü ayrıca doğrular.

## CLI: `historical:promote`

```
pnpm --filter @workspace/api-server historical:promote -- \
  [--source-key <key> ...] [--limit <n>] \
  [--apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION \
   --operator-profile-id <id>]
```

- Varsayılan: **PLAN ONLY**, hiçbir yazma yok, **actor-free** (operator
  gerekmez — sadece staged durumu okur).
- `--apply` yazma için `--confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION`
  ile **birlikte** zorunlu (tam ifade).
- `--apply` modunda `--operator-profile-id <id>` **zorunlu** — eksikse
  `parseArgs()` herhangi bir DB bağlantısından önce hata verir. Gerçek bir
  promotion asla `null` actor ile yazılamaz (yalnızca PLAN actor-free
  kalabilir).
- Operator sırf verildi diye güvenilmez: `verifyOperatorPermission(operatorProfileId,
  "historical_migration", "promote")` batch başlamadan önce çağrılır — profil
  var mı, aktif mi, `historical_migration.promote` yetkisi var mı kontrol
  edilir (bkz. yukarıdaki RBAC bölümü). Başarısızsa hiçbir kayıt işlenmez.
- Doğrulanan `operatorProfileId`, her `promoteOne()` çağrısına aktarılır ve
  başarılı promotion + conflict/failure audit olaylarının ikisine de
  `actorProfileId` olarak yazılır — `null` actor ile gerçek bir promotion
  asla commit olmaz.
- `HISTORICAL_STAGING_DATABASE_URL` + `HISTORICAL_STAGING_DATABASE_HOST`
  zorunlu; host `.neon.tech` ile bitmeli ve URL'nin hostname'iyle bire bir
  eşleşmeli. **`DATABASE_URL`'e fallback yok.**
- `NODE_ENV=production` ise DB bağlantısından ÖNCE hard fail.
- `--apply` modunda `--source-key` veya `--limit`'ten en az biri zorunlu —
  hedefsiz/sınırsız bir apply reddedilir.
- `--limit` (veya tek seferde verilen `--source-key` sayısı) en fazla
  **25** olabilir (`MAX_APPLY_LIMIT`). Gerekçe: ilk staging kabul testi
  yalnızca `--limit 3` istiyor; 25, gerçekçi bir "insan tarafından
  gözden geçirilmiş tek oturumluk parti" büyüklüğünü kapsayacak kadar
  büyük, ama 3519'luk toplam kümenin yanında yanlışlıkla "hepsini promote
  et" riskini engelleyecek kadar küçük.

Plan çıktısı (databaseWrites her zaman false; sadece okur):

```json
{
  "mode": "historical-promotion-plan",
  "databaseWrites": false,
  "eligibleApproved": <n>,
  "pending": <n>,
  "rejected": <n>,
  "alreadyImported": <n>,
  "promotionBlocked": <n>,
  "existingOperations": <n>,
  "potentialConflicts": <n>,
  "requestedLimit": <n|null>,
  "selectedSourceKeys": ["legacy:...", ...],
  "requiresApplyConfirmation": true
}
```

PII yok — sadece sayaçlar ve zaten opak olan `sourceKey` provenance
kimlikleri (Faz 3C'nin kendi plan çıktısıyla aynı ilke).

## Approval / rejection servisleri

`artifacts/api-server/src/lib/historical-migration-approval.ts` —
`approveHistoricalImport()` / `rejectHistoricalImport()`. İkisi de:

- ilk adım olarak `verifyOperatorPermission()` ile operatörü doğrular
  (approve için `historical_migration.approve`, reject için
  `historical_migration.reject`) — başarısızsa satıra hiç dokunmadan
  erken döner,
- yalnızca `pending` durumundan çalışır (state machine),
- `FOR UPDATE` + `approval_version` compare-and-swap ile eşzamanlı
  onay/red yarışını engeller,
- `approved_by_operator_id`/`approved_at` (approve) veya
  `rejected_by_operator_id`/`rejected_at`/`rejection_reason` (reject)
  yazar,
- audit satırını aynı transaction'da yazar (strict mode), olay
  `actorProfileId` olarak operatörü taşır.

Tek route-agnostic entrypoint'leri `historical:review` CLI'sı —
mimari raporun onayladığı gibi CLI-first bir yaklaşım; bir HTTP route
eklenmesi ayrı bir karar.

## Faz 3C'ye dokunulmadı

`lib/db/migrations/0019_historical_operation_staging.sql`,
`historical-migration-stage.ts`, `historical-migration-stage-validation.ts`
ve `historical-migration-review.ts` bu fazda **değiştirilmedi**. Yeni kod
kasıtlı olarak kendi canonical-JSON/hash implementasyonunu taşıyor (Faz 3C
dosyalarından import etmiyor, sadece `HistoricalStagingRecord` tipini
type-only import ediyor) — böylece Faz 3C'nin zaten doğrulanmış davranışı
hiçbir şekilde riske girmiyor.

## Kabul prosedürü (SONRAKİ, AYRI ONAYLI ADIM — bu fazda ÇALIŞTIRILMADI)

Yalnızca dedicated Neon historical staging branch üzerinde, migration `0020`
ayrıca onaylanıp uygulandıktan sonra:

`<OPERATOR_ID>` aşağıda, staging DB'sinde gerçekten var olan, aktif ve
`historical_migration.{approve,promote}` (approve/promote için) veya
`historical_migration.reject` (reject için) yetkisine sahip bir admin
profilinin id'sini temsil eder — gerçek bir profil id'si bu belgeye
yazılmaz, komutlar çalıştırılırken yerine konur.

```bash
# 1-3. Uc kontrollu satiri tek tek onayla (KEY1/KEY2/KEY3 = gercek sourceKey'ler)
pnpm --filter @workspace/api-server historical:review -- \
  --source-key KEY1 --approve \
  --operator-profile-id <OPERATOR_ID> --confirm-review TOURPILOT_2026_HISTORICAL_REVIEW

pnpm --filter @workspace/api-server historical:review -- \
  --source-key KEY2 --approve \
  --operator-profile-id <OPERATOR_ID> --confirm-review TOURPILOT_2026_HISTORICAL_REVIEW

pnpm --filter @workspace/api-server historical:review -- \
  --source-key KEY3 --approve \
  --operator-profile-id <OPERATOR_ID> --confirm-review TOURPILOT_2026_HISTORICAL_REVIEW

# 4. PLAN (actor-free)
pnpm --filter @workspace/api-server historical:promote -- --limit 3

# 5. Ilk apply — beklenen inserted=3, existing=0
pnpm --filter @workspace/api-server historical:promote -- \
  --limit 3 --apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION \
  --operator-profile-id <OPERATOR_ID>

# 6. Ayni komutu tekrar calistir — beklenen inserted=0, existing=3
pnpm --filter @workspace/api-server historical:promote -- \
  --limit 3 --apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION \
  --operator-profile-id <OPERATOR_ID>

# 7. Kontrollu catisma: promote edilmis bir sourceKey'in payload'ini
#    (staging'de) kasitli degistir, tekrar apply et — beklenen conflict,
#    operasyon uzerine yazilmamali

# 8. Dogrulama: operations sayisi sadece 3 artti, historical satirlar
#    yalnizca bu 3'u icin imported, source_historical_key unique,
#    customers tablosuna hic yazma olmadi, audit_logs'ta approve/promote
#    olaylari <OPERATOR_ID> actorProfileId'siyle kayitli

# 9. pending bir satiri (henuz approve edilmemis) promote etmeyi dene
#    (--operator-profile-id ile birlikte) — beklenen blocked
# 10. rejected bir satiri promote etmeyi dene — beklenen blocked
# 11. yanlis --confirm-promotion ifadesiyle apply — beklenen hicbir yazma yok
# 12. --operator-profile-id olmadan apply — beklenen hicbir yazma yok, DB
#     baglantisindan once hata
# 13. var olmayan/yetkisiz bir --operator-profile-id ile apply veya review
#     — beklenen hicbir yazma yok, operator_not_found/operator_inactive/forbidden
# 14. NODE_ENV=production ile calistir (review ve promote icin ayri ayri)
#     — beklenen DB baglantisindan once hard fail
```

Bu adımların hepsi geçmeden geniş çaplı staging promotion düşünülmez.

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

Mevcut `requirePermission()` middleware'i (`lib/auth.ts`) server-side
zorunlu kılar; UI-only bir kontrol yok. Bu fazda bu permission'ları
kullanan bir route/UI eklenmedi — `historical-migration-approval.ts`
içindeki fonksiyonlar route-agnostic; bir route/CLI onlara `requirePermission`
arkasından çağrı yapmalı (sonraki, ayrı onaylı adım).

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

## CLI: `historical:promote`

```
pnpm --filter @workspace/api-server historical:promote -- \
  [--source-key <key> ...] [--limit <n>] \
  [--apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION]
```

- Varsayılan: **PLAN ONLY**, hiçbir yazma yok.
- `--apply` yazma için `--confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION`
  ile **birlikte** zorunlu (tam ifade).
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

- yalnızca `pending` durumundan çalışır (state machine),
- `FOR UPDATE` + `approval_version` compare-and-swap ile eşzamanlı
  onay/red yarışını engeller,
- audit satırını aynı transaction'da yazar (strict mode).

Bu fazda bunlara bağlı bir route/UI **yok** — mimari raporun onayladığı
gibi CLI-first bir yaklaşım; bir route eklenmesi ayrı bir karar.

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

```bash
# 1. 3 kontrollü satırı approve et (approveHistoricalImport() ile, script/route TBD)

# 2. PLAN
pnpm --filter @workspace/api-server historical:promote -- --limit 3

# 3. İlk apply — beklenen inserted=3, existing=0
pnpm --filter @workspace/api-server historical:promote -- \
  --limit 3 --apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION

# 4. Aynı komutu tekrar çalıştır — beklenen inserted=0, existing=3
pnpm --filter @workspace/api-server historical:promote -- \
  --limit 3 --apply --confirm-promotion TOURPILOT_2026_HISTORICAL_PROMOTION

# 5. Kontrollü çakışma: promote edilmiş bir sourceKey'in payload'ını
#    (staging'de) kasıtlı değiştir, tekrar apply et — beklenen conflict,
#    operasyon üzerine yazılmamalı

# 6. Doğrulama: operations sayısı sadece 3 arttı, historical satırlar
#    yalnızca bu 3'ü icin imported, source_historical_key unique,
#    customers tablosuna hiç yazma olmadı

# 7. pending bir satırı promote etmeyi dene — beklenen rejected/blocked
# 8. rejected bir satırı promote etmeyi dene — beklenen rejected/blocked
# 9. yanlış confirm-promotion ifadesiyle apply — beklenen hiçbir yazma yok
# 10. NODE_ENV=production ile çalıştır — beklenen DB bağlantısından önce hard fail
```

Bu adımların hepsi geçmeden geniş çaplı staging promotion düşünülmez.

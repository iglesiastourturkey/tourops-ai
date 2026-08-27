# Faz 3C — Neon Staging İdempotency Provası

## Amaç

Faz 3B `staging_ready` paketini önce ayrı bir review-gated tabloya idempotent biçimde almak. Bu faz müşteri veya operasyon oluşturmaz; muhasebe, mesaj ve Drive yazması yapmaz.

Bu PR'nin açılması veya merge edilmesi migration'ı otomatik çalıştırmaz; DDL ve staging provası ayrı, açık insan onayı gerektirir.

## DB tasarımı

`historical_operation_imports` yalnızca staging kuyruğudur:

- `source_key` benzersizdir.
- `(source_file_id, worksheet_name, source_row)` ayrıca benzersizdir.
- canonical payload SHA-256 saklanır.
- aynı `sourceKey` + aynı payload yeniden gelirse no-op olur.
- aynı `sourceKey` + farklı payload gelirse transaction tamamen iptal olur.
- kayıtlar `pending` başlar; onaysız operasyon oluşturulmaz.

`operations.source_historical_key` nullable eklenir ve benzersiz indekslenir. Bu alan Faz 3C'de yazılmaz; daha sonraki, ayrı onaylı operasyon-import fazında aynı legacy kaydın iki operasyon oluşturmasını DB seviyesinde engellemek içindir.

## Zorunlu güvenlik kapıları

- Migration `0019_historical_operation_staging.sql` otomatik uygulanmaz.
- Önce Neon staging branch üzerinde manuel uygulanır.
- Loader varsayılan olarak yalnızca plan üretir ve DB yazmaz.
- Yazma için `--apply` ve tam `--confirm-staging TOURPILOT_2026_HISTORICAL_STAGE` gerekir.
- Yalnızca `HISTORICAL_STAGING_DATABASE_URL` kullanılır.
- `HISTORICAL_STAGING_DATABASE_HOST` bağlantı URL'sindeki hostname ile bire bir eşleşmelidir.
- Host `.neon.tech` ile bitmelidir.
- `NODE_ENV=production` ise loader çalışmayı reddeder.
- Transaction advisory lock ile eşzamanlı ikinci yükleme engellenir.

## Plan modu

```bash
pnpm --filter @workspace/api-server historical:stage -- \
  --input ./historical-staging.json
```

## Neon staging provası

Migration staging üzerinde manuel uygulandıktan ve iki dedicated environment variable güvenli biçimde tanımlandıktan sonra:

```bash
pnpm --filter @workspace/api-server historical:stage -- \
  --input ./historical-staging.json \
  --apply \
  --confirm-staging TOURPILOT_2026_HISTORICAL_STAGE
```

İlk provada `inserted` staging-ready kayıt sayısına eşit olmalıdır. Aynı paket ikinci kez çalıştırıldığında `inserted: 0`, `existing` toplam kayıt sayısı olmalıdır. Farklı payload ile aynı sourceKey gönderilen negatif test transaction'ı iptal etmelidir.

Bu üç sonuç doğrulanmadan production migration veya operation/customer importu yapılmaz.

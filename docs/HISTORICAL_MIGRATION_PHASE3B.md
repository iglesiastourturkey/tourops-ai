# Faz 3B — Historical Review Package ve Staging Hazırlığı

## Onaylanan politika

- Eksik müşteri adı veya operasyon tarihi olan kayıtlar `blocked` olur.
- Olası tekrarlar `manual_review` olur ve staging paketine otomatik girmez.
- Booking ID üretilmez; `sourceKey` değişmeden idempotency anahtarı olarak kullanılır.
- Boş çocuk sayısı `0` yapılmaz, `null` korunur.
- Eksik GEMİ agency değeri tahmin edilmez, `null` korunur.
- Diğer eksik operasyon alanları staging kaydında uyarı olarak taşınır.

## Güvenlik sınırı

Faz 3B yalnızca yerel Faz 3A JSON raporunu okur ve isteğe bağlı olarak iki yerel JSON dosyası üretir:

- review package: yalnızca `blocked` ve `manual_review` kayıtları
- staging package: yalnızca `staging_ready` kayıtları

Araç veritabanına, Google Drive'a, webhook'a veya production servisine bağlanmaz. Staging paketi import değildir; her kayıtta `requiresHumanApproval: true` bulunur ve gerçek import için yeni bir açık onay gerekir.

Review ve staging dosyaları müşteri verisi içerebilir. Commit edilmemeli, paylaşılmamalı ve güvenli yerel konumda tutulmalıdır. Var olan dosyanın üzerine yazmak varsayılan olarak reddedilir.

## Çalıştırma

```bash
pnpm --filter @workspace/api-server historical:prepare -- \
  --input ./dry-run-report.json \
  --review-output ./historical-review.json \
  --staging-output ./historical-staging.json
```

Var olan iki çıktı bilinçli olarak yenilenecekse ayrıca `--overwrite` kullanılmalıdır. Girdi raporunun üzerine yazmak her durumda reddedilir.

## Staging eşlemesi

| Legacy alan | Hazırlanan alan | Kural |
|---|---|---|
| `sourceKey` | `idempotencyKey` | Aynen korunur |
| Booking ID yok | `sourceBookingReference` | `null`; değer uydurulmaz |
| müşteri adı | `customer.fullName` | Eksikse bloke |
| operasyon tarihi | `operation.startDate/endDate` | Eksikse bloke |
| pickup saati | `operation.pickupTime` | Eksikse `null` + uyarı |
| notlar | `operation.notes` | Ham değer korunur |
| yetişkin/çocuk | `reservationDetails.adultCount/childCount` | Boş değer `null` |
| dil | `reservationDetails.passengerLanguage` | Ham değer korunur |
| tur bölümü | `reservationDetails.itineraryRaw` | Ham değer korunur |
| agency/operator | `externalSource/externalOperator` | Tahmin edilmez |
| tahsilat | `collectionStatusRaw` | Yalnızca ham metadata; muhasebe kaydı oluşturmaz |

Faz 3B çıktılarının hazırlanması production veya staging DB importuna onay anlamına gelmez.

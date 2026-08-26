# Faz 3A — 2026 Historical Migration Dry-Run

## Karar

İlk kapsam yalnızca 2026 GEMİ ve SEJOUR aylık Excel çalışma kitaplarıdır. 2022–2025 arşivi, fiyat listeleri, müşteri e-posta listeleri, muhasebe takip dosyaları ve tur belgeleri bu fazın dışındadır.

## Güvenlik sınırı

- Araç yalnızca kullanıcının yerel olarak hazırladığı `.xlsx` / `.xlsm` kopyalarını okur.
- Google Drive, webhook, Neon veya başka bir ağ servisine bağlanmaz.
- Veritabanı importu yoktur.
- Varsayılan çıktı yalnızca PII içermeyen özet JSON'dur.
- Ayrıntılı aday raporu ancak açık `--output` parametresiyle yerel diske yazılır.
- Mevcut rapor dosyasının üzerine yazmak için ayrıca `--overwrite` gerekir.

## Manifest

```json
{
  "version": 1,
  "files": [
    {
      "path": "./GEMI/8.AY - AGUSTOS.xlsx",
      "sourceFileId": "GOOGLE_DRIVE_FILE_ID",
      "sourceKind": "gemi",
      "year": 2026,
      "month": 8
    }
  ]
}
```

`sourceFileId + worksheetName + sourceRow` birleşimi crosswalk anahtarıdır. Booking ID bulunmayan eski dosyalarda içerik parmak izi yalnızca olası duplicate uyarısı üretir; otomatik birleştirme yapmaz.

## Çalıştırma

```bash
pnpm --filter @workspace/api-server historical:dry-run -- --manifest ./manifest.json
pnpm --filter @workspace/api-server historical:dry-run -- --manifest ./manifest.json --output ./dry-run-report.json
```

Bu rapor onaylanmadan sonraki migration fazına geçilmez.

2026 gerçek veri dry-run politikaları onaylandıktan sonra review ve staging
hazırlığı için `HISTORICAL_MIGRATION_PHASE3B.md` akışı kullanılır. Faz 3B de
veritabanına import yapmaz ve ayrı import onay kapısını korur.

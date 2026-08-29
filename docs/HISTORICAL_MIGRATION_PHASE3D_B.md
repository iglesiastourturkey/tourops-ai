# Faz 3D-B — Historical Customer Resolution (Safety-First Design)

## Amaç

Faz 3D-A operasyon promotion mekanizmasını customer yazmadan ve `operations.customer_id = NULL` bırakarak güvenli biçimde tamamladı. Faz 3D-B'nin amacı, yalnızca kanıtı yeterli olan historical operasyonları mevcut müşteri kayıtlarıyla ilişkilendirmek veya gerektiğinde insan onaylı yeni müşteri oluşturma sürecine hazırlamaktır.

Bu faz **isim benzerliğine göre otomatik müşteri yaratmaz veya bağlamaz**. Historical payload bugün güvenilir biçimde `customer.fullName` taşıyor; mevcut `customers` tablosu ise `name`, `company`, `nationality`, `language`, `phone`, `email`, `whatsapp` ve diğer profil alanlarını içeriyor. İsim tek başına benzersiz kimlik değildir.

## Değişmez güvenlik kuralları

1. Production üzerinde hiçbir migration/apply yok; önce dedicated Neon staging.
2. Varsayılan mod PLAN / read-only.
3. `operations.customer_id` yalnızca açıkça hedeflenmiş tek kayıt veya küçük kontrollü batch için değişebilir.
4. Var olan non-null `operations.customer_id` asla sessizce overwrite edilmez.
5. Sadece ad/soyad fuzzy match ile otomatik link YOK.
6. Yeni customer insert, ayrı açık onay ve gerçek operator actor olmadan YOK.
7. Her write idempotent, audit'li ve transaction içinde olmalı.
8. Ambiguous veya yetersiz kanıt `manual_review` olarak kalır; tahmin edilmez.
9. `archived_at IS NOT NULL` customer otomatik aday olamaz.
10. Customer resolution, Faz 3D-A promotion projection/hash semantiğini geriye dönük değiştirmez.

## Faz 3D-B alt fazları

### 3D-B.1 — Resolver inventory + PLAN only

İlk teslimat yalnızca read-only resolver raporu üretir. Hiçbir customer/operation write yapmaz.

Her imported historical operation için normalize edilmiş historical ad ile aktif customers tablosundaki adaylar karşılaştırılır ve aşağıdaki sınıflardan biri üretilir:

- `exact_unique_name_candidate`: normalize edilmiş isim tam eşleşiyor ve yalnızca bir aktif customer var. Bu sadece **adaydır**, otomatik link değildir.
- `ambiguous_exact_name`: aynı normalize isimle birden fazla aktif customer var.
- `no_exact_name_candidate`: tam isim adayı yok.
- `already_linked`: operation zaten customer_id taşıyor; resolver write dışı bırakır.
- `invalid_or_blank_name`: historical isim resolution için yeterli değil.

Fuzzy similarity ilk alt fazda karar verici değildir. Gerekirse yalnızca yardımcı bilgi olarak rapora eklenebilir; otomatik eşleşme sebebi olamaz.

### 3D-B.2 — Human-reviewed link approval

B.1 raporu doğrulandıktan sonra ayrı onayla tek source key bazlı review/link mekanizması eklenebilir.

Önerilen permission'lar:

- `historical_migration.customer_review`
- `historical_migration.customer_link`

Link için zorunlular:

- exact source key
- exact customer id
- operator profile id
- confirmation phrase
- staging-only guard
- active customer verification
- operation.customer_id hala NULL kontrolü
- audit row aynı transaction içinde

Aynı source key + aynı customer id ikinci kez çalışırsa `existing` / no-op olmalı. Aynı source key farklı customer id ile tekrar denenirse `conflict` olmalı ve overwrite yapılmamalı.

### 3D-B.3 — New customer creation (ayrı karar)

Yeni customer oluşturma, mevcut müşteri linklemeden daha risklidir ve B.1/B.2 ile birlikte otomatik açılmaz.

Historical veride sadece isim varsa yeni customer yaratmak duplicate üretme riski taşır. Bu nedenle varsayılan politika:

- isim-only kayıtlarda otomatik customer create YOK;
- ancak insan onaylı tek kayıt akışı tasarlanırsa `customer_type='individual'` dışında hiçbir alan uydurulmaz;
- email/phone/whatsapp/nationality/language gibi alanlar kaynakta kanıt yoksa NULL kalır;
- create + operation link aynı transaction içinde olmalı;
- duplicate-risk kontrolü transaction öncesi ve transaction içinde yeniden doğrulanmalı.

Bu alt faz, B.1 acceptance sonucu görülmeden uygulanmayacak.

## Normalizasyon — B.1

Resolver için deterministik ve test edilebilir isim normalizasyonu kullanılmalı:

1. Unicode normalize (NFKC).
2. trim.
3. çoklu whitespace -> tek boşluk.
4. locale-independent lowercase.
5. Noktalama işaretleri kimlik kanıtı olarak kullanılmaz; ancak ilk implementasyonda agresif transliteration yapılmamalı.

Örnek olarak `"  JOHN   SMITH "` ve `"John Smith"` aynı normalize anahtarı üretmelidir.

Türkçe/diakritik karakterleri silmek veya Latinleştirmek ilk aşamada exact-match anahtarına dahil edilmez; bu dönüşümler farklı kişileri yanlış eşleştirebilir.

## B.1 beklenen çıktı

CLI önerisi:

```bash
pnpm --filter @workspace/api-server historical:customer-resolve -- \
  [--source-key <key> ...] [--limit <n>]
```

Varsayılan PLAN-only JSON özeti en az şunları vermeli:

```json
{
  "mode": "historical-customer-resolution-plan",
  "databaseWrites": false,
  "customerWrites": false,
  "operationWrites": false,
  "scanned": 0,
  "alreadyLinked": 0,
  "exactUniqueCandidates": 0,
  "ambiguousExactNames": 0,
  "noExactCandidate": 0,
  "invalidOrBlankName": 0,
  "selectedSourceKeys": []
}
```

Detay kayıtlarında source key, historical display name, normalized key ve candidate customer id/name listesi bulunabilir. Email/phone gibi PII alanları resolver için gerekli değilse log/output'a basılmamalı.

## B.1 acceptance kriterleri

- Unit/focused tests PASS.
- PLAN sırasında sıfır DB write kanıtı.
- imported 3 kontrollü örnek üzerinde staging PLAN.
- Aynı girdide deterministik sınıflandırma.
- Birden fazla exact customer bulunan fixture `ambiguous_exact_name` olur.
- Exact eşleşmeyen isim hiçbir customer'a otomatik bağlanmaz.
- Operation/customer count'ları PLAN öncesi/sonrası değişmez.
- Production guard korunur.

## Özellikle yapılmayacaklar

- Production apply.
- 3519 kayda toplu customer link.
- Levenshtein/Jaro-Winkler skoruna göre otomatik link.
- Sadece isimden email/telefon/nationality/language uydurma.
- Var olan customer kaydını historical veriyle update etme.
- Existing customer merge/deduplication.
- Faz 3D-A imported operation projection'ını overwrite etme.

## Sonraki uygulama adımı

İlk kod PR'ı yalnızca **Faz 3D-B.1 PLAN-only resolver** olmalı. B.1 staging acceptance geçmeden B.2 link-write veya B.3 customer-create kodlanmayacak.

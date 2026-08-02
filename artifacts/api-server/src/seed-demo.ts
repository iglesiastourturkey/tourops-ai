/**
 * TourPilot — Demo Seed Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Populates realistic Turkish travel agency data for demos, screenshots,
 * presentations, and beta testing.
 *
 * Usage:
 *   pnpm seed:demo          → insert demo data (idempotent, safe to re-run)
 *   pnpm seed:demo:reset    → remove ALL demo records (never touches real data)
 *
 * Safety mechanism:
 *   Every demo record carries the marker  [DEMO]  in its notes / description /
 *   message field. The reset script deletes only rows containing this marker.
 *   Records without the marker are never touched.
 */

import { db } from "@workspace/db";
import {
  profilesTable,
  customersTable,
  suppliersTable,
  toursTable,
  tourCostsTable,
  tourDaysTable,
  quotationsTable,
  operationsTable,
  operationTasksTable,
  operationReceiptsTable,
  accountingTransactionsTable,
  accountingDocumentsTable,
  accountingSettingsTable,
  agencySettingsTable,
  notificationsTable,
} from "@workspace/db/schema";
import { like, eq } from "drizzle-orm";

// ── Marker ────────────────────────────────────────────────────────────────────
const DEMO = "[DEMO]";

// ── Date helpers ──────────────────────────────────────────────────────────────
// Today: 2026-08-02. Last 6 months: 2026-02-01 → 2026-08-02
function daysAgo(n: number): string {
  const d = new Date("2026-08-02");
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n: number): string {
  const d = new Date("2026-08-02");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function tsAgo(days: number, hours = 0): Date {
  const d = new Date("2026-08-02T12:00:00Z");
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  console.log("🌱 TourPilot demo seed starting…\n");

  // ── Idempotency guard ────────────────────────────────────────────────────
  const [existing] = await db
    .select()
    .from(customersTable)
    .where(like(customersTable.notes, `%${DEMO}%`))
    .limit(1);
  if (existing) {
    console.log("ℹ️  Demo data already present. Run `pnpm seed:demo:reset` first to re-seed.");
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 0. DEMO SEED PROFILE (required for accounting FK constraints)
  // ═══════════════════════════════════════════════════════════════════════════
  const [seedProfile] = await db
    .insert(profilesTable)
    .values({
      clerkUserId: "demo_seed_admin_v1",
      email: "demo@tourpilot.com.tr",
      name: `Demo Yönetici ${DEMO}`,
      role: "admin",
      isActive: true,
    })
    .returning();
  const seedProfileId = seedProfile.id;
  console.log(`✓ Demo profile created (id=${seedProfileId})`);

  // Demo guide profile — assignedGuideUserId on operations matches this clerkUserId
  // so a test guide user can sign in and see their assigned operations via the guide mobile view.
  const DEMO_GUIDE_CLERK_ID = "demo_seed_guide_v1";
  await db
    .insert(profilesTable)
    .values({
      clerkUserId: DEMO_GUIDE_CLERK_ID,
      email: "rehber@tourpilot.com.tr",
      name: `Nilay Şahin ${DEMO}`,
      role: "guide",
      isActive: true,
    })
    .onConflictDoNothing();
  console.log(`✓ Demo guide profile created (clerkUserId=${DEMO_GUIDE_CLERK_ID})`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. AGENCY SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════
  const [existingAgency] = await db.select().from(agencySettingsTable);
  if (!existingAgency) {
    await db.insert(agencySettingsTable).values({
      name: "Ege Tur & Gezi Acentesi",
      address: "Atatürk Bulvarı No:45, Kuşadası, Aydın 09400",
      phone: "+90 256 614 0000",
      email: "info@egetur-gezi.com",
      website: "https://egetur.com",
      defaultCurrency: "EUR",
      defaultProfitMargin: 22,
      minProfitWarning: 10,
      defaultQuotationValidity: 7,
      cancellationPolicy:
        "Turdan 48 saat öncesine kadar ücretsiz iptal. Daha sonraki iptallerde %50 iade yapılmaz.",
      paymentTerms:
        "%30 ön ödeme ile rezervasyon onaylanır, kalan %70 tur başlangıcından 3 gün önce ödenir.",
      cruiseSafetyBufferMinutes: 45,
    });
  }

  // ── Accounting settings ──────────────────────────────────────────────────
  const [existingAccSettings] = await db.select().from(accountingSettingsTable);
  if (!existingAccSettings) {
    await db.insert(accountingSettingsTable).values({
      defaultCurrency: "TRY",
      fiscalYearStartMonth: 1,
      defaultVatRate: 20,
      vatRates: JSON.stringify(["0", "1", "8", "10", "20"]),
      paymentMethods: JSON.stringify([
        "Nakit",
        "Kredi Kartı",
        "Havale/EFT",
        "Çek",
        "Döviz",
      ]),
      documentNumberPrefix: "TRP",
      accountantNotes:
        "Tüm fatura ve makbuzlar operasyon bazında muhasebe sistemine işlenmelidir. KDV ayrıştırması zorunludur.",
    });
  }
  console.log("✓ Agency & accounting settings verified");

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CUSTOMERS (25)
  // ═══════════════════════════════════════════════════════════════════════════
  const customerRows = await db
    .insert(customersTable)
    .values([
      {
        name: "James Mitchell",
        company: null,
        nationality: "İngiliz",
        language: "İngilizce",
        phone: "+44 7700 900123",
        email: "james.mitchell@outlook.com",
        whatsapp: "+44 7700 900123",
        customerType: "vip",
        travelPreferences: "Tarihi yerler, yürüyüş, yerel mutfak. Lüks otel tercih ediyor.",
        dietaryRestrictions: null,
        passportStatus: "verified",
        notes: `Düzenli müşteri. MSC Cruises ile yılda 2 kez geliyor. ${DEMO}`,
      },
      {
        name: "Sarah Wilson",
        nationality: "İngiliz",
        language: "İngilizce",
        phone: "+44 7911 234567",
        email: "sarah.wilson@gmail.com",
        whatsapp: "+44 7911 234567",
        customerType: "individual",
        travelPreferences: "Plaj tatili, alışveriş, spa. 5 yıldızlı otel.",
        passportStatus: "received",
        notes: `Mayıs-Ekim arası İzmir hattını tercih ediyor. ${DEMO}`,
      },
      {
        name: "Hans Becker",
        company: "Becker & Partner GmbH",
        nationality: "Alman",
        language: "Almanca, İngilizce",
        phone: "+49 89 456789",
        email: "h.becker@becker-partner.de",
        customerType: "vip",
        travelPreferences: "Kültürel turlar, arkeoloji, müze. Almanca rehber şart.",
        passportStatus: "verified",
        notes: `Yıllık kurumsal grup. 20-25 kişi. ${DEMO}`,
      },
      {
        name: "Maria Rossi",
        nationality: "İtalyan",
        language: "İtalyanca, İngilizce",
        phone: "+39 06 12345678",
        email: "maria.rossi@email.it",
        customerType: "individual",
        travelPreferences: "Yemek kültürü, şarap, mimari. Küçük grup turu.",
        passportStatus: "not_requested",
        notes: `Şirince şarap turuna özel ilgi duyuyor. ${DEMO}`,
      },
      {
        name: "François Dubois",
        company: "Dubois Voyages",
        nationality: "Fransız",
        language: "Fransızca, İngilizce",
        phone: "+33 1 23456789",
        email: "f.dubois@duboisvoyages.fr",
        customerType: "corporate",
        travelPreferences: "Kültürel tur paketleri. Fransız rehber avantajlı.",
        passportStatus: "received",
        notes: `Paris çıkışlı gruplar için acente ortağı. ${DEMO}`,
      },
      {
        name: "Ahmet Kaya",
        company: "Kaya Tekstil A.Ş.",
        nationality: "Türk",
        language: "Türkçe",
        phone: "+90 532 111 2233",
        email: "ahmet.kaya@kayatekstil.com",
        customerType: "corporate",
        travelPreferences: "Yurt içi ekip gezileri, konaklama dahil paketler.",
        passportStatus: "not_requested",
        notes: `Yıllık şirket gezisi için irtibat. 30-40 kişi. ${DEMO}`,
      },
      {
        name: "Ayşe Demir",
        nationality: "Türk",
        language: "Türkçe",
        phone: "+90 536 222 3344",
        email: "ayse.demir@gmail.com",
        customerType: "individual",
        travelPreferences: "Doğa yürüyüşü, termal, sağlık turizmi.",
        passportStatus: "not_requested",
        notes: `Pamukkale termal konaklamasına özel ilgi. ${DEMO}`,
      },
      {
        name: "Emma Johnson",
        nationality: "Amerikalı",
        language: "İngilizce",
        phone: "+1 212 555 0101",
        email: "emma.j@yahoo.com",
        customerType: "vip",
        travelPreferences: "Lüks deneyimler, özel tekne, VIP rehber.",
        dietaryRestrictions: "Vejetaryen",
        passportStatus: "verified",
        notes: `Celebrity Cruises yolcusu. Bodrum excursion uzmanı. ${DEMO}`,
      },
      {
        name: "Robert Brown",
        nationality: "Avustralyalı",
        language: "İngilizce",
        phone: "+61 2 9876 5432",
        email: "rob.brown@gmail.com",
        customerType: "individual",
        travelPreferences: "Aktif tur, trekking, plaj. Bütçe dostu.",
        passportStatus: "received",
        notes: `Uzun süre konaklamalı paket araştırıyor. ${DEMO}`,
      },
      {
        name: "Elena Petrova",
        nationality: "Rus",
        language: "Rusça, İngilizce",
        phone: "+7 495 123 4567",
        email: "elena.petrova@mail.ru",
        customerType: "individual",
        travelPreferences: "Deniz tatili, alışveriş, lüks spa.",
        passportStatus: "received",
        notes: `Antalya-Bodrum güzergahını tercih ediyor. ${DEMO}`,
      },
      {
        name: "Carlos García",
        nationality: "İspanyol",
        language: "İspanyolca, İngilizce",
        phone: "+34 91 234 5678",
        email: "c.garcia@correo.es",
        customerType: "individual",
        travelPreferences: "Tarih, kültür, gastronomi. Baharatta yerel pazarlar.",
        passportStatus: "not_requested",
        notes: `İzmir ve Efes kombinasyon turu istedi. ${DEMO}`,
      },
      {
        name: "Ingrid Hansen",
        nationality: "Norveçli",
        language: "Norveçce, İngilizce",
        phone: "+47 22 123 456",
        email: "ingrid.hansen@online.no",
        customerType: "individual",
        travelPreferences: "Kültürel miras, fotoğrafçılık, yavaş seyahat.",
        passportStatus: "not_requested",
        notes: `Pergamon ve antik kentlere özel ilgi duyuyor. ${DEMO}`,
      },
      {
        name: "David Lee",
        company: "Lee Consulting",
        nationality: "Amerikalı",
        language: "İngilizce",
        phone: "+1 415 555 0202",
        email: "david.lee@leeconsulting.us",
        customerType: "corporate",
        travelPreferences: "Toplantı öncesi şehir turu, iş ağırlıklı. Lüks konaklama.",
        passportStatus: "verified",
        notes: `İzmir MICE müşterisi. Konferans grubu 12 kişi. ${DEMO}`,
      },
      {
        name: "Fatma Çelik",
        nationality: "Türk",
        language: "Türkçe",
        phone: "+90 554 333 4455",
        email: "fatma.celik@hotmail.com",
        customerType: "individual",
        travelPreferences: "Deniz tatili, çocuklu aile paketleri.",
        passportStatus: "not_requested",
        notes: `2 çocuk (7 ve 10 yaş). Yaz sezonu tur paketi. ${DEMO}`,
      },
      {
        name: "Mustafa Yıldız",
        nationality: "Türk",
        language: "Türkçe",
        phone: "+90 542 444 5566",
        email: "mustafa.yildiz@gmail.com",
        customerType: "individual",
        travelPreferences: "Balıkçılık turu, tekne, Ege lezzetleri.",
        passportStatus: "not_requested",
        notes: `Yıllık balık turu rezervasyonu. ${DEMO}`,
      },
      {
        name: "Sophie Bernard",
        nationality: "Fransız",
        language: "Fransızca, İngilizce",
        phone: "+33 6 12 34 56 78",
        email: "sophie.bernard@orange.fr",
        customerType: "individual",
        travelPreferences: "Butik otel, sanat galerileri, yöresel el sanatları.",
        passportStatus: "received",
        notes: `Kuşadası butik otellere özel talep. ${DEMO}`,
      },
      {
        name: "Marco Bianchi",
        company: "Bianchi Group S.p.A.",
        nationality: "İtalyan",
        language: "İtalyanca, İngilizce",
        phone: "+39 02 98765432",
        email: "m.bianchi@bianchigroup.it",
        customerType: "corporate",
        travelPreferences: "VIP tur paketleri, özel tekne, şık restoranlar.",
        passportStatus: "verified",
        notes: `Milano çıkışlı lüks grup seyahati. 8-10 kişi. ${DEMO}`,
      },
      {
        name: "Anna Schmidt",
        nationality: "Alman",
        language: "Almanca",
        phone: "+49 30 987654",
        email: "anna.schmidt@web.de",
        customerType: "individual",
        travelPreferences: "Kültür, müze, antika çarşı.",
        dietaryRestrictions: "Laktoz intoleransı",
        passportStatus: "not_requested",
        notes: `Efes ve çevre müzelerine odaklı tur istiyor. ${DEMO}`,
      },
      {
        name: "Abdullah Al-Rashid",
        nationality: "Suudi Arabistanlı",
        language: "Arapça, İngilizce",
        phone: "+966 50 123 4567",
        email: "a.alrashid@gmail.com",
        customerType: "vip",
        travelPreferences: "Lüks konaklama, helal yemek, VIP ulaşım.",
        dietaryRestrictions: "Helal yemek zorunlu",
        passportStatus: "received",
        notes: `Aile grupları. Yaz sezonunda haftalık paket. ${DEMO}`,
      },
      {
        name: "Wang Lei",
        nationality: "Çinli",
        language: "Çince, İngilizce",
        phone: "+86 10 1234 5678",
        email: "wang.lei@163.com",
        customerType: "individual",
        travelPreferences: "Fotoğrafçılık, tarihi alanlar, halı alışverişi.",
        passportStatus: "received",
        notes: `Büyük grup organizasyonu için araştırıyor. 50+ kişi. ${DEMO}`,
      },
      {
        name: "Isabella Martinez",
        nationality: "İspanyol",
        language: "İspanyolca, İngilizce",
        phone: "+34 654 321 098",
        email: "isabella.m@gmail.com",
        customerType: "vip",
        travelPreferences: "Lüks yat turu, özel şef deneyimi, wellness.",
        passportStatus: "verified",
        notes: `Bodrum Blue Cruise'a özel talep. ${DEMO}`,
      },
      {
        name: "Kemal Arslan",
        company: "Arslan İnşaat Ltd.",
        nationality: "Türk",
        language: "Türkçe",
        phone: "+90 505 666 7788",
        email: "kemal.arslan@arslaninsat.com",
        customerType: "corporate",
        travelPreferences: "Yurt içi ekip motivasyon gezisi.",
        passportStatus: "not_requested",
        notes: `Bahar sezonu şirket gezisi. 25 kişi. ${DEMO}`,
      },
      {
        name: "Pierre Martin",
        nationality: "Fransız",
        language: "Fransızca",
        phone: "+33 4 91 23 45 67",
        email: "pierre.martin@sfr.fr",
        customerType: "individual",
        travelPreferences: "Mimari, bizans tarihi, arkeoloji.",
        passportStatus: "not_requested",
        notes: `İzmir tarihi yarımada turuna ilgi duyuyor. ${DEMO}`,
      },
      {
        name: "Mert Özkan",
        nationality: "Türk",
        language: "Türkçe, İngilizce",
        phone: "+90 533 888 9900",
        email: "mert.ozkan@gmail.com",
        customerType: "individual",
        travelPreferences: "Macera turu, jeep safari, yamaç paraşütü.",
        passportStatus: "not_requested",
        notes: `Aktif spor paketleri araştırıyor. ${DEMO}`,
      },
      {
        name: "Lena Müller",
        nationality: "Alman",
        language: "Almanca, İngilizce",
        phone: "+49 711 345678",
        email: "lena.mueller@gmx.de",
        customerType: "individual",
        travelPreferences: "Yaşlı ebeveyn ile konforlu tur. Erişilebilirlik önemli.",
        accessibilityRequirements: "Tekerlekli sandalye uyumlu araç gerekli",
        passportStatus: "not_requested",
        notes: `Efes için erişilebilir güzergah istedi. ${DEMO}`,
      },
    ])
    .returning();
  console.log(`✓ ${customerRows.length} customers created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. SUPPLIERS (15 new — adds to existing base seed suppliers)
  // ═══════════════════════════════════════════════════════════════════════════
  const supplierRows = await db
    .insert(suppliersTable)
    .values([
      // Hotels
      {
        name: "Ege Palas Butik Otel",
        contactPerson: "Hülya Özdemir",
        phone: "+90 232 484 5050",
        email: "rezervasyon@egepalas.com",
        website: "https://egepalas.com",
        address: "Gazi Bulvarı No:12, Alsancak, İzmir",
        city: "İzmir",
        category: "hotel",
        currency: "TRY",
        rating: 4.5,
        isActive: true,
        notes: `Tarihi Alsancak'ta butik otel. 18 oda. ${DEMO}`,
      },
      {
        name: "Bodrum Bay Resort & Spa",
        contactPerson: "Can Ermiş",
        phone: "+90 252 385 5000",
        email: "info@bodrumbay.com",
        website: "https://bodrumbay.com",
        address: "Kumbahçe Mah. Neyzen Tevfik Cad. No:108, Bodrum",
        city: "Bodrum",
        category: "hotel",
        currency: "EUR",
        rating: 5,
        isActive: true,
        notes: `Deniz manzaralı 5 yıldızlı. Özel plaj. ${DEMO}`,
      },
      {
        name: "Pergamon Grand Hotel",
        contactPerson: "Serap Aktaş",
        phone: "+90 232 633 2929",
        email: "info@pergamongrand.com",
        address: "Cumhuriyet Cad. No:23, Bergama, İzmir",
        city: "Bergama",
        category: "hotel",
        currency: "TRY",
        rating: 4,
        isActive: true,
        notes: `Akropol'a 10 dakika. Grup indirimi mevcut. ${DEMO}`,
      },
      // Restaurants
      {
        name: "Liman Balık & Meze Restoranı",
        contactPerson: "Hasan Deniz",
        phone: "+90 256 612 3456",
        email: "rezervasyon@limanrestoran.com",
        address: "Liman Cad. No:7, Kuşadası",
        city: "Kuşadası",
        category: "restaurant",
        currency: "TRY",
        rating: 4.7,
        isActive: true,
        notes: `Liman manzaralı. Grup menüsü 65 EUR/kişi. ${DEMO}`,
      },
      {
        name: "Tarihi Efes Lokantası",
        contactPerson: "Güler Arslan",
        phone: "+90 232 892 1122",
        email: "info@efeslokantasi.com",
        address: "Uğur Mumcu Cad. No:4, Selçuk",
        city: "Selçuk",
        category: "restaurant",
        currency: "TRY",
        rating: 4.4,
        isActive: true,
        notes: `Geleneksel Ege mutfağı. Efes turları için öğle yemeği noktası. ${DEMO}`,
      },
      {
        name: "Bodrum Balık Evi",
        contactPerson: "Tarık Ege",
        phone: "+90 252 316 4488",
        email: "info@bodrumbalıkevi.com",
        address: "Cumhuriyet Cad. No:52, Bodrum",
        city: "Bodrum",
        category: "restaurant",
        currency: "TRY",
        rating: 4.6,
        isActive: true,
        notes: `Taze balık ve deniz ürünleri. VIP masalar için önceden rezervasyon. ${DEMO}`,
      },
      // Transfer companies
      {
        name: "İzmir VIP Transfer",
        contactPerson: "Sercan Yılmaz",
        phone: "+90 532 555 6677",
        email: "info@izmirtransfer.com",
        address: "Adnan Menderes Hava Limanı, İzmir",
        city: "İzmir",
        category: "transfer",
        currency: "EUR",
        rating: 4.8,
        isActive: true,
        notes: `Havalimanı ve şehiriçi VIP transfer. Mercedes Sprinter filosu. ${DEMO}`,
      },
      {
        name: "Bodrum Express Transfers",
        contactPerson: "Ömer Çakır",
        phone: "+90 533 777 9900",
        email: "info@bodrumexpress.com",
        address: "Milas-Bodrum Havalimanı, Muğla",
        city: "Bodrum",
        category: "transfer",
        currency: "EUR",
        rating: 4.3,
        isActive: true,
        notes: `Bodrum yarımadası ve havalimanı transferleri. ${DEMO}`,
      },
      // Museums / Activity providers
      {
        name: "Bodrum Sualtı Arkeoloji Müzesi",
        contactPerson: "Zehra Yılmaz",
        phone: "+90 252 316 2516",
        email: "info@bodrum-museum.com",
        address: "İçkale Mah. No:1, Bodrum",
        city: "Bodrum",
        category: "activity",
        currency: "TRY",
        rating: 4.9,
        isActive: true,
        notes: `Grup biletleri için 48 saat önceden rezervasyon zorunlu. ${DEMO}`,
      },
      {
        name: "Bergama Akropol Rehberlik Hizmetleri",
        contactPerson: "Nuri Boz",
        phone: "+90 232 633 1111",
        email: "nuri.boz@bergamarehber.com",
        city: "Bergama",
        category: "activity",
        currency: "TRY",
        rating: 4.6,
        isActive: true,
        notes: `Akropol ve Asklepion uzman rehberleri. 5-30 kişilik gruplar. ${DEMO}`,
      },
      // Boat operators
      {
        name: "Ege Yat Turları",
        contactPerson: "Barış Denizoğlu",
        phone: "+90 252 316 7788",
        email: "baris@egeyat.com",
        website: "https://egeyat.com",
        address: "Yat Limanı No:14, Bodrum",
        city: "Bodrum",
        category: "boat",
        currency: "EUR",
        rating: 4.9,
        isActive: true,
        notes: `Blue Cruise ve günlük tekne turları. 12-24 kişilik guletler. ${DEMO}`,
      },
      {
        name: "Kuşadası Tekne Turları",
        contactPerson: "Erhan Dalgıç",
        phone: "+90 256 614 9988",
        email: "erhan@kusadasitekne.com",
        address: "Liman Meydanı No:3, Kuşadası",
        city: "Kuşadası",
        category: "boat",
        currency: "TRY",
        rating: 4.4,
        isActive: true,
        notes: `Günlük 12 adalı tekne turu. Kahvaltı ve öğle yemeği dahil. ${DEMO}`,
      },
      // Local guides
      {
        name: "Rehber Zeynep Aydın",
        contactPerson: "Zeynep Aydın",
        phone: "+90 532 234 5678",
        email: "zeynep.aydin.rehber@gmail.com",
        city: "İzmir",
        category: "guide",
        currency: "EUR",
        rating: 4.9,
        isActive: true,
        notes: `İzmir tarihi yarımada ve Efes uzmanı. Türkçe, İngilizce, Fransızca. ${DEMO}`,
      },
      {
        name: "Rehber Kadir Yılmaz",
        contactPerson: "Kadir Yılmaz",
        phone: "+90 537 345 6789",
        email: "kadir.yilmaz.bodrum@gmail.com",
        city: "Bodrum",
        category: "guide",
        currency: "EUR",
        rating: 4.7,
        isActive: true,
        notes: `Bodrum ve Datça yarımadası uzmanı. İngilizce, Almanca. ${DEMO}`,
      },
      {
        name: "Rehber Nilay Şahin",
        contactPerson: "Nilay Şahin",
        phone: "+90 538 456 7890",
        email: "nilay.sahin.rehber@gmail.com",
        city: "Selçuk",
        category: "guide",
        currency: "EUR",
        rating: 4.8,
        isActive: true,
        notes: `Efes, Meryem Ana ve Pamukkale uzmanı. Türkçe, İtalyanca, İspanyolca. ${DEMO}`,
      },
    ])
    .returning();
  console.log(`✓ ${supplierRows.length} new suppliers created`);

  // Convenience IDs for later use
  const supByName = Object.fromEntries(supplierRows.map((s) => [s.name, s.id]));
  const custByName = Object.fromEntries(customerRows.map((c) => [c.name, c.id]));

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. TOURS (12)
  // ═══════════════════════════════════════════════════════════════════════════
  const tourRows = await db
    .insert(toursTable)
    .values([
      {
        name: "Efes Antik Kenti Tam Gün",
        code: "DEMO-EFE-001",
        customerId: custByName["James Mitchell"],
        startDate: daysAgo(30),
        endDate: daysAgo(30),
        nights: 0,
        adultCount: 2,
        childCount: 0,
        mainDestination: "Selçuk",
        tourType: "cultural",
        status: "completed",
        guideLanguage: "İngilizce",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 28,
        notes: `Efes, Meryem Ana Evi ve Selçuk Müzesi. ${DEMO}`,
      },
      {
        name: "Pamukkale & Hierapolis 2 Gece",
        code: "DEMO-PAM-001",
        customerId: custByName["Ayşe Demir"],
        startDate: daysAgo(45),
        endDate: daysAgo(43),
        nights: 2,
        adultCount: 2,
        childCount: 0,
        mainDestination: "Denizli",
        tourType: "wellness",
        status: "completed",
        guideLanguage: "Türkçe",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 24,
        notes: `Termal konaklamalı Pamukkale turu. ${DEMO}`,
      },
      {
        name: "Şirince Köyü & Şarap Tadımı",
        code: "DEMO-SIR-001",
        customerId: custByName["Maria Rossi"],
        startDate: daysAgo(20),
        endDate: daysAgo(20),
        nights: 0,
        adultCount: 4,
        childCount: 0,
        mainDestination: "Şirince",
        tourType: "gastronomy",
        status: "approved",
        guideLanguage: "İngilizce, İtalyanca",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 30,
        notes: `Şarap ve zeytinyağı tadımı dahil. ${DEMO}`,
      },
      {
        name: "Bodrum Blue Cruise 4 Gece",
        code: "DEMO-BCR-001",
        customerId: custByName["Isabella Martinez"],
        startDate: daysFromNow(10),
        endDate: daysFromNow(14),
        nights: 4,
        adultCount: 6,
        childCount: 0,
        mainDestination: "Bodrum",
        tourType: "cruise",
        status: "approved",
        guideLanguage: "İngilizce, İspanyolca",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 32,
        notes: `Özel gulet. Göcek, Ölüdeniz, Bozburun güzergahı. ${DEMO}`,
      },
      {
        name: "Özel İzmir Şehir Turu",
        code: "DEMO-IZM-001",
        customerId: custByName["David Lee"],
        startDate: daysAgo(10),
        endDate: daysAgo(10),
        nights: 0,
        adultCount: 12,
        childCount: 0,
        mainDestination: "İzmir",
        tourType: "cultural",
        status: "completed",
        guideLanguage: "İngilizce",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 22,
        notes: `MICE grubu. Kemeraltı, Tarihi Asansör, Kordon. ${DEMO}`,
      },
      {
        name: "Bergama Akropol & Asklepion",
        code: "DEMO-PER-001",
        customerId: custByName["Ingrid Hansen"],
        startDate: daysFromNow(5),
        endDate: daysFromNow(5),
        nights: 0,
        adultCount: 1,
        childCount: 0,
        mainDestination: "Bergama",
        tourType: "cultural",
        status: "draft",
        guideLanguage: "İngilizce, Norveçce",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 26,
        notes: `Özel rehberli arkeoloji turu. ${DEMO}`,
      },
      {
        name: "Kuşadası Alışveriş Turu",
        code: "DEMO-KUS-001",
        customerId: custByName["Sarah Wilson"],
        startDate: daysAgo(15),
        endDate: daysAgo(15),
        nights: 0,
        adultCount: 8,
        childCount: 2,
        mainDestination: "Kuşadası",
        tourType: "shopping",
        status: "completed",
        guideLanguage: "İngilizce",
        transferRequired: false,
        isCruiseExcursion: true,
        shipName: "Carnival Vista",
        portName: "Kuşadası Limanı",
        shipArrivalTime: "07:30",
        shipDepartureTime: "17:30",
        cruiseSafetyBufferMinutes: 45,
        profitMargin: 20,
        notes: `Deri, halı ve mücevher mağazaları. ${DEMO}`,
      },
      {
        name: "Bodrum Sualtı Müzesi & Kale",
        code: "DEMO-BCL-001",
        customerId: custByName["Emma Johnson"],
        startDate: daysAgo(5),
        endDate: daysAgo(5),
        nights: 0,
        adultCount: 2,
        childCount: 0,
        mainDestination: "Bodrum",
        tourType: "cultural",
        status: "completed",
        guideLanguage: "İngilizce",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 28,
        notes: `Bodrum Kalesi ve Sualtı Müzesi. Özel rehber. ${DEMO}`,
      },
      {
        name: "12 Ada Tekne Turu",
        code: "DEMO-ADA-001",
        customerId: custByName["Carlos García"],
        startDate: daysFromNow(3),
        endDate: daysFromNow(3),
        nights: 0,
        adultCount: 10,
        childCount: 0,
        mainDestination: "Kuşadası",
        tourType: "boat",
        status: "approved",
        guideLanguage: "İngilizce, İspanyolca",
        transferRequired: false,
        isCruiseExcursion: false,
        profitMargin: 25,
        notes: `Kahvaltı ve öğle yemeği dahil. ${DEMO}`,
      },
      {
        name: "Efes & Şirince Kruvaziyer Excursion",
        code: "DEMO-ECX-001",
        customerId: custByName["Hans Becker"],
        startDate: daysFromNow(20),
        endDate: daysFromNow(20),
        nights: 0,
        adultCount: 20,
        childCount: 5,
        mainDestination: "Selçuk",
        tourType: "cultural",
        status: "approved",
        guideLanguage: "Almanca",
        transferRequired: true,
        isCruiseExcursion: true,
        shipName: "AIDA Nova",
        portName: "Kuşadası Limanı",
        shipArrivalTime: "08:00",
        shipDepartureTime: "19:00",
        cruiseSafetyBufferMinutes: 45,
        profitMargin: 26,
        notes: `Kurumsal Becker grubu. Almanca rehber zorunlu. ${DEMO}`,
      },
      {
        name: "Pamukkale Günübirlik Tur",
        code: "DEMO-PAG-001",
        customerId: custByName["Fatma Çelik"],
        startDate: daysFromNow(15),
        endDate: daysFromNow(15),
        nights: 0,
        adultCount: 2,
        childCount: 2,
        mainDestination: "Denizli",
        tourType: "cultural",
        status: "draft",
        guideLanguage: "Türkçe",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 22,
        notes: `Aile turu. Çocuk dostu güzergah. ${DEMO}`,
      },
      {
        name: "İzmir Ephesus Tur Paketi 3 Gece",
        code: "DEMO-IZP-001",
        customerId: custByName["François Dubois"],
        startDate: daysFromNow(25),
        endDate: daysFromNow(28),
        nights: 3,
        adultCount: 15,
        childCount: 0,
        mainDestination: "İzmir",
        tourType: "cultural",
        status: "sent",
        guideLanguage: "Fransızca",
        transferRequired: true,
        isCruiseExcursion: false,
        profitMargin: 24,
        notes: `Fransız acente grubu. Fransızca rehber zorunlu. ${DEMO}`,
      },
    ])
    .returning();
  console.log(`✓ ${tourRows.length} tours created`);

  const tourByCode = Object.fromEntries(tourRows.map((t) => [t.code, t.id]));

  // Tour costs (2–3 per tour)
  await db.insert(tourCostsTable).values([
    { tourId: tourByCode["DEMO-EFE-001"], description: "Özel minibüs transferi", category: "transfer", quantity: 1, unitCost: 160, currency: "EUR", taxRate: 0, total: 160, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-EFE-001"], description: "İngilizce rehber (8 saat)", category: "guide", quantity: 1, unitCost: 140, currency: "EUR", taxRate: 0, total: 140, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-EFE-001"], description: "Efes giriş bileti (yetişkin)", category: "activity", quantity: 2, unitCost: 18, currency: "EUR", taxRate: 0, total: 36, isPerPerson: true, isConfirmed: true },
    { tourId: tourByCode["DEMO-PAM-001"], description: "Pamukkale Termal Resort (2 gece, 2 kişi)", category: "accommodation", quantity: 4, unitCost: 85, currency: "EUR", taxRate: 0, total: 340, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-PAM-001"], description: "Kuşadası-Denizli özel araç transferi", category: "transfer", quantity: 1, unitCost: 220, currency: "EUR", taxRate: 0, total: 220, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-BCR-001"], description: "Özel gulet kiralama (4 gece)", category: "boat", quantity: 1, unitCost: 2800, currency: "EUR", taxRate: 0, total: 2800, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-BCR-001"], description: "Bodrum'dan transfer (6 kişi)", category: "transfer", quantity: 1, unitCost: 180, currency: "EUR", taxRate: 0, total: 180, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-IZM-001"], description: "Lüks otobüs kiralama (tam gün)", category: "transfer", quantity: 1, unitCost: 380, currency: "EUR", taxRate: 0, total: 380, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-IZM-001"], description: "İngilizce rehber (12 kişi grubu)", category: "guide", quantity: 1, unitCost: 160, currency: "EUR", taxRate: 0, total: 160, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-ADA-001"], description: "Tekne kiralama (günlük)", category: "boat", quantity: 1, unitCost: 450, currency: "EUR", taxRate: 0, total: 450, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-ADA-001"], description: "Kahvaltı ve öğle yemeği (10 kişi)", category: "restaurant", quantity: 10, unitCost: 35, currency: "EUR", taxRate: 0, total: 350, isPerPerson: true, isConfirmed: false },
    { tourId: tourByCode["DEMO-ECX-001"], description: "Büyük otobüs (25 kişi)", category: "transfer", quantity: 1, unitCost: 420, currency: "EUR", taxRate: 0, total: 420, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-ECX-001"], description: "Almanca rehber (tam gün)", category: "guide", quantity: 1, unitCost: 160, currency: "EUR", taxRate: 0, total: 160, isPerPerson: false, isConfirmed: true },
    { tourId: tourByCode["DEMO-ECX-001"], description: "Efes giriş bileti (yetişkin)", category: "activity", quantity: 20, unitCost: 18, currency: "EUR", taxRate: 0, total: 360, isPerPerson: true, isConfirmed: true },
    { tourId: tourByCode["DEMO-ECX-001"], description: "Efes giriş bileti (çocuk)", category: "activity", quantity: 5, unitCost: 9, currency: "EUR", taxRate: 0, total: 45, isPerPerson: true, isConfirmed: true },
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. QUOTATIONS (20)
  // ═══════════════════════════════════════════════════════════════════════════
  const quotationData = [
    { number: "DEMO-TEK-0001", customerId: custByName["James Mitchell"],   tourId: tourByCode["DEMO-EFE-001"], status: "accepted",  currency: "EUR", subtotal: 720,   discount: 0,  finalPrice: 720,   daysAgoCreated: 35, expiresOffset: 25 },
    { number: "DEMO-TEK-0002", customerId: custByName["Ayşe Demir"],       tourId: tourByCode["DEMO-PAM-001"], status: "accepted",  currency: "TRY", subtotal: 28000, discount: 1000, finalPrice: 27000, daysAgoCreated: 50, expiresOffset: 40 },
    { number: "DEMO-TEK-0003", customerId: custByName["Maria Rossi"],      tourId: tourByCode["DEMO-SIR-001"], status: "sent",      currency: "EUR", subtotal: 480,   discount: 0,  finalPrice: 480,   daysAgoCreated: 25, expiresOffset: -5 },
    { number: "DEMO-TEK-0004", customerId: custByName["Isabella Martinez"], tourId: tourByCode["DEMO-BCR-001"], status: "accepted",  currency: "EUR", subtotal: 5800,  discount: 300, finalPrice: 5500, daysAgoCreated: 20, expiresOffset: 20 },
    { number: "DEMO-TEK-0005", customerId: custByName["David Lee"],        tourId: tourByCode["DEMO-IZM-001"], status: "accepted",  currency: "EUR", subtotal: 2400,  discount: 200, finalPrice: 2200, daysAgoCreated: 15, expiresOffset: 5 },
    { number: "DEMO-TEK-0006", customerId: custByName["Ingrid Hansen"],    tourId: tourByCode["DEMO-PER-001"], status: "draft",     currency: "EUR", subtotal: 380,   discount: 0,  finalPrice: 380,   daysAgoCreated: 3,  expiresOffset: 11 },
    { number: "DEMO-TEK-0007", customerId: custByName["Sarah Wilson"],     tourId: tourByCode["DEMO-KUS-001"], status: "accepted",  currency: "EUR", subtotal: 920,   discount: 50, finalPrice: 870,   daysAgoCreated: 20, expiresOffset: 10 },
    { number: "DEMO-TEK-0008", customerId: custByName["Emma Johnson"],     tourId: tourByCode["DEMO-BCL-001"], status: "accepted",  currency: "EUR", subtotal: 640,   discount: 0,  finalPrice: 640,   daysAgoCreated: 10, expiresOffset: 0 },
    { number: "DEMO-TEK-0009", customerId: custByName["Carlos García"],    tourId: tourByCode["DEMO-ADA-001"], status: "sent",      currency: "EUR", subtotal: 1100,  discount: 0,  finalPrice: 1100,  daysAgoCreated: 5,  expiresOffset: 9 },
    { number: "DEMO-TEK-0010", customerId: custByName["Hans Becker"],      tourId: tourByCode["DEMO-ECX-001"], status: "accepted",  currency: "EUR", subtotal: 4200,  discount: 200, finalPrice: 4000, daysAgoCreated: 30, expiresOffset: 15 },
    { number: "DEMO-TEK-0011", customerId: custByName["Fatma Çelik"],      tourId: tourByCode["DEMO-PAG-001"], status: "draft",     currency: "TRY", subtotal: 9800,  discount: 0,  finalPrice: 9800,  daysAgoCreated: 2,  expiresOffset: 12 },
    { number: "DEMO-TEK-0012", customerId: custByName["François Dubois"],  tourId: tourByCode["DEMO-IZP-001"], status: "sent",      currency: "EUR", subtotal: 6800,  discount: 500, finalPrice: 6300, daysAgoCreated: 7,  expiresOffset: 7 },
    { number: "DEMO-TEK-0013", customerId: custByName["Ahmet Kaya"],       tourId: null,                       status: "rejected",  currency: "TRY", subtotal: 45000, discount: 0,  finalPrice: 45000, daysAgoCreated: 60, expiresOffset: 50 },
    { number: "DEMO-TEK-0014", customerId: custByName["Mert Özkan"],       tourId: null,                       status: "rejected",  currency: "TRY", subtotal: 7200,  discount: 0,  finalPrice: 7200,  daysAgoCreated: 40, expiresOffset: 30 },
    { number: "DEMO-TEK-0015", customerId: custByName["Sophie Bernard"],   tourId: null,                       status: "expired",   currency: "EUR", subtotal: 520,   discount: 0,  finalPrice: 520,   daysAgoCreated: 70, expiresOffset: 63 },
    { number: "DEMO-TEK-0016", customerId: custByName["Robert Brown"],     tourId: null,                       status: "expired",   currency: "EUR", subtotal: 340,   discount: 0,  finalPrice: 340,   daysAgoCreated: 55, expiresOffset: 48 },
    { number: "DEMO-TEK-0017", customerId: custByName["Elena Petrova"],    tourId: null,                       status: "draft",     currency: "EUR", subtotal: 1800,  discount: 0,  finalPrice: 1800,  daysAgoCreated: 1,  expiresOffset: 13 },
    { number: "DEMO-TEK-0018", customerId: custByName["Marco Bianchi"],    tourId: null,                       status: "sent",      currency: "EUR", subtotal: 3600,  discount: 0,  finalPrice: 3600,  daysAgoCreated: 4,  expiresOffset: 10 },
    { number: "DEMO-TEK-0019", customerId: custByName["Wang Lei"],         tourId: null,                       status: "draft",     currency: "USD", subtotal: 12000, discount: 0,  finalPrice: 12000, daysAgoCreated: 2,  expiresOffset: 12 },
    { number: "DEMO-TEK-0020", customerId: custByName["Kemal Arslan"],     tourId: null,                       status: "accepted",  currency: "TRY", subtotal: 38000, discount: 2000, finalPrice: 36000, daysAgoCreated: 25, expiresOffset: 18 },
  ];

  const quotationRows = await db
    .insert(quotationsTable)
    .values(
      quotationData.map((q) => ({
        number: q.number,
        customerId: q.customerId,
        tourId: q.tourId ?? undefined,
        expiresAt: daysAgo(q.daysAgoCreated - q.expiresOffset),
        currency: q.currency,
        subtotal: q.subtotal,
        discount: q.discount,
        finalPrice: q.finalPrice,
        status: q.status,
        paymentTerms: "%30 ön ödeme ile rezervasyon onaylanır, kalan %70 tur başlangıcından 3 gün önce ödenir.",
        cancellationPolicy: "Turdan 48 saat öncesine kadar ücretsiz iptal.",
        includedServices: "Özel araç transferi, rehber, giriş biletleri",
        excludedServices: "Kişisel harcamalar, alkollü içecekler",
        notes: `${DEMO}`,
        sentAt: ["sent", "accepted", "rejected", "expired"].includes(q.status)
          ? tsAgo(q.daysAgoCreated - 2)
          : null,
        respondedAt: ["accepted", "rejected"].includes(q.status)
          ? tsAgo(q.daysAgoCreated - 5)
          : null,
      }))
    )
    .returning();
  console.log(`✓ ${quotationRows.length} quotations created`);

  const quotByNumber = Object.fromEntries(quotationRows.map((q) => [q.number, q.id]));

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. OPERATIONS (15)
  // ═══════════════════════════════════════════════════════════════════════════
  const operationRows = await db
    .insert(operationsTable)
    .values([
      // COMPLETED (5) — past
      {
        quotationId: quotByNumber["DEMO-TEK-0001"],
        tourId: tourByCode["DEMO-EFE-001"],
        customerId: custByName["James Mitchell"],
        startDate: daysAgo(30),
        endDate: daysAgo(30),
        status: "completed",
        completionRate: 100,
        guideName: "Zeynep Aydın",
        guidePhone: "+90 532 234 5678",
        driverName: "Sercan Yılmaz",
        driverPhone: "+90 532 555 6677",
        vehiclePlate: "09 AEG 321",
        emergencyContact1Name: "Operasyon Koordinatörü",
        emergencyContact1Phone: "+90 256 614 0000",
        notes: `Efes tam gün turu başarıyla tamamlandı. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0002"],
        tourId: tourByCode["DEMO-PAM-001"],
        customerId: custByName["Ayşe Demir"],
        startDate: daysAgo(45),
        endDate: daysAgo(43),
        status: "completed",
        completionRate: 100,
        guideName: "Nilay Şahin",
        guidePhone: "+90 538 456 7890",
        assignedGuideUserId: DEMO_GUIDE_CLERK_ID,
        driverName: "Ömer Çakır",
        driverPhone: "+90 533 777 9900",
        vehiclePlate: "35 OPR 001",
        notes: `Pamukkale 2 gecelik konaklama başarıyla tamamlandı. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0007"],
        tourId: tourByCode["DEMO-KUS-001"],
        customerId: custByName["Sarah Wilson"],
        startDate: daysAgo(15),
        endDate: daysAgo(15),
        status: "completed",
        completionRate: 100,
        guideName: "Kadir Yılmaz",
        guidePhone: "+90 537 345 6789",
        driverName: "Ali Kaya",
        driverPhone: "+90 532 444 5566",
        vehiclePlate: "09 TRF 555",
        notes: `Kruvaziyer alışveriş turu tamamlandı. Gemi vakitli geri döndü. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0005"],
        tourId: tourByCode["DEMO-IZM-001"],
        customerId: custByName["David Lee"],
        startDate: daysAgo(10),
        endDate: daysAgo(10),
        status: "completed",
        completionRate: 100,
        guideName: "Zeynep Aydın",
        guidePhone: "+90 532 234 5678",
        driverName: "Sercan Yılmaz",
        driverPhone: "+90 532 555 6677",
        vehiclePlate: "35 VIP 777",
        notes: `MICE grubu İzmir turu tamamlandı. Müşteri memnun. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0008"],
        tourId: tourByCode["DEMO-BCL-001"],
        customerId: custByName["Emma Johnson"],
        startDate: daysAgo(5),
        endDate: daysAgo(5),
        status: "completed",
        completionRate: 100,
        guideName: "Kadir Yılmaz",
        guidePhone: "+90 537 345 6789",
        driverName: "Ömer Çakır",
        driverPhone: "+90 533 777 9900",
        vehiclePlate: "48 VIP 100",
        notes: `Bodrum kale turu VIP. Mükemmel geri dönüş aldı. ${DEMO}`,
      },
      // ACTIVE TODAY (3)
      {
        quotationId: quotByNumber["DEMO-TEK-0003"],
        tourId: tourByCode["DEMO-SIR-001"],
        customerId: custByName["Maria Rossi"],
        startDate: daysAgo(0),
        endDate: daysAgo(0),
        status: "active",
        completionRate: 65,
        guideName: "Nilay Şahin",
        guidePhone: "+90 538 456 7890",
        assignedGuideUserId: DEMO_GUIDE_CLERK_ID,
        driverName: "Ali Kaya",
        driverPhone: "+90 532 444 5566",
        vehiclePlate: "09 AEG 112",
        emergencyContact1Name: "Operasyon Merkezi",
        emergencyContact1Phone: "+90 256 614 0000",
        notes: `Şirince şarap turu devam ediyor. ${DEMO}`,
      },
      {
        tourId: tourByCode["DEMO-ADA-001"],
        customerId: custByName["Carlos García"],
        startDate: daysAgo(0),
        endDate: daysAgo(0),
        status: "active",
        completionRate: 40,
        guideName: "Zeynep Aydın",
        guidePhone: "+90 532 234 5678",
        driverName: "Erhan Dalgıç",
        driverPhone: "+90 256 614 9988",
        vehiclePlate: "09-YT-2201",
        notes: `12 ada tekne turu sürmekte. ${DEMO}`,
      },
      {
        tourId: tourByCode["DEMO-BCL-001"],
        customerId: custByName["Mustafa Yıldız"],
        startDate: daysAgo(0),
        endDate: daysAgo(0),
        status: "active",
        completionRate: 30,
        guideName: "Kadir Yılmaz",
        guidePhone: "+90 537 345 6789",
        vehiclePlate: "48 OPR 445",
        notes: `Balık turu. Öğle dönüşü planlanıyor. ${DEMO}`,
      },
      // UPCOMING (5)
      {
        quotationId: quotByNumber["DEMO-TEK-0004"],
        tourId: tourByCode["DEMO-BCR-001"],
        customerId: custByName["Isabella Martinez"],
        startDate: daysFromNow(10),
        endDate: daysFromNow(14),
        status: "scheduled",
        completionRate: 0,
        guideName: "Kadir Yılmaz",
        guidePhone: "+90 537 345 6789",
        driverName: "Ömer Çakır",
        driverPhone: "+90 533 777 9900",
        vehiclePlate: "48 VIP 200",
        emergencyContact1Name: "Bodrum Ofis",
        emergencyContact1Phone: "+90 252 385 5000",
        notes: `Blue Cruise hazırlıkları tamamlandı. Gulet hazır. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0006"],
        tourId: tourByCode["DEMO-PER-001"],
        customerId: custByName["Ingrid Hansen"],
        startDate: daysFromNow(5),
        endDate: daysFromNow(5),
        status: "scheduled",
        completionRate: 0,
        guideName: "Nilay Şahin",
        guidePhone: "+90 538 456 7890",
        assignedGuideUserId: DEMO_GUIDE_CLERK_ID,
        driverName: "Sercan Yılmaz",
        driverPhone: "+90 532 555 6677",
        vehiclePlate: "35 PVT 321",
        notes: `Bergama turu. Özel rehber Nilay onaylandı. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0010"],
        tourId: tourByCode["DEMO-ECX-001"],
        customerId: custByName["Hans Becker"],
        startDate: daysFromNow(20),
        endDate: daysFromNow(20),
        status: "scheduled",
        completionRate: 0,
        guideName: "Nilay Şahin",
        guidePhone: "+90 538 456 7890",
        assignedGuideUserId: DEMO_GUIDE_CLERK_ID,
        driverName: "Ömer Çakır",
        driverPhone: "+90 533 777 9900",
        vehiclePlate: "35 GRP 888",
        emergencyContact1Name: "Kuşadası Liman Ofisi",
        emergencyContact1Phone: "+90 256 614 0000",
        notes: `Becker grubu Efes excursion. 25 kişilik büyük otobüs rezerve edildi. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0011"],
        tourId: tourByCode["DEMO-PAG-001"],
        customerId: custByName["Fatma Çelik"],
        startDate: daysFromNow(15),
        endDate: daysFromNow(15),
        status: "scheduled",
        completionRate: 0,
        notes: `Pamukkale aile turu. Rehber ve araç henüz atanmadı. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0012"],
        tourId: tourByCode["DEMO-IZP-001"],
        customerId: custByName["François Dubois"],
        startDate: daysFromNow(25),
        endDate: daysFromNow(28),
        status: "scheduled",
        completionRate: 0,
        guideName: "Zeynep Aydın",
        guidePhone: "+90 532 234 5678",
        notes: `Dubois grubu 3 gecelik İzmir paketi. Otel rezervasyonu onay bekliyor. ${DEMO}`,
      },
      // CANCELLED (2)
      {
        quotationId: quotByNumber["DEMO-TEK-0013"],
        customerId: custByName["Ahmet Kaya"],
        startDate: daysAgo(60),
        endDate: daysAgo(60),
        status: "cancelled",
        completionRate: 0,
        notes: `İptal edildi. Müşteri kendi organizasyonunu kurdu. ${DEMO}`,
      },
      {
        quotationId: quotByNumber["DEMO-TEK-0014"],
        customerId: custByName["Mert Özkan"],
        startDate: daysAgo(40),
        endDate: daysAgo(40),
        status: "cancelled",
        completionRate: 0,
        notes: `İptal. Katılımcı sayısı yetersiz kaldı. ${DEMO}`,
      },
    ])
    .returning();
  console.log(`✓ ${operationRows.length} operations created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. OPERATION TASKS
  // ═══════════════════════════════════════════════════════════════════════════
  const completedOps = operationRows.filter((o) => o.status === "completed");
  const upcomingOps = operationRows.filter((o) => o.status === "scheduled");
  const activeOps = operationRows.filter((o) => o.status === "active");

  const taskValues = [
    // Completed operation tasks
    ...completedOps.flatMap((op) => [
      { operationId: op.id, title: "Araç ve şoför konfirmasyonu", status: "completed", priority: "high", dueDate: op.startDate, sortOrder: 1, description: `${DEMO}`, completedAt: tsAgo(parseInt(op.startDate?.replace(/-/g, "") ?? "0") > 20260700 ? 1 : 20) },
      { operationId: op.id, title: "Müşteri bilgilendirme e-postası", status: "completed", priority: "medium", dueDate: op.startDate, sortOrder: 2, description: `Buluşma noktası ve saat bilgisi gönderildi. ${DEMO}`, completedAt: tsAgo(2) },
      { operationId: op.id, title: "Makbuz ve belge kontrolü", status: "completed", priority: "medium", dueDate: op.startDate, sortOrder: 3, description: `Tüm makbuzlar muhasebe sistemine yüklendi. ${DEMO}`, completedAt: tsAgo(1) },
    ]),
    // Active operation tasks
    ...activeOps.flatMap((op) => [
      { operationId: op.id, title: "Gerçek zamanlı konum paylaşımı", status: "in_progress", priority: "high", sortOrder: 1, description: `${DEMO}` },
      { operationId: op.id, title: "Saha makbuzlarını yükle", status: "not_started", priority: "medium", sortOrder: 2, description: `Öğle yemeği ve giriş biletleri için makbuz gerekli. ${DEMO}` },
    ]),
    // Upcoming operation tasks
    ...upcomingOps.flatMap((op) => [
      { operationId: op.id, title: "Rehber ve araç konfirmasyonu", status: "not_started", priority: "high", dueDate: daysFromNow(2), sortOrder: 1, description: `${DEMO}` },
      { operationId: op.id, title: "Müşteri ön bilgilendirmesi", status: "not_started", priority: "medium", dueDate: daysFromNow(3), sortOrder: 2, description: `${DEMO}` },
      { operationId: op.id, title: "Giriş biletleri ve rezervasyonlar", status: "not_started", priority: "high", dueDate: daysFromNow(1), sortOrder: 3, description: `${DEMO}` },
    ]),
  ];
  await db.insert(operationTasksTable).values(taskValues);
  console.log(`✓ ${taskValues.length} operation tasks created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. OPERATION RECEIPTS (40)
  // ═══════════════════════════════════════════════════════════════════════════
  type ReceiptStatus = "pending_review" | "approved" | "rejected" | "missing_information";

  const receiptTemplates: Array<{
    supplierName: string;
    amount: number;
    currency: string;
    category: string;
    reviewStatus: ReceiptStatus;
    hasPhoto: boolean;
  }> = [
    { supplierName: "Tarihi Efes Lokantası", amount: 320, currency: "TRY", category: "restaurant", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Ege Transfer Hizmetleri", amount: 180, currency: "EUR", category: "transfer", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Efes Antik Kenti Giriş", amount: 90, currency: "EUR", category: "activity", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Kuşadası Benzin İstasyonu", amount: 850, currency: "TRY", category: "fuel", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Kuşadası Otopark", amount: 120, currency: "TRY", category: "parking", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Pamukkale Termal Resort", amount: 340, currency: "EUR", category: "accommodation", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Bodrum Balık Evi", amount: 480, currency: "TRY", category: "restaurant", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Ege Yat Turları", amount: 2800, currency: "EUR", category: "boat", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "İzmir Taksi", amount: 150, currency: "TRY", category: "taxi", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Bergama Müze Giriş", amount: 240, currency: "TRY", category: "activity", reviewStatus: "approved", hasPhoto: true },
    // Pending
    { supplierName: "Liman Balık & Meze Restoranı", amount: 750, currency: "TRY", category: "restaurant", reviewStatus: "pending_review", hasPhoto: true },
    { supplierName: "Bodrum Benzin", amount: 680, currency: "TRY", category: "fuel", reviewStatus: "pending_review", hasPhoto: false },
    { supplierName: "Kuşadası Tekne Turları", amount: 450, currency: "EUR", category: "boat", reviewStatus: "pending_review", hasPhoto: true },
    { supplierName: "Selçuk Otopark", amount: 80, currency: "TRY", category: "parking", reviewStatus: "pending_review", hasPhoto: false },
    { supplierName: "Bodrum Sualtı Müzesi", amount: 360, currency: "TRY", category: "activity", reviewStatus: "pending_review", hasPhoto: true },
    { supplierName: "İzmir Taksi – Havalimanı", amount: 380, currency: "TRY", category: "taxi", reviewStatus: "pending_review", hasPhoto: false },
    { supplierName: "Şirince Ev Yemekleri", amount: 520, currency: "TRY", category: "restaurant", reviewStatus: "pending_review", hasPhoto: true },
    { supplierName: "Ege Transfer – Liman", amount: 160, currency: "EUR", category: "transfer", reviewStatus: "pending_review", hasPhoto: false },
    // Rejected
    { supplierName: "Bilinmeyen Restoran", amount: 1200, currency: "TRY", category: "restaurant", reviewStatus: "rejected", hasPhoto: false },
    { supplierName: "Kişisel Alışveriş", amount: 450, currency: "TRY", category: "other", reviewStatus: "rejected", hasPhoto: false },
    // More approved for volume
    { supplierName: "Tarihi Efes Lokantası", amount: 285, currency: "TRY", category: "restaurant", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Ege Transfer Hizmetleri", amount: 220, currency: "EUR", category: "transfer", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Kuşadası Benzin İstasyonu", amount: 920, currency: "TRY", category: "fuel", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Bodrum Bay Resort Spa", amount: 180, currency: "EUR", category: "accommodation", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Bergama Akropol Rehber", amount: 160, currency: "EUR", category: "guide", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "İzmir VIP Transfer", amount: 380, currency: "EUR", category: "transfer", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Efes Giriş – Çocuk", amount: 45, currency: "EUR", category: "activity", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Kuşadası Tekne Yakıt", amount: 380, currency: "TRY", category: "fuel", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Liman Restaurant – Akşam", amount: 1100, currency: "TRY", category: "restaurant", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Denizli Otopark – 2 Gece", amount: 200, currency: "TRY", category: "parking", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Bodrum Tekne – Günlük", amount: 450, currency: "EUR", category: "boat", reviewStatus: "pending_review", hasPhoto: true },
    { supplierName: "İzmir Taksi – Alsancak", amount: 95, currency: "TRY", category: "taxi", reviewStatus: "pending_review", hasPhoto: false },
    { supplierName: "Kuşadası Müze Giriş", amount: 120, currency: "TRY", category: "activity", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Şirince Şarap Tadımı", amount: 280, currency: "TRY", category: "activity", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Selçuk Benzin", amount: 760, currency: "TRY", category: "fuel", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Bodrum Balık – Öğle", amount: 640, currency: "TRY", category: "restaurant", reviewStatus: "pending_review", hasPhoto: false },
    { supplierName: "Meryem Ana Evi Giriş", amount: 60, currency: "EUR", category: "activity", reviewStatus: "approved", hasPhoto: true },
    { supplierName: "Liman Otopark", amount: 60, currency: "TRY", category: "parking", reviewStatus: "approved", hasPhoto: false },
    { supplierName: "Efes Lokantası – Öğle", amount: 350, currency: "TRY", category: "restaurant", reviewStatus: "missing_information", hasPhoto: false },
    { supplierName: "Bodrum Ekspres Transfer", amount: 200, currency: "EUR", category: "transfer", reviewStatus: "pending_review", hasPhoto: true },
  ];

  const allOpsForReceipts = operationRows.filter((o) => o.status !== "cancelled");
  const receiptValues = receiptTemplates.map((tpl, i) => {
    const op = allOpsForReceipts[i % allOpsForReceipts.length];
    return {
      operationId: op.id,
      amount: tpl.amount,
      currency: tpl.currency,
      supplierName: tpl.supplierName,
      receiptDate: daysAgo(Math.floor(Math.random() * 40) + 1),
      guideNote: `${tpl.category.charAt(0).toUpperCase() + tpl.category.slice(1)} harcaması — ${tpl.supplierName}. ${DEMO}`,
      photoObjectPath: tpl.hasPhoto ? `demo/receipts/receipt_${String(i + 1).padStart(3, "0")}.jpg` : null,
      reviewStatus: tpl.reviewStatus,
      reviewNotes:
        tpl.reviewStatus === "rejected"
          ? "Operasyon kapsamı dışında harcama."
          : tpl.reviewStatus === "missing_information"
          ? "Makbuz tarih ve tutar bilgisi okunaksız. Tekrar yükleyin."
          : null,
      reviewedByProfileId: ["approved", "rejected"].includes(tpl.reviewStatus) ? seedProfileId : null,
      reviewedAt: ["approved", "rejected"].includes(tpl.reviewStatus) ? tsAgo(1) : null,
      ocrStatus: tpl.hasPhoto ? "processed" : "not_started",
      createdByUserId: "demo_seed_admin_v1",
    };
  });
  await db.insert(operationReceiptsTable).values(receiptValues);
  console.log(`✓ ${receiptValues.length} operation receipts created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. ACCOUNTING TRANSACTIONS (60 — spanning last 6 months for chart data)
  // ═══════════════════════════════════════════════════════════════════════════
  type TxStatus = "pending" | "paid" | "partially_paid" | "cancelled";
  type AccStatus = "pending_review" | "approved" | "rejected" | "missing_information";

  const months = [
    // [daysAgoCentre, month label]
    [170, "Şubat"],
    [140, "Mart"],
    [110, "Nisan"],
    [80, "Mayıs"],
    [50, "Haziran"],
    [20, "Temmuz"],
  ];

  // Income transactions (36 total, 6/month)
  const incomeTemplates = [
    { desc: "Efes tam gün turu — 2 yetişkin", amount: 720, currency: "EUR", cat: "tour_income", custIdx: 0 },
    { desc: "Pamukkale konaklamalı paket — 2 kişi", amount: 27000, currency: "TRY", cat: "tour_income", custIdx: 1 },
    { desc: "Bodrum Blue Cruise — 6 kişilik gulet", amount: 5500, currency: "EUR", cat: "tour_income", custIdx: 3 },
    { desc: "İzmir MICE grubu turu — 12 kişi", amount: 2200, currency: "EUR", cat: "tour_income", custIdx: 4 },
    { desc: "Kuşadası alışveriş turu — kruvaziyer grubu", amount: 870, currency: "EUR", cat: "tour_income", custIdx: 6 },
    { desc: "Kemal Arslan şirket gezisi — 25 kişi avansı", amount: 15000, currency: "TRY", cat: "advance_payment", custIdx: 21 },
  ];

  // Expense transactions (24 total, 4/month)
  const expenseTemplates = [
    { desc: "Ege Transfer Hizmetleri — aylık özet fatura", amount: 3200, currency: "TRY", cat: "transport_expense", suppIdx: 0 },
    { desc: "Rehber ödemeleri — aylık toplam", amount: 1800, currency: "EUR", cat: "guide_expense", suppIdx: null },
    { desc: "Otel komisyon ödemeleri", amount: 4500, currency: "TRY", cat: "accommodation_expense", suppIdx: null },
    { desc: "Yakıt ve araç masrafları", amount: 2100, currency: "TRY", cat: "vehicle_expense", suppIdx: null },
  ];

  const txValues: Array<{
    type: "income" | "expense";
    category: string;
    amount: number;
    currency: string;
    exchangeRate?: number | null;
    amountTry?: number | null;
    taxRate?: number | null;
    taxAmount?: number | null;
    netAmount?: number | null;
    paymentMethod?: string | null;
    paymentStatus: TxStatus;
    accountingStatus: AccStatus;
    transactionDate: string;
    dueDate?: string | null;
    paidAt?: Date | null;
    description: string;
    documentNumber?: string | null;
    customerId?: number | null;
    supplierId?: number | null;
    operationId?: number | null;
    createdByProfileId: number;
    approvedByProfileId?: number | null;
    approvedAt?: Date | null;
  }> = [];

  months.forEach(([centre], mIdx) => {
    const offset = centre as number;

    // Income entries
    incomeTemplates.forEach((tpl, tIdx) => {
      const paid = mIdx < 4 || tIdx < 3;
      const accStatus: AccStatus = mIdx < 3 ? "approved" : mIdx < 5 ? "approved" : "pending_review";
      const exRate = tpl.currency === "EUR" ? 36.5 : tpl.currency === "USD" ? 33.8 : 1;
      const vat = 20;
      const net = Math.round(tpl.amount / 1.2);
      const taxAmt = tpl.amount - net;
      txValues.push({
        type: "income",
        category: tpl.cat,
        amount: tpl.amount,
        currency: tpl.currency,
        exchangeRate: tpl.currency !== "TRY" ? exRate : null,
        amountTry: tpl.currency !== "TRY" ? Math.round(tpl.amount * exRate) : tpl.amount,
        taxRate: vat,
        taxAmount: taxAmt,
        netAmount: net,
        paymentMethod: tIdx % 3 === 0 ? "Havale/EFT" : tIdx % 3 === 1 ? "Kredi Kartı" : "Nakit",
        paymentStatus: paid ? "paid" : mIdx === 4 ? "partially_paid" : "pending",
        accountingStatus: accStatus,
        transactionDate: daysAgo(offset - tIdx * 2),
        dueDate: daysAgo(offset - 14),
        paidAt: paid ? tsAgo(offset - tIdx * 2 - 3) : null,
        description: `${tpl.desc} — ${months[mIdx][1]} 2026. ${DEMO}`,
        documentNumber: `TRP-GEL-${String(mIdx * 10 + tIdx + 1).padStart(4, "0")}`,
        customerId: customerRows[tpl.custIdx]?.id ?? null,
        createdByProfileId: seedProfileId,
        approvedByProfileId: accStatus === "approved" ? seedProfileId : null,
        approvedAt: accStatus === "approved" ? tsAgo(offset - 5) : null,
      });
    });

    // Expense entries
    expenseTemplates.forEach((tpl, tIdx) => {
      const accStatus: AccStatus = mIdx < 3 ? "approved" : "pending_review";
      const exRate = tpl.currency === "EUR" ? 36.5 : 1;
      txValues.push({
        type: "expense",
        category: tpl.cat,
        amount: tpl.amount,
        currency: tpl.currency,
        exchangeRate: tpl.currency !== "TRY" ? exRate : null,
        amountTry: tpl.currency !== "TRY" ? Math.round(tpl.amount * exRate) : tpl.amount,
        taxRate: 20,
        taxAmount: Math.round(tpl.amount * 0.2 / 1.2),
        netAmount: Math.round(tpl.amount / 1.2),
        paymentMethod: tIdx % 2 === 0 ? "Havale/EFT" : "Kredi Kartı",
        paymentStatus: mIdx < 4 ? "paid" : "pending",
        accountingStatus: accStatus,
        transactionDate: daysAgo(offset - tIdx * 3),
        dueDate: daysAgo(offset - 21),
        paidAt: mIdx < 4 ? tsAgo(offset - tIdx * 3 - 7) : null,
        description: `${tpl.desc} — ${months[mIdx][1]} 2026. ${DEMO}`,
        documentNumber: `TRP-GID-${String(mIdx * 10 + tIdx + 1).padStart(4, "0")}`,
        supplierId: tpl.suppIdx !== null ? supplierRows[tpl.suppIdx]?.id ?? null : null,
        createdByProfileId: seedProfileId,
        approvedByProfileId: accStatus === "approved" ? seedProfileId : null,
        approvedAt: accStatus === "approved" ? tsAgo(offset - 10) : null,
      });
    });
  });

  // A few USD transactions
  txValues.push(
    {
      type: "income",
      category: "tour_income",
      amount: 3200,
      currency: "USD",
      exchangeRate: 33.8,
      amountTry: 108160,
      taxRate: 20,
      taxAmount: Math.round(3200 * 0.2 / 1.2),
      netAmount: Math.round(3200 / 1.2),
      paymentMethod: "Havale/EFT",
      paymentStatus: "paid",
      accountingStatus: "approved",
      transactionDate: daysAgo(90),
      paidAt: tsAgo(88),
      description: `Wang Lei grubu — ön ödeme. ${DEMO}`,
      documentNumber: "TRP-GEL-0091",
      customerId: custByName["Wang Lei"],
      createdByProfileId: seedProfileId,
      approvedByProfileId: seedProfileId,
      approvedAt: tsAgo(85),
    },
    {
      type: "expense",
      category: "software_expense",
      amount: 149,
      currency: "USD",
      exchangeRate: 33.8,
      amountTry: 5036,
      taxRate: 0,
      taxAmount: 0,
      netAmount: 149,
      paymentMethod: "Kredi Kartı",
      paymentStatus: "paid",
      accountingStatus: "approved",
      transactionDate: daysAgo(60),
      paidAt: tsAgo(58),
      description: `Yazılım aboneliği (USD) — yıllık plan. ${DEMO}`,
      documentNumber: "TRP-GID-0092",
      createdByProfileId: seedProfileId,
      approvedByProfileId: seedProfileId,
      approvedAt: tsAgo(56),
    }
  );

  const insertedTxRows = await db
    .insert(accountingTransactionsTable)
    .values(txValues)
    .returning();
  console.log(`✓ ${insertedTxRows.length} accounting transactions created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. ACCOUNTING DOCUMENTS (20)
  // ═══════════════════════════════════════════════════════════════════════════
  type DocType = "receipt" | "invoice" | "expense_note" | "other";
  type DocReviewStatus = "pending" | "approved" | "rejected" | "missing_information";

  const docTemplates: Array<{
    docType: DocType;
    fileName: string;
    mimeType: string;
    reviewStatus: DocReviewStatus;
    ocrStatus: string;
    notes: string;
    txIdx?: number;
    custIdx?: number;
    suppIdx?: number;
  }> = [
    { docType: "invoice", fileName: "fatura_ege_transfer_subat.pdf", mimeType: "application/pdf", reviewStatus: "approved", ocrStatus: "not_processed", notes: `Ege Transfer Şubat faturası. ${DEMO}`, txIdx: 0, suppIdx: 0 },
    { docType: "receipt", fileName: "makbuz_efes_lokantasi_001.jpg", mimeType: "image/jpeg", reviewStatus: "approved", ocrStatus: "processed", notes: `OCR ile işlendi. ${DEMO}`, txIdx: 3 },
    { docType: "invoice", fileName: "fatura_pamukkale_resort.pdf", mimeType: "application/pdf", reviewStatus: "approved", ocrStatus: "not_processed", notes: `Pamukkale Termal otel konaklaması. ${DEMO}`, suppIdx: 1 },
    { docType: "expense_note", fileName: "masraf_formu_mart.pdf", mimeType: "application/pdf", reviewStatus: "approved", ocrStatus: "not_processed", notes: `Mart ayı genel masraf formu. ${DEMO}` },
    { docType: "receipt", fileName: "makbuz_yakit_selcuk.jpg", mimeType: "image/jpeg", reviewStatus: "approved", ocrStatus: "processed", notes: `Yakıt makbuzu OCR ile doğrulandı. ${DEMO}` },
    { docType: "invoice", fileName: "fatura_bodrum_bay.pdf", mimeType: "application/pdf", reviewStatus: "approved", ocrStatus: "not_processed", notes: `Bodrum Bay otel faturası. ${DEMO}`, suppIdx: 1 },
    { docType: "receipt", fileName: "makbuz_liman_restoran.jpg", mimeType: "image/jpeg", reviewStatus: "pending", ocrStatus: "processed", notes: `İnceleme bekliyor. ${DEMO}`, custIdx: 3 },
    { docType: "invoice", fileName: "fatura_ege_transfer_nisan.pdf", mimeType: "application/pdf", reviewStatus: "pending", ocrStatus: "not_processed", notes: `Nisan transfer faturası — inceleme bekliyor. ${DEMO}`, suppIdx: 0 },
    { docType: "receipt", fileName: "makbuz_bodrum_restoran.jpg", mimeType: "image/jpeg", reviewStatus: "pending", ocrStatus: "failed", notes: `OCR başarısız oldu, manuel inceleme gerekiyor. ${DEMO}` },
    { docType: "expense_note", fileName: "masraf_formu_mayis.pdf", mimeType: "application/pdf", reviewStatus: "pending", ocrStatus: "not_processed", notes: `Mayıs masraf formu — muhasebe incelemesinde. ${DEMO}` },
    { docType: "receipt", fileName: "makbuz_rehber_odeme_haziran.jpg", mimeType: "image/jpeg", reviewStatus: "pending", ocrStatus: "processed", notes: `Rehber ödemesi makbuzu. ${DEMO}` },
    { docType: "invoice", fileName: "fatura_iz_transfer_haziran.pdf", mimeType: "application/pdf", reviewStatus: "pending", ocrStatus: "not_processed", notes: `${DEMO}`, suppIdx: 0 },
    { docType: "receipt", fileName: "makbuz_musteri_avans.jpg", mimeType: "image/jpeg", reviewStatus: "missing_information", ocrStatus: "processed", notes: `Müşteri adı ve tarih bilgisi eksik. Tekrar yüklenecek. ${DEMO}` },
    { docType: "invoice", fileName: "fatura_belirsiz_001.pdf", mimeType: "application/pdf", reviewStatus: "missing_information", ocrStatus: "not_processed", notes: `Fatura numarası ve firma bilgisi okunaksız. ${DEMO}` },
    { docType: "expense_note", fileName: "masraf_onaysiz.pdf", mimeType: "application/pdf", reviewStatus: "rejected", ocrStatus: "not_processed", notes: `Ret sebebi: Operasyon kapsamı dışında harcama. ${DEMO}` },
    { docType: "receipt", fileName: "makbuz_ret_kisisel.jpg", mimeType: "image/jpeg", reviewStatus: "rejected", ocrStatus: "failed", notes: `Ret: Kişisel alışveriş fişi. ${DEMO}` },
    { docType: "invoice", fileName: "fatura_ege_yat_bcr.pdf", mimeType: "application/pdf", reviewStatus: "approved", ocrStatus: "not_processed", notes: `Ege Yat Turları Blue Cruise faturası. ${DEMO}`, suppIdx: 10 },
    { docType: "receipt", fileName: "makbuz_efes_giris_toplu.jpg", mimeType: "image/jpeg", reviewStatus: "approved", ocrStatus: "processed", notes: `Efes grup giriş biletleri toplu makbuzu. ${DEMO}` },
    { docType: "expense_note", fileName: "masraf_formu_temmuz.pdf", mimeType: "application/pdf", reviewStatus: "pending", ocrStatus: "not_processed", notes: `Temmuz ayı masraf özeti — imza bekliyor. ${DEMO}` },
    { docType: "other", fileName: "contract_bodrum_yat.pdf", mimeType: "application/pdf", reviewStatus: "approved", ocrStatus: "not_processed", notes: `Ege Yat kira sözleşmesi. ${DEMO}`, suppIdx: 10 },
  ];

  const docValues = docTemplates.map((tpl, i) => ({
    documentType: tpl.docType,
    operationId: allOpsForReceipts[i % allOpsForReceipts.length]?.id ?? null,
    transactionId: tpl.txIdx !== undefined ? insertedTxRows[tpl.txIdx]?.id ?? null : null,
    supplierId: tpl.suppIdx !== undefined ? supplierRows[tpl.suppIdx]?.id ?? null : null,
    customerId: tpl.custIdx !== undefined ? customerRows[tpl.custIdx]?.id ?? null : null,
    objectPath: `demo/accounting/${tpl.fileName}`,
    originalFileName: tpl.fileName,
    mimeType: tpl.mimeType,
    fileSize: Math.floor(Math.random() * 400000) + 50000,
    ocrStatus: tpl.ocrStatus,
    reviewStatus: tpl.reviewStatus,
    notes: tpl.notes,
    createdByProfileId: seedProfileId,
    reviewedByProfileId: ["approved", "rejected"].includes(tpl.reviewStatus) ? seedProfileId : null,
    reviewedAt: ["approved", "rejected"].includes(tpl.reviewStatus) ? tsAgo(5 + i) : null,
  }));
  await db.insert(accountingDocumentsTable).values(docValues);
  console.log(`✓ ${docValues.length} accounting documents created`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. NOTIFICATIONS (15)
  // ═══════════════════════════════════════════════════════════════════════════
  await db.insert(notificationsTable).values([
    {
      type: "quotation_sent",
      title: "Yeni Teklif Gönderildi",
      message: `DEMO-TEK-0010 numaralı teklif Hans Becker grubuna gönderildi. ${DEMO}`,
      relatedId: quotByNumber["DEMO-TEK-0010"],
      relatedType: "quotation",
      isRead: true,
      readAt: tsAgo(28),
    },
    {
      type: "quotation_accepted",
      title: "Teklif Kabul Edildi",
      message: `DEMO-TEK-0004 numaralı Blue Cruise teklifi Isabella Martinez tarafından kabul edildi. ${DEMO}`,
      relatedId: quotByNumber["DEMO-TEK-0004"],
      relatedType: "quotation",
      isRead: true,
      readAt: tsAgo(18),
    },
    {
      type: "operation_scheduled",
      title: "Operasyon Planlandı",
      message: `Bodrum Blue Cruise operasyonu ${daysFromNow(10)} tarihine planlandı. Rehber: Kadir Yılmaz. ${DEMO}`,
      relatedId: operationRows[8]?.id,
      relatedType: "operation",
      isRead: false,
    },
    {
      type: "operation_starting_soon",
      title: "Yaklaşan Operasyon Hatırlatması",
      message: `Becker grubu Efes Excursion 20 gün sonra. Almanca rehber ve büyük otobüs konfirmasyonu gerekli. ${DEMO}`,
      relatedId: operationRows[10]?.id,
      relatedType: "operation",
      isRead: false,
    },
    {
      type: "receipt_missing",
      title: "Eksik Makbuz Uyarısı",
      message: `Şirince turu için öğle yemeği makbuzu henüz yüklenmedi. ${DEMO}`,
      relatedId: operationRows[5]?.id,
      relatedType: "operation",
      isRead: false,
    },
    {
      type: "document_approved",
      title: "Belge Onaylandı",
      message: `Ege Yat Turları Blue Cruise faturası muhasebe tarafından onaylandı. ${DEMO}`,
      relatedType: "accounting_document",
      isRead: true,
      readAt: tsAgo(3),
    },
    {
      type: "document_rejected",
      title: "Belge Reddedildi",
      message: `Kişisel alışveriş makbuzu reddedildi. Operasyon kapsamı dışında harcama. ${DEMO}`,
      relatedType: "accounting_document",
      isRead: true,
      readAt: tsAgo(2),
    },
    {
      type: "payment_reminder",
      title: "Ödeme Hatırlatması",
      message: `Hans Becker grubu için kalan %70 ödeme (2.800 EUR) tur başlangıcından 3 gün önce bekleniyor. ${DEMO}`,
      relatedId: quotByNumber["DEMO-TEK-0010"],
      relatedType: "quotation",
      isRead: false,
    },
    {
      type: "payment_reminder",
      title: "Geciken Ödeme Uyarısı",
      message: `François Dubois teklifi için ön ödeme alınmadı. Teklif geçerlilik süresi yaklaşıyor. ${DEMO}`,
      relatedId: quotByNumber["DEMO-TEK-0012"],
      relatedType: "quotation",
      isRead: false,
    },
    {
      type: "quotation_expiring",
      title: "Teklif Süresi Doluyor",
      message: `DEMO-TEK-0009 numaralı 12 Ada tekne turu teklifi 9 gün içinde geçerliliğini kaybedecek. ${DEMO}`,
      relatedId: quotByNumber["DEMO-TEK-0009"],
      relatedType: "quotation",
      isRead: false,
    },
    {
      type: "document_needs_info",
      title: "Belge Düzeltme Gerekiyor",
      message: `Bilinmeyen fatura belgesinde firma adı ve tarih bilgisi eksik. Yeniden yüklenmesi gerekiyor. ${DEMO}`,
      relatedType: "accounting_document",
      isRead: false,
    },
    {
      type: "operation_completed",
      title: "Operasyon Tamamlandı",
      message: `Emma Johnson Bodrum Kale turu başarıyla tamamlandı. Makbuzlar kontrol ediliyor. ${DEMO}`,
      relatedId: operationRows[4]?.id,
      relatedType: "operation",
      isRead: true,
      readAt: tsAgo(4),
    },
    {
      type: "receipt_review_pending",
      title: "Makbuz İnceleme Kuyruğu",
      message: `12 yeni makbuz muhasebe incelemesi bekliyor. ${DEMO}`,
      relatedType: "operation",
      isRead: false,
    },
    {
      type: "quotation_accepted",
      title: "Teklif Onayı — Kemal Arslan",
      message: `DEMO-TEK-0020 numaralı 25 kişilik şirket gezisi teklifi kabul edildi. 15.000 TRY avans alındı. ${DEMO}`,
      relatedId: quotByNumber["DEMO-TEK-0020"],
      relatedType: "quotation",
      isRead: true,
      readAt: tsAgo(23),
    },
    {
      type: "operation_guide_assigned",
      title: "Rehber Atandı",
      message: `Bergama Akropol turu için Nilay Şahin atandı. Konfirmasyon SMS gönderildi. ${DEMO}`,
      relatedId: operationRows[9]?.id,
      relatedType: "operation",
      isRead: false,
    },
  ]);
  console.log("✓ 15 notifications created");

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);

  console.log(`
╔══════════════════════════════════════════════════════╗
║         TourPilot Demo Seed — Complete               ║
╠══════════════════════════════════════════════════════╣
║  Table                          Rows created         ║
╠══════════════════════════════════════════════════════╣
║  profiles (demo)                1                    ║
║  customers                      ${String(customerRows.length).padEnd(21)} ║
║  suppliers (new)                ${String(supplierRows.length).padEnd(21)} ║
║  tours                          ${String(tourRows.length).padEnd(21)} ║
║  tour_costs                     15                   ║
║  quotations                     ${String(quotationRows.length).padEnd(21)} ║
║  operations                     ${String(operationRows.length).padEnd(21)} ║
║  operation_tasks                ${String(taskValues.length).padEnd(21)} ║
║  operation_receipts             ${String(receiptValues.length).padEnd(21)} ║
║  accounting_transactions        ${String(insertedTxRows.length).padEnd(21)} ║
║  accounting_documents           ${String(docValues.length).padEnd(21)} ║
║  notifications                  15                   ║
╠══════════════════════════════════════════════════════╣
║  Execution time: ${elapsed}s                       ║
╠══════════════════════════════════════════════════════╣
║  Dashboard highlights:                               ║
║  • 25 customers, 8 nationalities                     ║
║  • 5 completed | 3 active | 5 upcoming | 2 cancelled ║
║  • 6-month income/expense chart data (Feb–Aug 2026)  ║
║  • 40 field receipts (approved/pending/rejected)     ║
║  • 60+ accounting transactions (TRY/EUR/USD)         ║
║  • 12 accounting documents in review queue           ║
╚══════════════════════════════════════════════════════╝

Sign in with any Clerk-invited user to explore demo data.
Run  pnpm seed:demo:reset  to remove all demo records.
`);
}

main().catch((err) => {
  console.error("❌ Demo seed failed:", err);
  process.exit(1);
});

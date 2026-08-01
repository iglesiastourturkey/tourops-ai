/**
 * Seed script: run with `pnpm --filter @workspace/api-server run seed`
 * Inserts demo suppliers, a customer, and a sample tour for Kuşadası/Efes region.
 */
import { db } from "@workspace/db";
import {
  suppliersTable, customersTable, toursTable, tourCostsTable,
  tourDaysTable, quotationsTable, agencySettingsTable, exchangeRatesTable,
  emailTemplatesTable, notificationsTable,
} from "@workspace/db/schema";

async function main() {
  console.log("🌱 Seeding database...");

  // Agency settings
  const [agencyCount] = await db.select().from(agencySettingsTable);
  if (!agencyCount) {
    await db.insert(agencySettingsTable).values({
      name: "Ege Tur & Gezi Acentesi",
      address: "Atatürk Bulvarı No:45, Kuşadası, Aydın",
      phone: "+90 256 614 0000",
      email: "info@egeturve gezi.com",
      website: "https://egetur.com",
      defaultCurrency: "EUR",
      defaultProfitMargin: 22,
      minProfitWarning: 10,
      defaultQuotationValidity: 7,
      cancellationPolicy: "Turdan 48 saat öncesine kadar ücretsiz iptal. Daha sonraki iptallerde %50 iade yapılmaz.",
      paymentTerms: "%30 ön ödeme ile rezervasyon onaylanır, kalan %70 tur başlangıcından 3 gün önce ödenir.",
      cruiseSafetyBufferMinutes: 45,
    });
    console.log("✓ Agency settings created");
  }

  // Exchange rates
  const existingRates = await db.select().from(exchangeRatesTable);
  if (existingRates.length === 0) {
    await db.insert(exchangeRatesTable).values([
      { fromCurrency: "EUR", toCurrency: "TRY", rate: 36.5 },
      { fromCurrency: "USD", toCurrency: "TRY", rate: 33.8 },
      { fromCurrency: "GBP", toCurrency: "TRY", rate: 42.1 },
      { fromCurrency: "TRY", toCurrency: "EUR", rate: 0.0274 },
      { fromCurrency: "TRY", toCurrency: "USD", rate: 0.0296 },
    ]);
    console.log("✓ Exchange rates created");
  }

  // Email templates
  const existingTemplates = await db.select().from(emailTemplatesTable);
  if (existingTemplates.length === 0) {
    await db.insert(emailTemplatesTable).values([
      {
        name: "Teklif E-postası (TR)",
        type: "quotation",
        language: "tr",
        subject: "{{ajanAdi}} - Tur Teklifiniz Hazır | {{teklifNo}}",
        body: `Sayın {{musteriAdi}},\n\nTur talebinize özel hazırladığımız teklifimizi aşağıda bulabilirsiniz.\n\nTEKLİF BİLGİLERİ\n- Teklif No: {{teklifNo}}\n- Tur: {{turAdi}}\n- Tarih: {{baslangicTarihi}} - {{bitisTarihi}}\n- Kişi Sayısı: {{yetiskinSayisi}} yetişkin{{cocukSayisi}}\n- Toplam Fiyat: {{toplamFiyat}} {{para birimi}}\n\nTeklif geçerlilik tarihi: {{gecerlilikTarihi}}\n\nDetaylı bilgi için lütfen bizimle iletişime geçiniz.\n\nSaygılarımızla,\n{{ajanAdi}}\n{{telefon}}`,
      },
      {
        name: "Rezervasyon Onayı (TR)",
        type: "confirmation",
        language: "tr",
        subject: "Rezervasyonunuz Onaylandı - {{turAdi}}",
        body: `Sayın {{musteriAdi}},\n\nRezerasyonunuz başarıyla onaylanmıştır.\n\nTUR BİLGİLERİ\n- Tur: {{turAdi}}\n- Tarih: {{baslangicTarihi}}\n- Buluşma Noktası: {{bulusmaNoktas}}\n- Rehber: {{rehberAdi}}\n\nHerhangi bir sorunuz için lütfen bizimle iletişime geçiniz.\n\nİyi tatiller dileriz!\n{{ajanAdi}}`,
      },
      {
        name: "Quotation Email (EN)",
        type: "quotation",
        language: "en",
        subject: "{{agencyName}} - Your Tour Quotation | {{quotationNumber}}",
        body: `Dear {{customerName}},\n\nPlease find below your personalized tour quotation.\n\nQUOTATION DETAILS\n- Reference: {{quotationNumber}}\n- Tour: {{tourName}}\n- Dates: {{startDate}} - {{endDate}}\n- Guests: {{adultCount}} adults{{childCount}}\n- Total Price: {{totalPrice}} {{currency}}\n\nThis quotation is valid until: {{expiryDate}}\n\nPlease don't hesitate to contact us for any questions.\n\nKind regards,\n{{agencyName}}\n{{phone}}`,
      },
    ]);
    console.log("✓ Email templates created");
  }

  // Suppliers
  const existingSuppliers = await db.select().from(suppliersTable);
  let hotelId: number, transferId: number, guideId: number;

  if (existingSuppliers.length === 0) {
    const suppliers = await db.insert(suppliersTable).values([
      {
        name: "Aqua Fantasy Aquapark Hotel",
        contactPerson: "Mehmet Yılmaz",
        phone: "+90 232 893 1111",
        email: "rezervasyon@aquafantasy.com",
        city: "Kuşadası",
        category: "hotel",
        currency: "EUR",
        rating: 5,
        isActive: true,
        notes: "5 yıldızlı aqua park oteli. Gemi yolcularına özel indirimler mevcut.",
      },
      {
        name: "Ege Transfer Hizmetleri",
        contactPerson: "Ali Kaya",
        phone: "+90 532 444 5566",
        email: "info@egetransfer.com",
        city: "Kuşadası",
        category: "transfer",
        currency: "EUR",
        rating: 4.5,
        isActive: true,
        notes: "Liman transferleri ve havalimanı VIP transferlerde uzmanlaşmış.",
      },
      {
        name: "Rehber Ahmet Şen",
        contactPerson: "Ahmet Şen",
        phone: "+90 533 777 8899",
        email: "ahmetsen.rehber@gmail.com",
        city: "Selçuk",
        category: "guide",
        currency: "EUR",
        rating: 5,
        isActive: true,
        notes: "Efes ve çevresi uzmanı. İngilizce, Almanca, Fransızca rehberlik.",
      },
      {
        name: "Şirince Ev Yemekleri",
        contactPerson: "Fatma Hanım",
        phone: "+90 232 898 3030",
        email: "info@sirince-ev.com",
        city: "Şirince",
        category: "restaurant",
        currency: "TRY",
        rating: 4.8,
        isActive: true,
        notes: "Şirince köyünde geleneksel Ege mutfağı. Grup rezervasyonu için önceden bildirim şart.",
      },
      {
        name: "Pamukkale Termal Resort",
        contactPerson: "Kemal Demir",
        phone: "+90 258 272 2000",
        email: "rezervasyon@pamukkaletermal.com",
        city: "Denizli",
        category: "hotel",
        currency: "EUR",
        rating: 4,
        isActive: true,
        notes: "Pamukkale travertenlerine yürüme mesafesinde. Termal havuz dahil.",
      },
      {
        name: "Royal Efes Aktivite",
        contactPerson: "Burak Arslan",
        phone: "+90 256 618 4455",
        email: "burak@royalefes.com",
        city: "Selçuk",
        category: "activity",
        currency: "EUR",
        rating: 4.2,
        isActive: true,
        notes: "Efes turu, Meryem Ana, Şirince kombinasyon aktiviteleri.",
      },
    ]).returning();
    hotelId = suppliers[0].id;
    transferId = suppliers[1].id;
    guideId = suppliers[2].id;
    console.log("✓ Suppliers created");
  } else {
    hotelId = existingSuppliers.find(s => s.category === "hotel")?.id ?? existingSuppliers[0].id;
    transferId = existingSuppliers.find(s => s.category === "transfer")?.id ?? existingSuppliers[0].id;
    guideId = existingSuppliers.find(s => s.category === "guide")?.id ?? existingSuppliers[0].id;
  }

  // Customers
  const existingCustomers = await db.select().from(customersTable);
  let customerId: number;

  if (existingCustomers.length === 0) {
    const [customer] = await db.insert(customersTable).values([
      {
        name: "James & Sarah Mitchell",
        company: null,
        nationality: "İngiliz",
        language: "İngilizce",
        phone: "+44 7700 900123",
        email: "james.mitchell@email.com",
        whatsapp: "+44 7700 900123",
        customerType: "family",
        travelPreferences: "Tarihi yerler, yürüyüş, yerel mutfak. Lüks otel tercih ediyor.",
        dietaryRestrictions: "Gluten intoleransı (Sarah)",
        passportStatus: "verified",
        notes: "MSC Cruises ile Kuşadası limanına geliyor. 3 çocuk, 8-12 yaş.",
      },
    ]).returning();
    customerId = customer.id;

    await db.insert(customersTable).values([
      {
        name: "Dr. Hans Weber",
        company: "Weber GmbH",
        nationality: "Alman",
        language: "Almanca, İngilizce",
        phone: "+49 89 12345678",
        email: "h.weber@webgmbh.de",
        customerType: "corporate",
        travelPreferences: "Kültürel turlar, müze ziyaretleri. Şirket grupları için paket istiyor.",
        passportStatus: "received",
        notes: "Yıllık kurumsal grup turu planlıyor. 15-20 kişilik.",
      },
    ]);

    console.log("✓ Customers created");
  } else {
    customerId = existingCustomers[0].id;
  }

  // Sample tour
  const existingTours = await db.select().from(toursTable);
  if (existingTours.length === 0) {
    const [tour] = await db.insert(toursTable).values({
      name: "Efes & Şirince Günübirlik Tur",
      code: "EFE-2026-001",
      customerId,
      startDate: "2026-08-15",
      endDate: "2026-08-15",
      nights: 0,
      adultCount: 2,
      childCount: 3,
      mainDestination: "Selçuk",
      tourType: "cultural",
      status: "approved",
      guideLanguage: "İngilizce",
      transferRequired: true,
      isCruiseExcursion: true,
      shipName: "MSC Virtuosa",
      portName: "Kuşadası Limanı",
      shipArrivalTime: "08:00",
      shipDepartureTime: "18:00",
      cruiseSafetyBufferMinutes: 45,
      profitMargin: 25,
      notes: "Mitchell ailesi kruvaziyer excursion turu",
    }).returning();

    await db.insert(tourDaysTable).values([
      {
        tourId: tour.id,
        dayNumber: 1,
        title: "Efes Antik Kenti & Şirince Köyü",
        summary: "Sabah Efes turu, öğle Şirince'de yöresel yemek, öğleden sonra serbest zaman",
        startTime: "08:45",
        endTime: "17:15",
        locations: "Kuşadası Limanı → Efes Antik Kenti → Şirince → Kuşadası Limanı",
        activities: "Efes Antik Kenti gezisi (Celsus Kütüphanesi, Tiyatro, Mermer Yol), Meryem Ana Evi, Şirince köyü, şarap tadımı",
        mealPlan: "Şirince'de öğle yemeği (Şirince Ev Yemekleri)",
        transportPlan: "Özel minibüs (8 kişilik), klimalı, çocuk koltuğu",
        estimatedDrivingMinutes: 90,
        estimatedActivityMinutes: 330,
        accessibilityNotes: "Efes'te zeminde kaldırım taşları var. Çocuklar için rahat ayakkabı önerilir.",
        operationalNotes: "Gemiden 45 dakika önce limanda olmak zorunlu. Rehber 08:30'da kapıda bekleyecek.",
        sortOrder: 1,
      },
    ]);

    await db.insert(tourCostsTable).values([
      {
        tourId: tour.id, supplierId: transferId,
        description: "Özel minibüs transferi (Liman - Efes - Şirince - Liman)",
        category: "transfer", quantity: 1, unitCost: 180, currency: "EUR",
        taxRate: 0, total: 180, isPerPerson: false, isConfirmed: true,
      },
      {
        tourId: tour.id, supplierId: guideId,
        description: "İngilizce rehber (tam gün, 8 saat)",
        category: "guide", quantity: 1, unitCost: 150, currency: "EUR",
        taxRate: 0, total: 150, isPerPerson: false, isConfirmed: true,
      },
      {
        tourId: tour.id,
        description: "Efes Antik Kenti giriş (yetişkin)",
        category: "activity", quantity: 2, unitCost: 18, currency: "EUR",
        taxRate: 0, total: 36, isPerPerson: true, isConfirmed: true,
      },
      {
        tourId: tour.id,
        description: "Efes Antik Kenti giriş (çocuk)",
        category: "activity", quantity: 3, unitCost: 9, currency: "EUR",
        taxRate: 0, total: 27, isPerPerson: true, isConfirmed: true,
      },
      {
        tourId: tour.id,
        description: "Öğle yemeği (Şirince Ev Yemekleri)",
        category: "restaurant", quantity: 5, unitCost: 25, currency: "EUR",
        taxRate: 0, total: 125, isPerPerson: true, isConfirmed: false,
      },
    ]);

    // Quotation for the tour
    const [quot] = await db.insert(quotationsTable).values({
      number: "TEK-202608-0001",
      customerId,
      tourId: tour.id,
      expiresAt: "2026-08-01",
      currency: "EUR",
      subtotal: 640,
      discount: 0,
      finalPrice: 640,
      paymentTerms: "%30 ön ödeme, kalan %70 tur başlangıcında",
      cancellationPolicy: "48 saat öncesine kadar ücretsiz iptal",
      includedServices: "Özel araç, İngilizce rehber, Efes giriş biletleri, öğle yemeği",
      excludedServices: "Kişisel alışveriş, şarap tadımı (isteğe bağlı)",
      status: "sent",
      sentAt: new Date(),
    }).returning();

    // Notification
    await db.insert(notificationsTable).values({
      type: "quotation_sent",
      title: "Teklif Gönderildi",
      message: `${quot.number} numaralı teklif Mitchell ailesine gönderildi`,
      relatedId: quot.id,
      relatedType: "quotation",
      isRead: false,
    });

    // Second tour (Pamukkale)
    await db.insert(toursTable).values({
      name: "Pamukkale & Hierapolis 2 Gece",
      code: "PAM-2026-001",
      customerId,
      startDate: "2026-09-10",
      endDate: "2026-09-12",
      nights: 2,
      adultCount: 4,
      childCount: 0,
      mainDestination: "Denizli",
      tourType: "cultural",
      status: "draft",
      guideLanguage: "Almanca",
      transferRequired: true,
      isCruiseExcursion: false,
      profitMargin: 20,
      notes: "Weber grubu için pilot tur",
    });

    console.log("✓ Tours, costs, quotation, notifications created");
  }

  console.log("✅ Seed complete!");
  process.exit(0);
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});

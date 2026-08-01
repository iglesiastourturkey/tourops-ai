/**
 * Quotation PDF export — lazy-loaded (pdfmake only bundled on demand).
 * Generates a professional A4 Turkish PDF with full Unicode support via Roboto.
 */
import type { Quotation, Customer, Tour, TourDay, AgencySettings } from '@workspace/api-client-react';

// ─── helpers ─────────────────────────────────────────────────────────────────

function trDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function trCurrency(amount: number | null | undefined, currency = 'TRY'): string {
  if (amount == null) return '-';
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
}

function trToday(): string {
  return new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ─── brand constants ──────────────────────────────────────────────────────────

const NAVY   = '#1a3c5e';
const ORANGE = '#e8922a';
const GRAY   = '#666666';
const LIGHT  = '#f7f8fa';
const WHITE  = '#ffffff';
const BLACK  = '#1a1a1a';

// ─── section helper ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function section(title: string, content: any[]): any[] {
  return [
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 22, r: 3, color: NAVY }] },
    {
      text: title,
      fontSize: 10,
      bold: true,
      color: WHITE,
      margin: [6, -18, 0, 6],
    },
    ...content,
    { text: '', margin: [0, 8, 0, 0] },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function infoRow(label: string, value: string, last = false): any {
  return {
    columns: [
      { text: label, width: 140, fontSize: 9, color: GRAY, bold: true },
      { text: value || '-', fontSize: 9, color: BLACK },
    ],
    margin: [0, 3, 0, last ? 0 : 1],
  };
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function generateQuotationPdf(
  quotation: Quotation,
  customer: Customer | null,
  tour: Tour | null,
  tourDays: TourDay[],
  agencySettings: AgencySettings | null,
): Promise<void> {
  // Dynamic imports — pdfmake stays out of the initial bundle
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMakeModule = await import('pdfmake') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const robotoModule  = await import('pdfmake/build/fonts/Roboto') as any;

  const pdfMake = pdfMakeModule.default ?? pdfMakeModule;
  const roboto  = robotoModule.default   ?? robotoModule;

  pdfMake.addFontContainer(roboto);

  const agencyName    = agencySettings?.name    ?? 'TourOps Acentesi';
  const agencyWebsite = agencySettings?.website ?? '';
  const agencyEmail   = agencySettings?.email   ?? '';
  const agencyPhone   = agencySettings?.phone   ?? '';

  const sortedDays = [...tourDays].sort((a, b) => a.dayNumber - b.dayNumber);

  // ── day-by-day itinerary content ──────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itineraryContent: any[] = [];
  if (sortedDays.length === 0) {
    itineraryContent.push({ text: 'Günlük program bilgisi bulunmamaktadır.', fontSize: 9, color: GRAY, margin: [0, 4, 0, 0] });
  } else {
    for (const day of sortedDays) {
      itineraryContent.push({
        columns: [
          {
            canvas: [{ type: 'rect', x: 0, y: 0, w: 6, h: 14, r: 1, color: ORANGE }],
            width: 12,
          },
          {
            text: `Gün ${day.dayNumber}${day.title ? ` — ${day.title}` : ''}`,
            fontSize: 10,
            bold: true,
            color: NAVY,
            margin: [0, 1, 0, 0],
          },
        ],
        margin: [0, 8, 0, 3],
      });

      const rows: string[][] = [];
      if (day.locations)    rows.push(['📍 Lokasyon', day.locations]);
      if (day.summary)      rows.push(['📋 Özet', day.summary]);
      if (day.activities)   rows.push(['🎯 Aktiviteler', day.activities]);
      if (day.mealPlan)     rows.push(['🍽️ Yemek Planı', day.mealPlan]);
      if (day.transportPlan) rows.push(['🚌 Ulaşım', day.transportPlan]);

      for (const [lbl, val] of rows) {
        itineraryContent.push(infoRow(lbl, val));
      }
    }
  }

  // ── pricing table ─────────────────────────────────────────────────────────
  const cur = quotation.currency ?? 'TRY';
  const discount = quotation.discount ?? 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pricingRows: any[] = [
    [
      { text: 'Kalem', style: 'tableHeader' },
      { text: 'Tutar', style: 'tableHeader', alignment: 'right' },
    ],
    [
      { text: 'Ara Toplam', fontSize: 9 },
      { text: trCurrency(quotation.subtotal, cur), fontSize: 9, alignment: 'right' },
    ],
  ];
  if (discount > 0) {
    pricingRows.push([
      { text: 'İndirim', fontSize: 9, color: '#c0392b' },
      { text: `- ${trCurrency(discount, cur)}`, fontSize: 9, alignment: 'right', color: '#c0392b' },
    ]);
  }
  pricingRows.push([
    { text: 'TOPLAM FİYAT', fontSize: 10, bold: true, color: NAVY },
    { text: trCurrency(quotation.finalPrice, cur), fontSize: 10, bold: true, alignment: 'right', color: NAVY },
  ]);

  // ── document definition ───────────────────────────────────────────────────
  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 100, 40, 70],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: BLACK },

    // ── page header ───────────────────────────────────────────────────────
    header: () => ({
      margin: [40, 20, 40, 0],
      columns: [
        {
          stack: [
            { text: agencyName.toUpperCase(), fontSize: 16, bold: true, color: NAVY },
            { text: 'Profesyonel Tur Operatörü', fontSize: 9, color: ORANGE, margin: [0, 1, 0, 3] },
            {
              text: [
                agencyWebsite ? `🌐 ${agencyWebsite}` : '',
                agencyEmail   ? `  |  ✉ ${agencyEmail}` : '',
                agencyPhone   ? `  |  ☎ ${agencyPhone}` : '',
              ].filter(Boolean).join(''),
              fontSize: 7.5,
              color: GRAY,
            },
          ],
        },
        {
          stack: [
            { text: quotation.number, fontSize: 13, bold: true, color: ORANGE, alignment: 'right' },
            { text: 'TURİSTİK SEYAHAT TEKLİFİ', fontSize: 7, color: NAVY, alignment: 'right', margin: [0, 2, 0, 0] },
          ],
          width: 180,
        },
      ],
    }),

    // ── page footer ───────────────────────────────────────────────────────
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 10, 40, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#cccccc' }] },
        {
          columns: [
            {
              text: `Bu teklif ${trDate(quotation.expiresAt)} tarihine kadar geçerlidir. Düzenleme tarihi: ${trToday()}`,
              fontSize: 7,
              color: GRAY,
              margin: [0, 5, 0, 0],
            },
            {
              text: `${currentPage} / ${pageCount}`,
              alignment: 'right',
              fontSize: 7,
              color: GRAY,
              margin: [0, 5, 0, 0],
            },
          ],
        },
        {
          text: agencyName,
          fontSize: 7,
          color: '#aaaaaa',
          margin: [0, 2, 0, 0],
        },
      ],
    }),

    styles: {
      tableHeader: {
        fontSize: 9,
        bold: true,
        color: WHITE,
        fillColor: NAVY,
      },
      sectionTitle: { fontSize: 10, bold: true, color: WHITE },
    },

    content: [
      // ── customer info ────────────────────────────────────────────────────
      ...section('MÜŞTERİ BİLGİLERİ', [
        infoRow('Ad Soyad', customer?.name ?? '-'),
        infoRow('Şirket', customer?.company ?? '-'),
        infoRow('Uyruk', customer?.nationality ?? '-'),
        infoRow('Telefon', customer?.phone ?? '-'),
        infoRow('E-posta', customer?.email ?? '-'),
        infoRow('WhatsApp', customer?.whatsapp ?? '-', true),
      ]),

      // ── quotation info ───────────────────────────────────────────────────
      ...section('TEKLİF BİLGİLERİ', [
        infoRow('Teklif No', quotation.number),
        infoRow('Durum', statusLabel(quotation.status)),
        infoRow('Son Geçerlilik', trDate(quotation.expiresAt)),
        infoRow('Para Birimi', cur, true),
      ]),

      // ── tour info (conditional) ──────────────────────────────────────────
      ...section('TUR BİLGİLERİ', tour ? [
        infoRow('Tur Adı', tour.name),
        infoRow('Tur Kodu', tour.code),
        infoRow('Başlangıç Tarihi', trDate(tour.startDate)),
        infoRow('Bitiş Tarihi', trDate(tour.endDate)),
        infoRow('Gece Sayısı', String(tour.nights ?? '-')),
        infoRow('Ana Destinasyon', tour.mainDestination ?? '-'),
        infoRow('Tur Türü', tourTypeLabel(tour.tourType)),
        infoRow('Rehber Dili', tour.guideLanguage ?? '-'),
        infoRow('Transfer', tour.transferRequired ? 'Dahil' : 'Dahil Değil', true),
      ] : [
        { text: 'Tur bilgisi eklenmemiştir.', fontSize: 9, color: GRAY, margin: [0, 4, 0, 0] },
      ]),

      // ── passenger counts ─────────────────────────────────────────────────
      ...section('YOLCU SAYISI', tour ? [
        {
          columns: [
            { stack: [{ text: String(tour.adultCount ?? 0), fontSize: 22, bold: true, color: NAVY, alignment: 'center' }, { text: 'Yetişkin', fontSize: 8, color: GRAY, alignment: 'center' }], width: 100 },
            { stack: [{ text: String(tour.childCount ?? 0), fontSize: 22, bold: true, color: ORANGE, alignment: 'center' }, { text: 'Çocuk', fontSize: 8, color: GRAY, alignment: 'center' }], width: 100 },
            { stack: [{ text: String((tour.adultCount ?? 0) + (tour.childCount ?? 0)), fontSize: 22, bold: true, color: '#2d6a4f', alignment: 'center' }, { text: 'Toplam', fontSize: 8, color: GRAY, alignment: 'center' }], width: 100 },
          ],
          margin: [0, 6, 0, 4],
        },
      ] : [
        { text: 'Yolcu bilgisi bulunmamaktadır.', fontSize: 9, color: GRAY, margin: [0, 4, 0, 0] },
      ]),

      // ── day-by-day itinerary ─────────────────────────────────────────────
      ...section('GÜNLÜK PROGRAM', itineraryContent),

      // ── included services ────────────────────────────────────────────────
      ...(quotation.includedServices
        ? section('DAHİL HİZMETLER', [
            { text: quotation.includedServices, fontSize: 9, color: BLACK, lineHeight: 1.5, margin: [0, 4, 0, 0] },
          ])
        : []),

      // ── excluded services ────────────────────────────────────────────────
      ...(quotation.excludedServices
        ? section('HARİÇ HİZMETLER', [
            { text: quotation.excludedServices, fontSize: 9, color: BLACK, lineHeight: 1.5, margin: [0, 4, 0, 0] },
          ])
        : []),

      // ── pricing ──────────────────────────────────────────────────────────
      ...section('FİYATLANDIRMA', [
        {
          table: {
            widths: ['*', 160],
            body: pricingRows,
          },
          layout: {
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 1 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => '#dddddd',
            fillColor: (i: number) => (i === 0 ? NAVY : i % 2 === 0 ? LIGHT : WHITE),
          },
          margin: [0, 4, 0, 0],
        },
      ]),

      // ── payment terms ────────────────────────────────────────────────────
      ...(quotation.paymentTerms
        ? section('ÖDEME KOŞULLARI', [
            { text: quotation.paymentTerms, fontSize: 9, color: BLACK, lineHeight: 1.5, margin: [0, 4, 0, 0] },
          ])
        : []),

      // ── cancellation policy ───────────────────────────────────────────────
      ...(quotation.cancellationPolicy
        ? section('İPTAL POLİTİKASI', [
            { text: quotation.cancellationPolicy, fontSize: 9, color: BLACK, lineHeight: 1.5, margin: [0, 4, 0, 0] },
          ])
        : []),

      // ── notes ─────────────────────────────────────────────────────────────
      ...(quotation.notes
        ? section('NOTLAR', [
            { text: quotation.notes, fontSize: 9, color: GRAY, lineHeight: 1.5, italics: true, margin: [0, 4, 0, 0] },
          ])
        : []),
    ],
  };

  pdfMake.createPdf(docDefinition).download(`teklif-${quotation.number}.pdf`);
}

// ─── label helpers ────────────────────────────────────────────────────────────

function statusLabel(status: string): string {
  const MAP: Record<string, string> = {
    draft: 'Taslak',
    sent: 'Gönderildi',
    viewed: 'Görüntülendi',
    accepted: 'Onaylandı',
    rejected: 'Reddedildi',
    expired: 'Süresi Doldu',
    revised: 'Revize Edildi',
  };
  return MAP[status] ?? status;
}

function tourTypeLabel(type: string): string {
  const MAP: Record<string, string> = {
    cultural: 'Kültürel',
    adventure: 'Macera',
    beach: 'Plaj & Deniz',
    historical: 'Tarihi',
    cruise: 'Kruvaziyer',
    religious: 'Dini',
    gastronomy: 'Gastronomi',
    nature: 'Doğa',
    custom: 'Özel',
  };
  return MAP[type] ?? type;
}

/**
 * Operation field document PDF — lazy-loaded (pdfmake only bundled on demand).
 * Generates a professional A4 Turkish operations file PDF with Roboto font.
 */
import type { Operation, Tour, TourDay, Customer, AgencySettings } from '@workspace/api-client-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trDate(d: string | null | undefined): string {
  if (!d) return 'Belirtilmemiş';
  return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function trToday(): string {
  return new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
}

// Turkish operation status labels
const OP_STATUS_TR: Record<string, string> = {
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

// ─── Brand constants ──────────────────────────────────────────────────────────

const NAVY   = '#1a3c5e';
const ORANGE = '#e8922a';
const GREEN  = '#2e7d32';
const GRAY   = '#666666';
const LIGHT  = '#f7f8fa';
const WHITE  = '#ffffff';
const BLACK  = '#1a1a1a';
const RED    = '#c62828';

// ─── Section helper ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function section(title: string, content: any[]): any[] {
  return [
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 22, r: 3, color: NAVY }] },
    { text: title, fontSize: 10, bold: true, color: WHITE, margin: [6, -18, 0, 6] },
    ...content,
    { text: '', margin: [0, 8, 0, 0] },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function infoRow(label: string, value: string | null | undefined, last = false): any {
  return {
    columns: [
      { text: label, width: 140, fontSize: 9, color: GRAY, bold: true },
      { text: value || 'Belirtilmemiş', fontSize: 9, color: BLACK },
    ],
    margin: [0, 3, 0, last ? 0 : 1],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emergencyRow(label: string, name: string | null | undefined, phone: string | null | undefined): any {
  if (!name && !phone) return { text: `${label}: Belirtilmemiş`, fontSize: 9, color: GRAY, margin: [0, 2, 0, 0] };
  return {
    columns: [
      { text: label, width: 140, fontSize: 9, color: RED, bold: true },
      { text: `${name || 'Belirtilmemiş'}  ${phone ? `· ${phone}` : ''}`, fontSize: 9, color: BLACK, bold: true },
    ],
    margin: [0, 3, 0, 1],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateOperationPdf(
  operation: Operation,
  agencySettings: AgencySettings | null,
  tour: Tour | null,
  tourDays: TourDay[],
  customer: Customer | null,
): Promise<void> {
  // Dynamic imports — pdfmake stays out of the initial bundle.
  // Import explicitly from pdfmake/build/pdfmake (the UMD browser bundle)
  // rather than the package root, which resolves to the Node/server entry
  // (js/index.js) and does not expose addFontContainer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMakeModule = await import('pdfmake/build/pdfmake') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const robotoModule  = await import('pdfmake/build/fonts/Roboto') as any;

  const pdfMake = pdfMakeModule.default ?? pdfMakeModule;
  const roboto  = robotoModule.default   ?? robotoModule;
  pdfMake.addFontContainer(roboto);

  const agencyName    = agencySettings?.name    ?? 'TourOps Acentesi';
  const agencyPhone   = agencySettings?.phone   ?? '';
  const agencyEmail   = agencySettings?.email   ?? '';
  const agencyAddress = agencySettings?.address ?? '';
  const agencyWebsite = agencySettings?.website ?? '';

  // Use tour dates as fallback when operation dates are not set
  const startDate = operation.startDate || tour?.startDate || null;
  const endDate   = operation.endDate   || tour?.endDate   || null;

  const statusTr = OP_STATUS_TR[operation.status ?? ''] ?? (operation.status ?? 'Belirtilmemiş');

  const sortedDays = [...tourDays].sort((a, b) => a.dayNumber - b.dayNumber);

  // ── Daily itinerary ───────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itineraryContent: any[] = [];
  if (sortedDays.length === 0) {
    itineraryContent.push({ text: 'Günlük program bilgisi eklenmemiştir.', fontSize: 9, color: GRAY, margin: [0, 4, 0, 0] });
  } else {
    for (const day of sortedDays) {
      itineraryContent.push({
        columns: [
          { canvas: [{ type: 'rect', x: 0, y: 0, w: 6, h: 14, r: 1, color: ORANGE }], width: 12 },
          { text: `Gün ${day.dayNumber}${day.title ? ` — ${day.title}` : ''}`, fontSize: 10, bold: true, color: NAVY, margin: [0, 1, 0, 0] },
        ],
        margin: [0, 8, 0, 3],
      });
      const rows: string[][] = [];
      if (day.locations)   rows.push(['📍 Lokasyon', day.locations]);
      if (day.activities)  rows.push(['🎯 Aktiviteler', day.activities]);
      if (day.mealPlan)    rows.push(['🍽️ Yemek', day.mealPlan]);
      if (day.transportPlan) rows.push(['🚌 Ulaşım', day.transportPlan]);
      if (day.operationalNotes) rows.push(['📝 Op. Notlar', day.operationalNotes]);

      if (rows.length > 0) {
        itineraryContent.push({
          table: {
            widths: [90, '*'],
            body: rows.map(([k, v]) => [
              { text: k, fontSize: 8, color: GRAY, bold: true, border: [false, false, false, false] },
              { text: v, fontSize: 8, color: BLACK, border: [false, false, false, false] },
            ]),
          },
          layout: 'noBorders',
          margin: [12, 0, 0, 0],
        });
      }
    }
  }

  // ── Footer text ───────────────────────────────────────────────────────────
  const footerParts = [agencyName];
  if (agencyPhone)   footerParts.push(agencyPhone);
  if (agencyEmail)   footerParts.push(agencyEmail);
  if (agencyWebsite) footerParts.push(agencyWebsite);
  if (agencyAddress) footerParts.push(agencyAddress);
  const footerText = footerParts.join('  ·  ');

  // ── Document definition ───────────────────────────────────────────────────
  const docDefinition = {
    pageSize: 'A4' as const,
    pageMargins: [40, 55, 40, 55] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    header: () => ({
      columns: [
        { text: agencyName, fontSize: 11, bold: true, color: NAVY, margin: [40, 14, 0, 0] },
        {
          text: '◼ GİZLİ — SAHA DOSYASI',
          fontSize: 8,
          color: ORANGE,
          bold: true,
          alignment: 'right',
          margin: [0, 16, 40, 0],
        },
      ],
    }),
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: footerText,
          fontSize: 7,
          color: GRAY,
          margin: [40, 0, 0, 0],
        },
        {
          text: `Sayfa ${currentPage} / ${pageCount}`,
          alignment: 'right',
          fontSize: 7,
          color: GRAY,
          margin: [0, 0, 40, 0],
        },
      ],
      margin: [0, 8, 0, 0],
    }),
    content: [
      // ── Cover heading ────────────────────────────────────────────────────
      {
        canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 56, r: 6, color: NAVY }],
      },
      {
        columns: [
          {
            stack: [
              { text: 'OPERASYON DOSYASI', fontSize: 18, bold: true, color: WHITE },
              { text: `OP-${operation.id}  —  ${trDate(startDate)}${endDate ? ` → ${trDate(endDate)}` : ''}`, fontSize: 10, color: ORANGE, margin: [0, 4, 0, 0] },
            ],
          },
          {
            text: `Oluşturma: ${trToday()}`,
            alignment: 'right',
            fontSize: 8,
            color: LIGHT,
            margin: [0, 6, 0, 0],
          },
        ],
        margin: [8, -46, 8, 20],
      },

      // ── Operation info ────────────────────────────────────────────────────
      ...section('OPERASYON BİLGİLERİ', [
        {
          columns: [
            {
              stack: [
                infoRow('Tur Adı', tour?.name ?? null),
                infoRow('Başlangıç', trDate(startDate)),
                infoRow('Bitiş', trDate(endDate)),
              ],
              width: '50%',
            },
            {
              stack: [
                infoRow('Müşteri', customer?.name ?? null),
                infoRow('Müşteri Tel.', customer?.phone ?? null),
                infoRow('Durum', statusTr),
              ],
              width: '50%',
            },
          ],
          margin: [0, 6, 0, 0],
          columnGap: 16,
        },
      ]),

      // ── Guide & driver ────────────────────────────────────────────────────
      ...section('REHBER VE ŞOFÖR', [
        {
          columns: [
            {
              stack: [
                {
                  fillColor: LIGHT,
                  table: {
                    widths: ['*'],
                    body: [[
                      {
                        stack: [
                          { text: 'REHBER', fontSize: 8, bold: true, color: GRAY },
                          { text: operation.guideName || 'Belirtilmemiş', fontSize: 10, color: operation.guideName ? BLACK : GRAY, bold: !!operation.guideName, margin: [0, 2, 0, 0] },
                          { text: operation.guidePhone || '', fontSize: 9, color: GREEN },
                        ],
                        border: [false, false, false, false],
                        margin: [8, 6, 8, 6],
                      },
                    ]],
                  },
                  margin: [0, 6, 4, 0],
                },
              ],
              width: '50%',
            },
            {
              stack: [
                {
                  fillColor: LIGHT,
                  table: {
                    widths: ['*'],
                    body: [[
                      {
                        stack: [
                          { text: 'ŞOFÖR', fontSize: 8, bold: true, color: GRAY },
                          { text: operation.driverName || 'Belirtilmemiş', fontSize: 10, color: operation.driverName ? BLACK : GRAY, bold: !!operation.driverName, margin: [0, 2, 0, 0] },
                          { text: operation.driverPhone || '', fontSize: 9, color: GREEN },
                          ...(operation.vehiclePlate ? [{ text: `Plaka: ${operation.vehiclePlate}`, fontSize: 9, color: NAVY, bold: true }] : []),
                        ],
                        border: [false, false, false, false],
                        margin: [8, 6, 8, 6],
                      },
                    ]],
                  },
                  margin: [4, 6, 0, 0],
                },
              ],
              width: '50%',
            },
          ],
          columnGap: 8,
        },
      ]),

      // ── Emergency contacts ────────────────────────────────────────────────
      ...section('ACİL İRTİBAT', [
        {
          margin: [0, 6, 0, 0],
          stack: [
            emergencyRow('Acil 1', operation.emergencyContact1Name, operation.emergencyContact1Phone),
            emergencyRow('Acil 2', operation.emergencyContact2Name, operation.emergencyContact2Phone),
            ...(agencyPhone ? [{
              columns: [
                { text: 'Acente Merkezi', width: 140, fontSize: 9, color: RED, bold: true },
                { text: `${agencyName}  · ${agencyPhone}`, fontSize: 9, color: BLACK, bold: true },
              ],
              margin: [0, 3, 0, 0],
            }] : []),
          ],
        },
      ]),

      // ── Daily itinerary ───────────────────────────────────────────────────
      ...(sortedDays.length > 0
        ? section('GÜNLÜK GÜZERGAH', itineraryContent)
        : []),

      // ── Notes ─────────────────────────────────────────────────────────────
      ...(operation.notes
        ? section('OPERASYON NOTLARI', [
            { text: operation.notes, fontSize: 9, color: BLACK, lineHeight: 1.5, margin: [0, 4, 0, 0] },
          ])
        : []),
    ],
  };

  pdfMake.createPdf(docDefinition).download(`operasyon-${operation.id}.pdf`);
}

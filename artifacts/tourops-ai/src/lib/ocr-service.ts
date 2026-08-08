/**
 * OCR Service — sends a receipt image to the backend for AI-powered extraction.
 *
 * The image is converted to base64 on the client and sent to
 * POST /api/ai/ocr-receipt. All AI processing happens on the backend;
 * the API key is never exposed to the browser.
 *
 * The server returns a structured JSON payload with per-field confidence scores.
 * Fields with confidence < OCR_LOW_CONFIDENCE_THRESHOLD are considered uncertain
 * and should be flagged for human review.
 */

import { API_BASE } from '@/lib/api-base';

/** Confidence below this value should be flagged as "Kontrol Edilmeli". */
export const OCR_LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface OcrReceiptResult {
  amount: number | null;
  currency: 'TRY' | 'USD' | 'EUR' | 'GBP' | null;
  supplierName: string | null;
  receiptDate: string | null;   // YYYY-MM-DD
  receiptTime: string | null;   // HH:MM (24h)
  taxAmount: number | null;
  invoiceNumber: string | null;
  paymentMethod: string | null;
  expenseCategory: string | null;
  confidence: {
    amount: number;       // 0.0 – 1.0
    currency: number;
    supplierName: number;
    receiptDate: number;
    receiptTime: number;
    taxAmount: number;
    invoiceNumber: number;
    paymentMethod: number;
    expenseCategory: number;
  };
}

/**
 * Read a File object and return the raw base64 payload (no data URL prefix).
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip "data:<mime>;base64," prefix — keep only the base64 payload.
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = () => reject(new Error('Dosya okunamadı'));
    reader.readAsDataURL(file);
  });
}

/**
 * Send a receipt image to the backend OCR endpoint and return extracted fields.
 *
 * @param file      The receipt image File object selected by the user.
 * @param authToken Clerk session token (from `useAuth().getToken()`).
 * @throws {Error}  Human-readable Turkish error message on failure.
 */
export async function ocrReceiptImage(
  file: File,
  authToken: string | null,
): Promise<OcrReceiptResult> {
  const imageBase64 = await fileToBase64(file);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}/ai/ocr-receipt`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ imageBase64, mimeType: file.type }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Sunucu hatası (${res.status})`);
  }

  return res.json() as Promise<OcrReceiptResult>;
}

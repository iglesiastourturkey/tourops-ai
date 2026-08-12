import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireActive, requirePermission, getUserId } from "../lib/auth";
import {
  aiSchemaError, logAiFailure, parseAiJson, requestOpenRouterContent,
} from "../lib/ai-extraction";

const router = Router();
router.use(requireAuth);
router.use(requireActive());

/**
 * Thin wrapper over the shared helper. Previously this threw away the provider's
 * response body on a non-2xx, so every OpenRouter problem reached the caller as
 * a bare "OpenRouter error: <status>"; the shared helper reports the stage and
 * the provider's own message instead.
 */
async function callOpenRouter(
  systemPrompt: string,
  userPrompt: string,
  jsonMode = false,
): Promise<{ content: string; finishReason?: string }> {
  return requestOpenRouterContent({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    maxTokens: 2000,
    jsonMode,
  });
}

// POST /api/ai/analyze-request
router.post("/analyze-request", requirePermission("ai", "view"), async (req, res) => {
  try {
    const { message } = req.body as { message: string };
    if (!message) { res.status(400).json({ error: "message required" }); return; }

    if (!process.env.OPENROUTER_API_KEY) {
      // Mock response
      res.json({
        customerName: null, startDate: null, endDate: null,
        adultCount: null, childCount: null, destination: "Kuşadası",
        duration: null, budget: null, hotelCategory: null,
        transferRequired: false, guideLanguage: "Türkçe",
        activities: null, mealPreferences: null, specialRequests: null,
        customerType: null,
        missingFields: ["customerName", "startDate", "endDate", "adultCount", "budget"],
      });
      return;
    }

    const systemPrompt = `Seyahat acentesi için gelen müşteri taleplerini analiz eden bir asistansın. 
Kullanıcının mesajından tur bilgilerini çıkar ve JSON formatında döndür.
Sadece JSON döndür, başka açıklama yapma.
Şema: { customerName, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), adultCount, childCount, destination, duration (gün), budget, hotelCategory, transferRequired, guideLanguage, activities, mealPreferences, specialRequests, customerType, missingFields: string[] }
Bulamadığın alanları null olarak bırak ve missingFields listesine ekle.`;

    const { content, finishReason } = await callOpenRouter(systemPrompt, message, true);
    res.json(parseAiJson(content, finishReason));
  } catch (err) {
    logAiFailure(req.log, err, { eventType: "ai_analyze_request_failed" });
    res.status(500).json({ error: "AI analysis failed", details: String(err) });
  }
});

// POST /api/ai/generate-itinerary
router.post("/generate-itinerary", requirePermission("ai", "view"), async (req, res) => {
  try {
    const body = req.body;

    if (!process.env.OPENROUTER_API_KEY) {
      const nights = body.nights ?? 3;
      const days = Array.from({ length: nights }, (_, i) => ({
        dayNumber: i + 1,
        title: `${i + 1}. Gün - ${body.destination ?? "Tur"}`,
        summary: `${body.destination ?? "Destinasyon"} gezisi ${i + 1}. günü`,
        startTime: "09:00",
        endTime: "18:00",
        locations: body.destination ?? "Kuşadası",
        activities: "Tarihi yerler, yerel lezzetler",
        mealPlan: "Kahvaltı dahil",
        transportPlan: "Özel araç ile transfer",
        estimatedDrivingMinutes: 60,
        estimatedActivityMinutes: 300,
        accessibilityNotes: null,
        operationalNotes: null,
      }));
      res.json({ days, cruiseWarning: null });
      return;
    }

    const systemPrompt = `Sen bir profesyonel tur planlama asistanısın. Türkiye'de (özellikle Kuşadası, İzmir, Efes, Pamukkale bölgesi) turlar düzenliyorsun.
Verilen bilgilere göre gün gün tur programı oluştur. JSON formatında döndür.
Şema: { days: [{ dayNumber, title, summary, startTime, endTime, locations, activities, mealPlan, transportPlan, estimatedDrivingMinutes, estimatedActivityMinutes, accessibilityNotes, operationalNotes }], cruiseWarning: string | null }
Sadece JSON döndür.`;

    const { content, finishReason } = await callOpenRouter(systemPrompt, JSON.stringify(body), true);
    res.json(parseAiJson(content, finishReason));
  } catch (err) {
    logAiFailure(req.log, err, { eventType: "ai_generate_itinerary_failed" });
    res.status(500).json({ error: "Itinerary generation failed", details: String(err) });
  }
});

// POST /api/ai/generate-email
router.post("/generate-email", requirePermission("ai", "view"), async (req, res) => {
  try {
    const { templateType, context, language = "tr" } = req.body as { templateType: string; context: string; language?: string };

    if (!process.env.OPENROUTER_API_KEY) {
      res.json({
        subject: "TourPilot - Tur Teklifiniz Hazır",
        body: `Sayın Müşterimiz,\n\nTur teklifiniz hazırlanmıştır. Detaylar için lütfen bizimle iletişime geçiniz.\n\nSaygılarımızla,\nTourPilot Acentesi`,
      });
      return;
    }

    const langLabel = language === "tr" ? "Türkçe" : language === "en" ? "İngilizce" : language;
    const systemPrompt = `Sen bir seyahat acentesi için profesyonel e-posta yazan asistansın.
Tür: ${templateType}, Dil: ${langLabel}
Profesyonel, sıcak ve ikna edici bir e-posta yaz.
JSON döndür: { subject: string, body: string }
Sadece JSON döndür.`;

    const { content, finishReason } = await callOpenRouter(systemPrompt, context, true);
    res.json(parseAiJson(content, finishReason));
  } catch (err) {
    logAiFailure(req.log, err, { eventType: "ai_generate_email_failed" });
    res.status(500).json({ error: "Email generation failed", details: String(err) });
  }
});

// POST /api/ai/assist
router.post("/assist", requirePermission("ai", "view"), async (req, res) => {
  try {
    const { prompt, context } = req.body as { prompt: string; context?: string };

    if (!process.env.OPENROUTER_API_KEY) {
      res.json({ result: "AI asistanı şu an mevcut değil. OPENROUTER_API_KEY ayarlandığında kullanılabilir.", type: "text" });
      return;
    }

    const systemPrompt = `Sen TourPilot seyahat acentesi yönetim sisteminin yapay zeka asistanısın. 
Türkçe cevap ver. Kısa ve öz ol. Seyahat, tur operasyonu ve acente yönetimi konularında uzmansın.${context ? `\n\nBağlam: ${context}` : ""}`;

    // Free-text answer, so no JSON mode and no JSON parsing.
    const { content } = await callOpenRouter(systemPrompt, prompt);
    res.json({ result: content, type: "text" });
  } catch (err) {
    logAiFailure(req.log, err, { eventType: "ai_assist_failed" });
    res.status(500).json({ error: "AI assist failed", details: String(err) });
  }
});

// ─── Receipt OCR ─────────────────────────────────────────────────────────────

// In-memory rate limiter: max 10 OCR calls per user per 60 s
const ocrRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const OCR_RATE_LIMIT = 10;
const OCR_WINDOW_MS = 60_000;
const OCR_MAX_RAW_BYTES = 5 * 1024 * 1024; // 5 MB raw image
const ALLOWED_OCR_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);

// Zod schema for the AI response
const ocrConfidenceSchema = z.object({
  amount: z.number().min(0).max(1).default(0),
  currency: z.number().min(0).max(1).default(0),
  supplierName: z.number().min(0).max(1).default(0),
  receiptDate: z.number().min(0).max(1).default(0),
  receiptTime: z.number().min(0).max(1).default(0),
  taxAmount: z.number().min(0).max(1).default(0),
  invoiceNumber: z.number().min(0).max(1).default(0),
  paymentMethod: z.number().min(0).max(1).default(0),
  expenseCategory: z.number().min(0).max(1).default(0),
});

const ocrResultSchema = z.object({
  amount: z.number().nullable().default(null),
  currency: z.enum(["TRY", "USD", "EUR", "GBP"]).nullable().default(null),
  supplierName: z.string().nullable().default(null),
  receiptDate: z.string().nullable().default(null),   // YYYY-MM-DD
  receiptTime: z.string().nullable().default(null),   // HH:MM
  taxAmount: z.number().nullable().default(null),
  invoiceNumber: z.string().nullable().default(null),
  paymentMethod: z.string().nullable().default(null),
  expenseCategory: z.string().nullable().default(null),
  confidence: ocrConfidenceSchema.default({}),
});

type OcrResult = z.infer<typeof ocrResultSchema>;

const OCR_SYSTEM_PROMPT = `You are a receipt/invoice OCR assistant for a Turkish travel agency.
Analyze the receipt image and extract data into EXACTLY the following JSON object.
Return ONLY valid JSON — no markdown fences, no explanations.

{
  "amount": <number|null>,         // Total amount (including tax). Numeric only.
  "currency": <"TRY"|"USD"|"EUR"|"GBP"|null>,  // Default TRY for Turkish receipts.
  "supplierName": <string|null>,   // Business or shop name.
  "receiptDate": <"YYYY-MM-DD"|null>,  // Convert any date format.
  "receiptTime": <"HH:MM"|null>,   // 24-hour format.
  "taxAmount": <number|null>,      // KDV / VAT amount.
  "invoiceNumber": <string|null>,  // Fiş no, fatura no, receipt number.
  "paymentMethod": <string|null>,  // e.g. "Nakit", "Kredi Kartı", "Banka Kartı".
  "expenseCategory": <string|null>,// e.g. "Yemek", "Ulaşım", "Konaklama", "Eğlence", "Diğer".
  "confidence": {
    "amount": <0.0-1.0>,
    "currency": <0.0-1.0>,
    "supplierName": <0.0-1.0>,
    "receiptDate": <0.0-1.0>,
    "receiptTime": <0.0-1.0>,
    "taxAmount": <0.0-1.0>,
    "invoiceNumber": <0.0-1.0>,
    "paymentMethod": <0.0-1.0>,
    "expenseCategory": <0.0-1.0>
  }
}

Confidence rules:
- 1.0 = clearly, unambiguously visible
- 0.7 = likely correct but partially obscured or inferred
- 0.4 = uncertain/guessed
- 0.0 = field not present or completely unreadable

Do not store or reference the image content beyond what is needed for extraction.`;

// POST /api/ai/ocr-receipt
router.post("/ocr-receipt", requirePermission("ai", "view"), async (req, res) => {
  try {
    const userId = getUserId(req);

    // Rate limit
    const now = Date.now();
    const entry = ocrRateLimitMap.get(userId) ?? { count: 0, resetAt: now + OCR_WINDOW_MS };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + OCR_WINDOW_MS; }
    if (entry.count >= OCR_RATE_LIMIT) {
      res.status(429).json({ error: "Çok fazla istek. Lütfen 1 dakika bekleyin." });
      return;
    }
    entry.count++;
    ocrRateLimitMap.set(userId, entry);

    // Validate inputs
    const { imageBase64, mimeType } = req.body as { imageBase64?: string; mimeType?: string };
    if (!imageBase64 || typeof imageBase64 !== "string") {
      res.status(400).json({ error: "imageBase64 required" }); return;
    }
    const cleanMime = (mimeType ?? "").split(";")[0].trim();
    if (!ALLOWED_OCR_MIME.has(cleanMime)) {
      res.status(400).json({ error: "Geçersiz dosya türü. Yalnızca görüntü dosyaları desteklenir." }); return;
    }
    // Approximate raw size from base64 length (base64 overhead ≈ 4/3)
    const approxRawBytes = Math.floor(imageBase64.length * 0.75);
    if (approxRawBytes > OCR_MAX_RAW_BYTES) {
      res.status(400).json({ error: "Görüntü çok büyük. OCR için maksimum 5 MB." }); return;
    }

    // No API key → return safe mock
    if (!process.env.OPENROUTER_API_KEY) {
      const mock: OcrResult = {
        amount: null, currency: null, supplierName: null, receiptDate: null,
        receiptTime: null, taxAmount: null, invoiceNumber: null,
        paymentMethod: null, expenseCategory: null,
        confidence: {
          amount: 0, currency: 0, supplierName: 0, receiptDate: 0,
          receiptTime: 0, taxAmount: 0, invoiceNumber: 0,
          paymentMethod: 0, expenseCategory: 0,
        },
      };
      res.json(mock);
      return;
    }

    // Vision call — the image goes out as a data URL and is never logged here.
    const dataUrl = `data:${cleanMime};base64,${imageBase64}`;
    const { content, finishReason } = await requestOpenRouterContent({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: OCR_SYSTEM_PROMPT },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
      maxTokens: 800,
      temperature: 0,
      jsonMode: true,
    });

    const validated = ocrResultSchema.safeParse(parseAiJson(content, finishReason));
    if (!validated.success) throw aiSchemaError(validated.error.issues, finishReason);

    res.json(validated.data);
  } catch (err) {
    // Replaces the previous console.error calls, one of which logged 300
    // characters of model output — that output is extracted receipt data
    // (supplier, amount, invoice number) and must not reach the logs.
    logAiFailure(req.log, err, { eventType: "ai_ocr_receipt_failed" });
    // The failure stages that used to answer 502 still do; only an unexpected
    // error (rate-limit bookkeeping, JSON body handling) falls through to 500.
    const isAiFailure = err instanceof Error && err.name === "AiExtractionError";
    if (isAiFailure || (typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError")) {
      res.status(502).json({ error: "OCR servisi şu an kullanılamıyor. Lütfen tekrar deneyin." });
      return;
    }
    res.status(500).json({ error: "OCR başarısız. Lütfen tekrar deneyin." });
  }
});

export default router;

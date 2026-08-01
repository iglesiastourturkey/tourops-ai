import { Router } from "express";
import { requireAuth } from "../lib/auth";

const router = Router();
router.use(requireAuth);

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  // Dynamic import so the server starts fine without the package
  return key;
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No API key");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

// POST /api/ai/analyze-request
router.post("/analyze-request", async (req, res) => {
  try {
    const { message } = req.body as { message: string };
    if (!message) { res.status(400).json({ error: "message required" }); return; }

    if (!process.env.OPENAI_API_KEY) {
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

    const raw = await callOpenAI(systemPrompt, message);
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    res.json(JSON.parse(cleaned));
  } catch (err) {
    res.status(500).json({ error: "AI analysis failed", details: String(err) });
  }
});

// POST /api/ai/generate-itinerary
router.post("/generate-itinerary", async (req, res) => {
  try {
    const body = req.body;

    if (!process.env.OPENAI_API_KEY) {
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

    const raw = await callOpenAI(systemPrompt, JSON.stringify(body));
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    res.json(JSON.parse(cleaned));
  } catch (err) {
    res.status(500).json({ error: "Itinerary generation failed", details: String(err) });
  }
});

// POST /api/ai/generate-email
router.post("/generate-email", async (req, res) => {
  try {
    const { templateType, context, language = "tr" } = req.body as { templateType: string; context: string; language?: string };

    if (!process.env.OPENAI_API_KEY) {
      res.json({
        subject: "TourOps - Tur Teklifiniz Hazır",
        body: `Sayın Müşterimiz,\n\nTur teklifiniz hazırlanmıştır. Detaylar için lütfen bizimle iletişime geçiniz.\n\nSaygılarımızla,\nTourOps Acentesi`,
      });
      return;
    }

    const langLabel = language === "tr" ? "Türkçe" : language === "en" ? "İngilizce" : language;
    const systemPrompt = `Sen bir seyahat acentesi için profesyonel e-posta yazan asistansın.
Tür: ${templateType}, Dil: ${langLabel}
Profesyonel, sıcak ve ikna edici bir e-posta yaz.
JSON döndür: { subject: string, body: string }
Sadece JSON döndür.`;

    const raw = await callOpenAI(systemPrompt, context);
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    res.json(JSON.parse(cleaned));
  } catch (err) {
    res.status(500).json({ error: "Email generation failed", details: String(err) });
  }
});

// POST /api/ai/assist
router.post("/assist", async (req, res) => {
  try {
    const { prompt, context } = req.body as { prompt: string; context?: string };

    if (!process.env.OPENAI_API_KEY) {
      res.json({ result: "AI asistanı şu an mevcut değil. OPENAI_API_KEY ayarlandığında kullanılabilir.", type: "text" });
      return;
    }

    const systemPrompt = `Sen TourOps seyahat acentesi yönetim sisteminin yapay zeka asistanısın. 
Türkçe cevap ver. Kısa ve öz ol. Seyahat, tur operasyonu ve acente yönetimi konularında uzmansın.${context ? `\n\nBağlam: ${context}` : ""}`;

    const result = await callOpenAI(systemPrompt, prompt);
    res.json({ result, type: "text" });
  } catch (err) {
    res.status(500).json({ error: "AI assist failed", details: String(err) });
  }
});

export default router;

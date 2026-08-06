import { Router } from "express";
import { z } from "zod";
import { createAuditLog } from "../lib/audit";
import { sendContactMessage } from "../lib/contact-mail";

const router = Router();

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

const contactSchema = z.object({
  fullName: z.string().trim().min(1, "Ad Soyad zorunludur").max(120),
  companyName: z.string().trim().max(200).optional().default(""),
  email: z.string().trim().email("Geçerli bir e-posta adresi girin").max(254),
  phone: z.string().trim().max(50).optional().default(""),
  subject: z.string().trim().max(200).optional().default(""),
  message: z.string().trim().min(1, "Mesaj zorunludur").max(5000),
  website: z.string().max(200).optional().default(""),
});

function getClientKey(req: { ip?: string; headers: Record<string, string | string[] | undefined> }) {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
  return forwardedIp || req.ip || "unknown";
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const current = rateLimit.get(key);
  if (!current || current.resetAt <= now) {
    const next = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimit.set(key, next);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimit) {
    if (entry.resetAt <= now) rateLimit.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

router.post("/contact", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Form alanlarını kontrol edin.",
      fields: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  // Honeypot submissions receive the same success response as real submissions,
  // but no message is delivered and no personal data is logged.
  if (parsed.data.website) {
    res.status(204).send();
    return;
  }

  const limit = checkRateLimit(getClientKey(req));
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json({ error: "Çok fazla deneme yapıldı. Lütfen daha sonra tekrar deneyin." });
    return;
  }

  try {
    await sendContactMessage(parsed.data);
    await createAuditLog({
      eventType: "contact_form_submitted",
      module: "public_contact",
      result: "success",
      metadata: {
        hasCompanyName: Boolean(parsed.data.companyName),
        hasPhone: Boolean(parsed.data.phone),
        hasSubject: Boolean(parsed.data.subject),
        messageLength: parsed.data.message.length,
      },
      description: "Landing page iletişim formu başarıyla gönderildi",
    });
    res.status(200).json({ success: true });
  } catch (error) {
    req.log?.error?.({ err: error }, "Contact form email delivery failed");
    res.status(503).json({
      error: "Mesajınız şu anda gönderilemedi. Lütfen daha sonra tekrar deneyin.",
    });
  }
});

export default router;
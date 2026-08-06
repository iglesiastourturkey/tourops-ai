import nodemailer from "nodemailer";

export const CONTACT_RECIPIENT = "info@iglesiastourturkey.com";

type ContactMessage = {
  fullName: string;
  companyName?: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
};

function getRequiredConfig() {
  const keys = [
    "CONTACT_SMTP_HOST",
    "CONTACT_SMTP_PORT",
    "CONTACT_SMTP_USER",
    "CONTACT_SMTP_PASSWORD",
    "CONTACT_SMTP_FROM_EMAIL",
  ] as const;

  const missing = keys.filter(key => !process.env[key]?.trim());
  return { missing };
}

export function getContactMailConfiguration() {
  return getRequiredConfig();
}

export async function sendContactMessage(message: ContactMessage) {
  const { missing } = getRequiredConfig();
  if (missing.length > 0) {
    throw new Error(`Contact email is not configured. Missing: ${missing.join(", ")}`);
  }

  const port = Number(process.env.CONTACT_SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CONTACT_SMTP_PORT must be a valid port number");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.CONTACT_SMTP_HOST,
    port,
    secure: process.env.CONTACT_SMTP_SECURE?.trim().toLowerCase() === "true",
    auth: {
      user: process.env.CONTACT_SMTP_USER,
      pass: process.env.CONTACT_SMTP_PASSWORD,
    },
  });

  const subject = message.subject?.trim()
    ? `TourPilot iletişim formu: ${message.subject.trim()}`
    : "TourPilot iletişim formu";

  await transporter.sendMail({
    from: process.env.CONTACT_SMTP_FROM_EMAIL,
    to: CONTACT_RECIPIENT,
    replyTo: message.email,
    subject,
    text: [
      `Ad Soyad: ${message.fullName}`,
      `Firma Adı: ${message.companyName || "Belirtilmedi"}`,
      `E-posta: ${message.email}`,
      `Telefon: ${message.phone || "Belirtilmedi"}`,
      `Konu: ${message.subject || "Belirtilmedi"}`,
      "",
      "Mesaj:",
      message.message,
    ].join("\n"),
  });
}
import {
  buildCustomerIdentityKey,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
} from "./customer-identity";

export interface HistoricalContact {
  sourceKey: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
}

// Phase 3H.4B: canonical implementations live in ./customer-identity.
// These wrappers preserve the exact historical semantics and export names.
export function normalizeHistoricalEmail(value: string | null): string | null {
  return normalizeCustomerEmail(value);
}

export function normalizeHistoricalPhone(value: string | null): string | null {
  return normalizeCustomerPhone(value);
}

export type CustomerProjectionOutcome =
  | "CREATED" | "EXISTING" | "LINKED" | "CONFLICT" | "SKIPPED_NO_IDENTITY" | "FAILED";

export function identityKey(contact: HistoricalContact): string | null {
  return buildCustomerIdentityKey({ email: contact.email, phone: contact.phone });
}

export function resolveCustomerIdentity(params: {
  contact: HistoricalContact;
  customerByEmail: Map<string, number>;
  customerByPhone: Map<string, number>;
}): { outcome: "EXISTING" | "CREATED" | "CONFLICT" | "SKIPPED_NO_IDENTITY"; customerId: number | null } {
  const email = normalizeHistoricalEmail(params.contact.email);
  const phone = normalizeHistoricalPhone(params.contact.phone);
  if (!email && !phone) return { outcome: "SKIPPED_NO_IDENTITY", customerId: null };
  const emailId = email ? params.customerByEmail.get(email) ?? null : null;
  const phoneId = phone ? params.customerByPhone.get(phone) ?? null : null;
  if (emailId !== null && phoneId !== null && emailId !== phoneId) {
    return { outcome: "CONFLICT", customerId: null };
  }
  const existing = emailId ?? phoneId;
  return existing === null
    ? { outcome: "CREATED", customerId: null }
    : { outcome: "EXISTING", customerId: existing };
}

export function summarizeHistoricalContacts(rows: HistoricalContact[]) {
  const counts = { rows: rows.length, fullName: 0, email: 0, phone: 0, both: 0, emailOnly: 0, phoneOnly: 0, nameOnly: 0, neither: 0 };
  const emails = new Map<string, number>();
  const phones = new Map<string, number>();
  for (const row of rows) {
    const name = Boolean(row.fullName?.trim());
    const email = normalizeHistoricalEmail(row.email);
    const phone = normalizeHistoricalPhone(row.phone);
    if (name) counts.fullName += 1;
    if (email) { counts.email += 1; emails.set(email, (emails.get(email) ?? 0) + 1); }
    if (phone) { counts.phone += 1; phones.set(phone, (phones.get(phone) ?? 0) + 1); }
    if (email && phone) counts.both += 1;
    else if (email) counts.emailOnly += 1;
    else if (phone) counts.phoneOnly += 1;
    else if (name) counts.nameOnly += 1;
    else counts.neither += 1;
  }
  return {
    ...counts,
    uniqueNormalizedEmails: emails.size,
    uniqueNormalizedPhones: phones.size,
    repeatedEmails: [...emails.values()].filter(count => count > 1).length,
    repeatedPhones: [...phones.values()].filter(count => count > 1).length,
    reservationsRepresentedByRepeatIdentities: rows.filter(row => {
      const email = normalizeHistoricalEmail(row.email); const phone = normalizeHistoricalPhone(row.phone);
      return (email ? (emails.get(email) ?? 0) > 1 : false) || (phone ? (phones.get(phone) ?? 0) > 1 : false);
    }).length,
  };
}

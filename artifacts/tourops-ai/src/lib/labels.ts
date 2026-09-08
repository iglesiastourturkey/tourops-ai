export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  individual: 'Bireysel',
  family: 'Aile',
  group: 'Grup',
  corporate: 'Kurumsal',
  cruise_passenger: 'Kruvaziyer',
  agency_partner: 'Acente Partneri',
};

export const PASSPORT_STATUS_LABELS: Record<string, string> = {
  not_requested: 'Talep Edilmedi',
  requested: 'Talep Edildi',
  received: 'Alındı',
  verified: 'Doğrulandı',
};

export const PASSPORT_STATUS_COLORS: Record<string, string> = {
  not_requested: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  received: 'bg-orange-100 text-orange-700',
  verified: 'bg-green-100 text-green-700',
};

export const SUPPLIER_CATEGORY_LABELS: Record<string, string> = {
  hotel: 'Otel',
  transfer: 'Transfer',
  guide: 'Rehber',
  restaurant: 'Restoran',
  activity: 'Aktivite',
  airline: 'Havayolu',
  car_rental: 'Araç Kiralama',
  insurance: 'Sigorta',
  driver: 'Şoför',
  other: 'Diğer',
};

export const TOUR_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  approved: 'Onaylı',
  cancelled: 'İptal',
  completed: 'Tamamlandı',
  archived: 'Arşivlendi',
};

export const TOUR_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  approved: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  completed: 'bg-blue-100 text-blue-700',
  archived: 'bg-orange-100 text-orange-700',
};

export const TOUR_TYPE_LABELS: Record<string, string> = {
  cultural: 'Kültürel',
  private: 'Özel',
  group: 'Grup',
  cruise: 'Kruvaziyer',
  family: 'Aile',
  luxury: 'Lüks',
  religious: 'Dini',
  nature: 'Doğa',
  gastronomy: 'Gastronomi',
  special: 'Özel Düzenleme',
};

export const QUOTATION_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  sent: 'Gönderildi',
  viewed: 'Görüntülendi',
  accepted: 'Kabul Edildi',
  rejected: 'Reddedildi',
  expired: 'Süresi Doldu',
  revised: 'Revize',
  converted: 'Operasyona Dönüştürüldü',
  archived: 'Arşivlendi',
};

export const QUOTATION_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-orange-100 text-orange-700',
  revised: 'bg-yellow-100 text-yellow-700',
  converted: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-orange-100 text-orange-700',
};

export const OPERATION_STATUS_LABELS: Record<string, string> = {
  active: 'Aktif',
  planned: 'Planlandı',
  ready: 'Hazır',
  started: 'Başladı',
  in_progress: 'Devam Ediyor',
  delayed: 'Gecikti',
  completed: 'Tamamlandı',
  cancelled: 'İptal Edildi',
  archived: 'Arşivlendi',
};

// Reservation-domain labels (Phase 1C/1D). Shared by OperationDomainWorkspace
// (Operation Detail) and the Daily Operations Center so both screens render
// the exact same Turkish text for the exact same underlying value - never
// two independently-maintained copies that can drift apart.
export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  new: 'Yeni',
  confirmed: 'Onaylı',
  completed: 'Tamamlandı',
  canceled: 'İptal',
  rebooked: 'Yeniden rezervasyon',
  no_show: 'Katılmadı',
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  manual: 'Manual',
  gmail: 'Gmail',
  outlook: 'Outlook',
  sheet_import: 'Sheet Import',
  historical_migration: 'Historical Migration',
};

export const OPERATION_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  planned: 'bg-gray-100 text-gray-600',
  ready: 'bg-blue-100 text-blue-700',
  started: 'bg-teal-100 text-teal-700',
  in_progress: 'bg-emerald-100 text-emerald-700',
  delayed: 'bg-orange-100 text-orange-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  archived: 'bg-orange-100 text-orange-700',
};

export const INCIDENT_TYPE_LABELS: Record<string, string> = {
  medical: 'Tıbbi',
  vehicle: 'Araç',
  delay: 'Gecikme',
  missing_person: 'Kayıp Kişi',
  customer_complaint: 'Müşteri Şikayeti',
  supplier: 'Tedarikçi',
  document: 'Belge',
  other: 'Diğer',
};

export const INCIDENT_SEVERITY_LABELS: Record<string, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

export const INCIDENT_SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export const INCIDENT_STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  investigating: 'İnceleniyor',
  resolved: 'Çözüldü',
  closed: 'Kapatıldı',
};

export const INCIDENT_STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  investigating: 'bg-orange-100 text-orange-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-100 text-gray-500',
};

export const FIELD_NOTE_CATEGORY_LABELS: Record<string, string> = {
  general: 'Genel',
  customer: 'Müşteri',
  guide: 'Rehber',
  driver: 'Şoför',
  supplier: 'Tedarikçi',
  delay: 'Gecikme',
  incident: 'Olay',
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Düşük',
  medium: 'Orta',
  high: 'Yüksek',
  critical: 'Kritik',
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: 'Başlamadı',
  in_progress: 'Devam Ediyor',
  pending: 'Beklemede',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

export const COST_CATEGORY_LABELS: Record<string, string> = {
  hotel: 'Otel',
  transfer: 'Transfer',
  guide: 'Rehber',
  activity: 'Aktivite',
  restaurant: 'Restoran',
  airline: 'Uçuş',
  insurance: 'Sigorta',
  visa: 'Vize',
  service_fee: 'Hizmet Bedeli',
  tax: 'Vergi',
  commission: 'Komisyon',
  other: 'Diğer',
};

export function formatCurrency(amount: number, currency = 'TRY'): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('tr-TR');
}

// ── Personnel (Phase 2D.2) ─────────────────────────────────────────────────
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  GUIDE: 'Rehber',
  DRIVER: 'Şoför',
};

export const RESOURCE_ALIAS_SOURCE_LABELS: Record<string, string> = {
  SHEET_IMPORT: 'Sheet İçe Aktarım',
  PERFORMANCE_2026: '2026 Performans Tablosu',
  MANUAL: 'Manuel',
  LEGACY_OPERATION: 'Geçmiş Operasyon',
};

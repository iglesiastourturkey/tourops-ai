/**
 * Phase 3H.2 — shared operation-domain primitives for the web app.
 *
 * CRUISE / SEJOUR are two operational subdomains over one canonical
 * `operations.id`. These helpers give every aggregating surface (Operasyon
 * Planlama, Takvim, Operasyon Merkezi) a single place to render the domain
 * label and resolve the domain-specific detail route, with a backward
 * compatible fallback for operations that have no type yet.
 */

export type OperationType = 'CRUISE' | 'SEJOUR';

export const OPERATION_TYPE_LABELS: Record<OperationType, string> = {
  CRUISE: 'GEMİ',
  SEJOUR: 'SEJOUR',
};

/** Short badge text. Untyped operations are never silently classified. */
export function operationDomainLabel(type: OperationType | null | undefined): string {
  return type ? OPERATION_TYPE_LABELS[type] : 'Tür belirlenmemiş';
}

/**
 * Domain-specific detail route for an operation. Untyped operations keep the
 * legacy `/operations/:id` route so existing deep links never break.
 */
export function operationDetailHref(id: number, type: OperationType | null | undefined): string {
  if (type === 'CRUISE') return `/operations/gemi/${id}`;
  if (type === 'SEJOUR') return `/operations/sejour/${id}`;
  return `/operations/${id}`;
}

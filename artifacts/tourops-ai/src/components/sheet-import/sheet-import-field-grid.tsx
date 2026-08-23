import type { MappedFields } from '@/lib/sheet-import-api';
import { Input } from '@/components/ui/input';

// mealIncluded/entranceIncluded (enum selects) and passengerAges (number[])
// need custom widgets and are rendered separately by the page - excluded here
// so every key in a FieldSpec list can safely go through a plain text/number
// <Input>.
export type FieldKey = Exclude<keyof MappedFields, 'passengerAges' | 'mealIncluded' | 'entranceIncluded'>;
export type FieldSpec = [key: FieldKey, label: string, type?: 'text' | 'number' | 'date'];

interface SheetImportFieldGridProps {
    fields: FieldSpec[];
    value: MappedFields;
    onChange: (next: MappedFields) => void;
    idPrefix: string;
    disabled?: boolean;
}

/**
 * Grid of labeled inputs for a subset of the sheet-import proposed mapping
 * (MappedFields). Grouped into section-specific field lists by the caller
 * (see sheet-import-detail.tsx) rather than rendering every field at once,
 * so the review panel reads as Genel / Musteri / Yolcu / Tur / Gemi-Liman /
 * Operasyon Atamalari / Hizmet / Kaynak / Finans sections per the Faz 5.3 plan.
 */
export function SheetImportFieldGrid({ fields, value, onChange, idPrefix, disabled = false }: SheetImportFieldGridProps) {
    const set = (key: FieldKey, next: string | number | null) => onChange({ ...value, [key]: next } as MappedFields);

  return (
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map(([key, label, type]) => {
                  const raw = value[key];
                  return (
                              <div key={key} className="text-sm">
                                          <label htmlFor={`${idPrefix}-${key}`} className="text-xs text-muted-foreground block mb-1">{label}</label>
                                          <Input
                                                          id={`${idPrefix}-${key}`}
                                                          type={type ?? 'text'}
                                                          disabled={disabled}
                                                          value={raw === null || raw === undefined ? '' : String(raw)}
                                                          onChange={e => set(
                                                                            key,
                                                                            type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null),
                                                                          )}
                                                        />
                              </div>
                            );
        })}
        </div>
      );
}

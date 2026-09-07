import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { usePermission } from '@/hooks/usePermission';
import {
  REMEDIATION_FIELDS,
  REMEDIATION_FIELD_LABELS,
  REMEDIATION_WARNING_BY_FIELD,
  historicalRemediationApi,
  type RemediationDetail,
  type RemediationField,
} from '@/lib/historical-remediation-api';

// Phase 3E.3 — Controlled Historical Remediation UI.
//
// This card is a thin front-end over the existing Phase 3E.2 endpoint
// POST /api/historical-remediation/:sourceKey/remediate. It corrects EXACTLY
// ONE missing field per request. There is deliberately NO bulk action, NO
// auto-fill, NO inference from evidence/ship schedule/source Type column, NO
// canonical mapping, and NO approval/rejection/promotion here. Optimistic
// concurrency uses the currently-loaded row's version + payload hash; a 409 is
// never retried automatically.

const PICKUP_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

type Props = { row: RemediationDetail };

function isSupportedField(value: string): value is RemediationField {
  return (REMEDIATION_FIELDS as readonly string[]).includes(value);
}

function apiErrorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : null;
}

function apiErrorMessage(error: unknown): string | null {
  const data = (error as { data?: unknown } | null | undefined)?.data;
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return null;
}

export function HistoricalRemediationPanel({ row }: Props) {
  const canRemediate = usePermission('historical_migration', 'remediate');
  const { toast } = useToast();
  const qc = useQueryClient();

  const [field, setField] = useState<RemediationField | ''>('');
  const [value, setValue] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Only fields that are BOTH supported by the mutation engine AND currently
  // reported missing on this row may be corrected. Supported-but-present fields
  // are never offered.
  const remediableFields = useMemo(
    () => row.missingFields.filter(isSupportedField),
    [row.missingFields],
  );

  const resetForm = () => {
    setField('');
    setValue('');
  };

  const mutation = useMutation({
    mutationFn: () => {
      if (!field) throw new Error('Alan seçilmedi');
      const payloadValue: string | number = field === 'adultCount' ? Number(value) : value.trim();
      return historicalRemediationApi.remediate(row.sourceKey, {
        field,
        value: payloadValue,
        // Optimistic concurrency — taken straight from the loaded detail, never
        // cached or manufactured elsewhere.
        expectedVersion: row.approvalVersion,
        expectedPayloadHash: row.payloadSha256,
      });
    },
    onSuccess: () => {
      setConfirmOpen(false);
      resetForm();
      // Refresh the detail and the remediation queue so every derived value
      // (warnings, version, payload hash, derived state) comes from the server.
      qc.invalidateQueries({ queryKey: ['historical-remediation', row.id] });
      qc.invalidateQueries({ queryKey: ['historical-remediation'] });
      toast({ title: 'Düzeltme kaydedildi' });
    },
    onError: (error: unknown) => {
      setConfirmOpen(false);
      const status = apiErrorStatus(error);
      if (status === 409) {
        // Concurrency / integrity conflict — do NOT retry. Force a reload of
        // the record so the reviewer works from fresh values.
        qc.invalidateQueries({ queryKey: ['historical-remediation', row.id] });
        qc.invalidateQueries({ queryKey: ['historical-remediation'] });
        toast({
          title: 'Kayıt değişti',
          description: 'Kayıt bu sırada değişti. Güncel veriyi yeniden yükleyin.',
          variant: 'destructive',
        });
        return;
      }
      if (status === 404) {
        qc.invalidateQueries({ queryKey: ['historical-remediation', row.id] });
        toast({ title: 'Kayıt bulunamadı', description: 'Bu kayıt artık düzeltmeye uygun değil.', variant: 'destructive' });
        return;
      }
      if (status === 403) {
        toast({ title: 'Yetki yok', description: 'Bu düzeltme için yetkiniz bulunmuyor.', variant: 'destructive' });
        return;
      }
      if (status === 401) {
        toast({ title: 'Oturum doğrulanamadı', description: 'Lütfen yeniden giriş yapın.', variant: 'destructive' });
        return;
      }
      if (status === 400) {
        toast({ title: 'Geçersiz değer', description: apiErrorMessage(error) ?? 'Girdiğiniz değer kabul edilmedi.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Düzeltme kaydedilemedi', description: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', variant: 'destructive' });
    },
  });

  // Gate: pending row, intact payload hash, remediate permission, and at least
  // one supported missing field. Anything else → render nothing.
  if (row.status !== 'pending' || !row.payloadHashIntegrity || !canRemediate || remediableFields.length === 0) {
    return null;
  }

  const trimmed = value.trim();
  let valueValid = false;
  if (field === 'adultCount') {
    const n = Number(value);
    valueValid = value !== '' && Number.isInteger(n) && n >= 1 && n <= 99;
  } else if (field === 'pickupTime') {
    valueValid = PICKUP_TIME_RE.test(trimmed);
  } else if (field === 'pickupPoint') {
    valueValid = trimmed.length > 0 && trimmed.length <= 120;
  } else if (field) {
    valueValid = trimmed.length > 0;
  }

  const displayValue = field === 'adultCount' ? String(Number(value)) : trimmed;
  const removedWarning = field ? REMEDIATION_WARNING_BY_FIELD[field] : null;

  return (
    <Card className="border-[#1e3a5f]/20 bg-[#1e3a5f]/[0.03] p-5">
      <div className="flex items-center gap-2">
        <Wrench className="h-4 w-4 text-[#1e3a5f]" />
        <h2 className="font-semibold">Eksik Alanı Düzelt</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Yalnızca eksik olan bir alanı elle düzeltin. Değerler kaynak kanıtından kopyalanmaz; her istekte tek alan güncellenir.
      </p>

      <div className="mt-4 grid gap-4 sm:max-w-md">
        <div className="grid gap-1.5">
          <Label htmlFor="remediation-field">Düzeltilecek alan</Label>
          <Select
            value={field}
            onValueChange={next => {
              setField(isSupportedField(next) ? next : '');
              setValue('');
            }}
          >
            <SelectTrigger id="remediation-field">
              <SelectValue placeholder="Eksik alan seçin" />
            </SelectTrigger>
            <SelectContent>
              {remediableFields.map(item => (
                <SelectItem key={item} value={item}>{REMEDIATION_FIELD_LABELS[item]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {field && (
          <div className="grid gap-1.5">
            <Label htmlFor="remediation-value">{REMEDIATION_FIELD_LABELS[field]}</Label>
            {field === 'pickupTime' && (
              <Input
                id="remediation-value"
                type="time"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="SS:dd"
              />
            )}
            {field === 'adultCount' && (
              <Input
                id="remediation-value"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                step={1}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="1-99"
              />
            )}
            {field === 'pickupPoint' && (
              <Input
                id="remediation-value"
                type="text"
                maxLength={120}
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="Alış noktasını elle yazın (en fazla 120 karakter)"
              />
            )}
            {field === 'passengerLanguage' && (
              <Input
                id="remediation-value"
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="Dili elle yazın (örn. İngilizce)"
              />
            )}
            {field === 'externalOperator' && (
              <Input
                id="remediation-value"
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="Operatör adını elle yazın"
              />
            )}
          </div>
        )}

        <div>
          <Button
            type="button"
            disabled={!field || !valueValid || mutation.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Düzeltmeyi Kaydet
          </Button>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={open => { if (!mutation.isPending) setConfirmOpen(open); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Düzeltmeyi onaylayın</AlertDialogTitle>
            <AlertDialogDescription>
              Bu düzeltme tarihsel kayda hemen uygulanır. Devam etmeden önce kontrol edin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Kaynak anahtarı</dt>
              <dd className="break-all font-mono text-xs">{row.sourceKey}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Misafir</dt>
              <dd>{row.customerName || 'İsimsiz kayıt'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Düzeltilecek alan</dt>
              <dd>{field ? REMEDIATION_FIELD_LABELS[field] : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Yeni değer</dt>
              <dd className="break-words font-medium">{displayValue || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Mevcut uyarılar</dt>
              <dd className="flex flex-wrap gap-1">
                {row.warnings.length === 0
                  ? '—'
                  : row.warnings.map(w => (
                      <Badge key={w} variant="outline" className={w === removedWarning ? 'line-through opacity-60' : undefined}>{w}</Badge>
                    ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Kaldırılacak uyarı</dt>
              <dd className="font-mono text-xs">{removedWarning ?? '—'}</dd>
            </div>
          </dl>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={event => { event.preventDefault(); mutation.mutate(); }}
            >
              Düzeltmeyi Kaydet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

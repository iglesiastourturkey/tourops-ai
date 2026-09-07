import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  historicalRemediationApi,
  type RemediationDetail,
} from '@/lib/historical-remediation-api';

// Phase 3E.4B — Controlled Approval Handoff.
//
// This card is a thin front-end over exactly one endpoint:
// POST /api/historical-remediation/:sourceKey/approve. It approves EXACTLY
// ONE ready record per request. The request body carries ONLY the
// optimistic-concurrency expectations taken from the loaded detail row — no
// correction field/value is accepted here. There is deliberately NO promote,
// NO reject, NO bulk, NO auto approval, NO inference, and NO downstream
// write in this flow; approval only moves pending -> approved for later
// promotion. A 409 is never retried automatically.

type Props = { row: RemediationDetail };

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

export function HistoricalApprovalHandoffPanel({ row }: Props) {
  const canApprove = usePermission('historical_migration', 'approve');
  const { toast } = useToast();
  const qc = useQueryClient();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      historicalRemediationApi.approve(row.sourceKey, {
        // Optimistic concurrency — taken straight from the loaded detail at
        // submit time, never cached or manufactured elsewhere.
        expectedVersion: row.approvalVersion,
        expectedPayloadHash: row.payloadSha256,
      }),
    onSuccess: () => {
      setConfirmOpen(false);
      // Refresh the detail and the remediation queue so every derived value
      // (warnings, version, payload hash, derived state) comes from the server.
      // The approval CTA disappears on refetch because the row is no longer
      // pending/READY_FOR_REVIEW.
      qc.invalidateQueries({ queryKey: ['historical-remediation', row.id] });
      qc.invalidateQueries({ queryKey: ['historical-remediation'] });
      toast({ title: 'İnceleme onaylandı' });
    },
    onError: (error: unknown) => {
      setConfirmOpen(false);
      const status = apiErrorStatus(error);
      if (status === 409) {
        // Stale version/hash, no longer pending, or no longer review-ready —
        // do NOT retry. Force a reload so the reviewer works from fresh values.
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
        toast({ title: 'Kayıt bulunamadı', description: 'Bu kayıt artık onaya uygun değil.', variant: 'destructive' });
        return;
      }
      if (status === 403) {
        toast({ title: 'Yetki yok', description: 'Bu onay için yetkiniz bulunmuyor.', variant: 'destructive' });
        return;
      }
      if (status === 401) {
        toast({ title: 'Oturum doğrulanamadı', description: 'Lütfen yeniden giriş yapın.', variant: 'destructive' });
        return;
      }
      if (status === 400) {
        toast({ title: 'Geçersiz istek', description: apiErrorMessage(error) ?? 'İstek kabul edilmedi.', variant: 'destructive' });
        return;
      }
      toast({ title: 'Onay kaydedilemedi', description: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.', variant: 'destructive' });
    },
  });

  // Gate: READY_FOR_REVIEW + pending + intact payload hash + approve
  // permission. Anything else → render nothing. Never shown on the queue
  // list, never for imported/approved/rejected/UNRESOLVED rows.
  if (row.derivedState !== 'READY_FOR_REVIEW' || row.status !== 'pending' || !row.payloadHashIntegrity || !canApprove) {
    return null;
  }

  return (
    <Card className="border-emerald-700/20 bg-emerald-700/[0.04] p-5">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-700" />
        <h2 className="font-semibold">İnceleme Onayı</h2>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Bu kayıt incelemeye hazır. Onay yalnızca kaydı onaylar; operasyon/rezervasyon oluşturmaz ve promotion çalıştırmaz.
      </p>

      <div className="mt-4">
        <Button
          type="button"
          disabled={mutation.isPending}
          onClick={() => setConfirmOpen(true)}
        >
          İncelemeyi Onayla
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={open => { if (!mutation.isPending) setConfirmOpen(open); }}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Onayı onaylayın</AlertDialogTitle>
            <AlertDialogDescription>
              Bu işlem yalnızca kaydı onaylar. Operasyon/rezervasyon oluşturmaz ve promotion çalıştırmaz.
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
              <dt className="text-xs text-muted-foreground">Mevcut uyarılar</dt>
              <dd className="flex flex-wrap gap-1">
                {row.warnings.length === 0
                  ? '—'
                  : row.warnings.map(w => (
                      <Badge key={w} variant="outline">{w}</Badge>
                    ))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Payload SHA256</dt>
              <dd className="break-all font-mono text-xs">{row.payloadSha256}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Onay sürümü</dt>
              <dd className="font-mono text-xs">{row.approvalVersion}</dd>
            </div>
          </dl>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={event => { event.preventDefault(); mutation.mutate(); }}
            >
              Onayla
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

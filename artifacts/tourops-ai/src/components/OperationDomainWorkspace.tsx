import { CruiseOperationDetail } from '@/components/operation-detail/CruiseOperationDetail';
import { SejourOperationDetail } from '@/components/operation-detail/SejourOperationDetail';
import { useOperationDetail } from '@/components/operation-detail/operation-shared-sections';

/**
 * Phase 3H.2 — operation detail dispatcher.
 *
 * One canonical operation identity, two operational subdomains. This component
 * fetches the shared `/detail` read model once and hands off to the
 * domain-specific detail experience:
 *
 *   operationType === 'SEJOUR'          → <SejourOperationDetail>
 *   operationType === 'CRUISE' or null  → <CruiseOperationDetail>
 *
 * Untyped (legacy / pre-backfill) operations keep the cruise-oriented view so
 * existing behaviour is unchanged until the historical backfill runs. The
 * shared reservation / customer / guide / driver / vehicle / notes / audit
 * blocks are implemented once in `operation-shared-sections` and reused by
 * both. Used across the operations, field and guide surfaces.
 */
export function OperationDomainWorkspace({ operationId, surface = 'operations' }: { operationId: number; surface?: 'operations' | 'field' | 'guide' }) {
  const { data, isPending, isError, refetch } = useOperationDetail(operationId, surface);

  if (isPending) return <p role="status" className="p-4">Rezervasyonlar yükleniyor…</p>;
  if (isError || !data) return <div role="alert" className="p-4 border rounded mb-4">Rezervasyon detayı yüklenemedi. <button className="underline focus-visible:outline" onClick={() => refetch()}>Tekrar dene</button></div>;

  if (data.operation.operationType === 'SEJOUR') return <SejourOperationDetail detail={data} />;
  return <CruiseOperationDetail detail={data} />;
}

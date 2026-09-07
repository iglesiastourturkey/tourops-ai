import { customFetch } from '@workspace/api-client-react';

export type RemediationState = 'UNRESOLVED' | 'READY_FOR_REVIEW';
export type EvidenceCell = { address: string; column: number; header: string | null; rawValue: unknown; displayValue: string | null; isBlank: boolean };
export type RemediationRow = {
  id: number; sourceKey: string; operationDate: string; customerName: string | null;
  sourceKind: string; sourceFileId: string; workbookPath: string | null; worksheetName: string;
  sourceRow: number; warnings: string[]; warningProfile: string; missingFields: string[];
  externalSource: string | null; externalOperator: string | null; derivedState: RemediationState;
  hasSourceEvidence: boolean;
};
export type RemediationList = {
  mode: string; databaseWrites: false; total: number; page: number; pageSize: number; rows: RemediationRow[];
  facets: { workbooks: string[]; months: string[]; warningProfiles: string[]; sourceKinds: string[]; externalSources: string[]; externalOperators: string[] };
};
export type RemediationDetail = RemediationRow & {
  status: 'pending'; payloadSha256: string; payloadHashIntegrity: boolean;
  historicalRecord: Record<string, unknown>; provenance: Record<string, unknown>;
  evidence: null | { workbookPath: string; workbookSha256: string; worksheetName: string; sourceRow: number; headerRow: number; cells: EvidenceCell[]; evidenceSha256: string; capturedAt: string };
};

export const historicalRemediationApi = {
  list: (params: URLSearchParams) => customFetch<RemediationList>(`/api/historical-remediation?${params}`),
  get: (id: number) => customFetch<RemediationDetail>(`/api/historical-remediation/${id}`),
};

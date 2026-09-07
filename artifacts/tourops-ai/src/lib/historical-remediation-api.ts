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
  status: 'pending'; approvalVersion: number; payloadSha256: string; payloadHashIntegrity: boolean;
  historicalRecord: Record<string, unknown>; provenance: Record<string, unknown>;
  evidence: null | { workbookPath: string; workbookSha256: string; worksheetName: string; sourceRow: number; headerRow: number; cells: EvidenceCell[]; evidenceSha256: string; capturedAt: string };
};

// Phase 3E.3 — the exact set the Phase 3E.2 mutation engine accepts
// (artifacts/api-server/src/lib/historical-remediation-mutation-validation.ts).
// One field per request, manual value only, no inference, no bulk.
export const REMEDIATION_FIELDS = ['pickupTime', 'passengerLanguage', 'pickupPoint', 'adultCount', 'externalOperator'] as const;
export type RemediationField = typeof REMEDIATION_FIELDS[number];

export const REMEDIATION_FIELD_LABELS: Record<RemediationField, string> = {
  pickupTime: 'Alış saati',
  passengerLanguage: 'Dil',
  pickupPoint: 'Alış noktası',
  adultCount: 'Yetişkin sayısı',
  externalOperator: 'Operatör',
};

// Warning each correction clears, mirrors REMEDIATION_WARNING_BY_FIELD on the server.
export const REMEDIATION_WARNING_BY_FIELD: Record<RemediationField, string> = {
  pickupTime: 'missing_pickup_time',
  passengerLanguage: 'missing_language',
  pickupPoint: 'missing_pickup_point',
  adultCount: 'missing_adult_count',
  externalOperator: 'missing_operator',
};

export type RemediationMutationRequest = {
  field: RemediationField;
  value: string | number;
  expectedVersion: number;
  expectedPayloadHash: string;
};

// Shape returned by POST /:sourceKey/remediate (Phase 3E.2 mutation engine).
export type RemediationMutationResult = {
  id: number;
  sourceKey: string;
  status: 'pending';
  warnings: string[];
  payload: Record<string, unknown>;
  payloadSha256: string;
  approvalVersion: number;
};

// Phase 3E.4B — the approval handoff accepts ONLY the optimistic-concurrency
// expectations. No correction field/value is accepted here.
export type ApprovalHandoffRequest = {
  expectedVersion: number;
  expectedPayloadHash: string;
};

// Shape returned by POST /:sourceKey/approve (Phase 3E.4B approval handoff).
export type ApprovalHandoffResult = {
  id: number;
  sourceKey: string;
  status: 'approved';
  approvalVersion: number;
  payloadSha256: string;
};

export const historicalRemediationApi = {
  list: (params: URLSearchParams) => customFetch<RemediationList>(`/api/historical-remediation?${params}`),
  get: (id: number) => customFetch<RemediationDetail>(`/api/historical-remediation/${id}`),
  remediate: (sourceKey: string, body: RemediationMutationRequest) =>
    customFetch<RemediationMutationResult>(`/api/historical-remediation/${encodeURIComponent(sourceKey)}/remediate`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approve: (sourceKey: string, body: ApprovalHandoffRequest) =>
    customFetch<ApprovalHandoffResult>(`/api/historical-remediation/${encodeURIComponent(sourceKey)}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

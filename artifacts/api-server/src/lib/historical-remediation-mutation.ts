import { db } from "@workspace/db";
import { historicalOperationImportsTable } from "@workspace/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { createAuditLog } from "./audit";
import {
  applyHistoricalRemediationValue,
  getHistoricalRemediationValue,
  isHistoricalRemediationField,
  REMEDIATION_WARNING_BY_FIELD,
  type HistoricalRemediationField,
  validateRemediationValue,
} from "./historical-remediation-mutation-validation";
import {
  parseHistoricalStagingRecord,
  sha256OfHistoricalStagingRecord,
  type HistoricalStagingRecord,
} from "./historical-migration-stage-validation";

const SHA256 = /^[0-9a-f]{64}$/;

export class HistoricalRemediationError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HistoricalRemediationError";
  }
}

export interface RemediateHistoricalImportParams {
  sourceKey: string;
  field: HistoricalRemediationField;
  value: unknown;
  expectedVersion: number;
  expectedPayloadHash: string;
  actorProfileId: number;
}

function sourceIdentityMatches(row: {
  sourceKey: string;
  sourceFileId: string;
  worksheetName: string;
  sourceRow: number;
}, payload: HistoricalStagingRecord): boolean {
  const expectedKey = `legacy:${row.sourceFileId}:${row.worksheetName}:${row.sourceRow}`;
  return row.sourceKey === expectedKey
    && payload.idempotencyKey === expectedKey
    && payload.provenance.sourceFileId === row.sourceFileId
    && payload.provenance.worksheetName === row.worksheetName
    && payload.provenance.sourceRow === row.sourceRow;
}

function warningsMatchPayload(rowWarnings: readonly string[], payloadWarnings: readonly string[]): boolean {
  return rowWarnings.length === payloadWarnings.length
    && rowWarnings.every((warning, index) => warning === payloadWarnings[index]);
}

function conflict(message: string): never {
  throw new HistoricalRemediationError(409, "remediation_conflict", message);
}

export async function remediateHistoricalImport(params: RemediateHistoricalImportParams) {
  if (!/^legacy:[^:]+:[^:]+:[1-9]\d*$/.test(params.sourceKey)) {
    throw new HistoricalRemediationError(400, "invalid_source_key", "sourceKey must be an exact historical source key");
  }
  if (!isHistoricalRemediationField(params.field)) {
    throw new HistoricalRemediationError(400, "unsupported_field", "Field is not supported for historical remediation");
  }
  if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 1) {
    throw new HistoricalRemediationError(400, "invalid_expected_version", "expectedVersion must be a positive integer");
  }
  if (!SHA256.test(params.expectedPayloadHash)) {
    throw new HistoricalRemediationError(400, "invalid_expected_payload_hash", "expectedPayloadHash must be a lowercase SHA-256 digest");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(historicalOperationImportsTable)
      .where(eq(historicalOperationImportsTable.sourceKey, params.sourceKey))
      .for("update")
      .limit(1);
    if (!row) throw new HistoricalRemediationError(404, "historical_import_not_found", "Historical import not found");
    if (row.status !== "pending") conflict("Only pending historical imports can be remediated");

    let payload: HistoricalStagingRecord;
    try {
      payload = parseHistoricalStagingRecord(row.payload);
    } catch {
      conflict("Stored historical payload is invalid");
    }
    if (!sourceIdentityMatches(row, payload)) conflict("Historical provenance integrity check failed");
    if (sha256OfHistoricalStagingRecord(payload) !== row.payloadSha256) {
      conflict("Stored historical payload hash integrity check failed");
    }
    if (row.approvalVersion !== params.expectedVersion || row.payloadSha256 !== params.expectedPayloadHash) {
      conflict("The historical import changed since it was read");
    }
    if (!warningsMatchPayload(row.warnings, payload.warnings)) {
      conflict("Stored historical warning integrity check failed");
    }

    const warning = REMEDIATION_WARNING_BY_FIELD[params.field];
    const warningCount = row.warnings.filter(item => item === warning).length;
    if (warningCount !== 1) conflict(`Expected exactly one ${warning} warning`);
    if (getHistoricalRemediationValue(payload, params.field) !== null) {
      conflict(`${params.field} is already populated`);
    }

    let nextValue;
    try {
      nextValue = validateRemediationValue(params.field, params.value);
    } catch (error) {
      throw new HistoricalRemediationError(400, "invalid_remediation_value", error instanceof Error ? error.message : "Invalid remediation value");
    }

    const nextPayload = applyHistoricalRemediationValue(payload, params.field, nextValue);
    const nextWarnings = payload.warnings.filter(item => item !== warning);
    const nextPayloadWithWarnings = { ...nextPayload, warnings: nextWarnings };
    const nextPayloadSha256 = sha256OfHistoricalStagingRecord(nextPayloadWithWarnings);
    const [updated] = await tx.update(historicalOperationImportsTable).set({
      payload: nextPayloadWithWarnings,
      payloadSha256: nextPayloadSha256,
      warnings: nextWarnings,
      approvalVersion: sql`${historicalOperationImportsTable.approvalVersion} + 1`,
      updatedAt: new Date(),
    }).where(and(
      eq(historicalOperationImportsTable.id, row.id),
      eq(historicalOperationImportsTable.status, "pending"),
      eq(historicalOperationImportsTable.approvalVersion, params.expectedVersion),
      eq(historicalOperationImportsTable.payloadSha256, params.expectedPayloadHash),
    )).returning({
      id: historicalOperationImportsTable.id,
      sourceKey: historicalOperationImportsTable.sourceKey,
      payload: historicalOperationImportsTable.payload,
      payloadSha256: historicalOperationImportsTable.payloadSha256,
      warnings: historicalOperationImportsTable.warnings,
      approvalVersion: historicalOperationImportsTable.approvalVersion,
      status: historicalOperationImportsTable.status,
    });
    if (!updated) conflict("The historical import changed during remediation");

    await createAuditLog({
      eventType: "historical_migration_remediated",
      actorProfileId: params.actorProfileId,
      module: "historical_migration",
      result: "success",
      description: "Historical import field remediated",
      entityType: "historical_operation_import",
      entityId: row.id,
      oldValue: { field: params.field, value: getHistoricalRemediationValue(payload, params.field) },
      newValue: { field: params.field, value: nextValue },
      metadata: {
        historicalImportId: row.id,
        sourceKey: row.sourceKey,
        correctedField: params.field,
        removedWarning: warning,
        previousPayloadHash: row.payloadSha256,
        newPayloadHash: nextPayloadSha256,
        previousVersion: row.approvalVersion,
        newVersion: row.approvalVersion + 1,
      },
    }, tx);

    return {
      id: updated.id,
      sourceKey: updated.sourceKey,
      status: updated.status,
      warnings: updated.warnings,
      payload: updated.payload,
      payloadSha256: updated.payloadSha256,
      approvalVersion: updated.approvalVersion,
    };
  });
}

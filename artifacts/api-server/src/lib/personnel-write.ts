/**
 * Validated write surface for the canonical Personnel/Guide identity
 * foundation (Phase 2D.1). Deliberately narrow — see
 * docs/architecture/phase2d1-personnel-identity-foundation.md.
 *
 * `type` is not editable after creation: changing GUIDE<->DRIVER on an
 * identity that may already be referenced by aliases, `operations`, or a
 * linked profile is a distinct, higher-risk operation this phase's minimal
 * slice does not cover.
 */
import { z } from "zod/v4";

export const RESOURCE_TYPES = ["GUIDE", "DRIVER"] as const;
export type ResourceType = typeof RESOURCE_TYPES[number];

export const resourceCreateSchema = z.object({
  type: z.enum(RESOURCE_TYPES),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  languages: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  licenseNumber: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
export type ResourceCreateInput = z.infer<typeof resourceCreateSchema>;

export const resourceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  languages: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  licenseNumber: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  // Explicit null clears the link (unlink); undefined leaves it untouched;
  // a number sets/replaces it. Existence + uniqueness of the target profile
  // and "not already linked to a different resource" are checked in the
  // route, not here, since that needs a DB read.
  linkedProfileId: z.number().int().positive().nullable().optional(),
}).strict();
export type ResourceUpdateInput = z.infer<typeof resourceUpdateSchema>;

// Deliberately not a DB CHECK constraint (see resource_aliases.ts) so a new
// source doesn't need a migration — but the API layer still validates
// against a known, documented set, same spirit as reservations.source_type.
export const RESOURCE_ALIAS_SOURCES = [
  "SHEET_IMPORT",
  "PERFORMANCE_2026",
  "MANUAL",
  "LEGACY_OPERATION",
] as const;
export type ResourceAliasSource = typeof RESOURCE_ALIAS_SOURCES[number];

export const resourceAliasCreateSchema = z.object({
  source: z.enum(RESOURCE_ALIAS_SOURCES),
  alias: z.string().trim().min(1).max(200),
}).strict();
export type ResourceAliasCreateInput = z.infer<typeof resourceAliasCreateSchema>;

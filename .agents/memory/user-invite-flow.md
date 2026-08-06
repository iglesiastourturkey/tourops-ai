---
name: User invite flow
description: How admin-initiated Clerk invitations are wired to pre-assigned roles in the profiles table
---

## The Rule
When an admin invites a new user via `POST /api/users/invite`:
1. `clerkClient.invitations.createInvitation({ emailAddress, publicMetadata: { pendingRole }, ignoreExisting: true })` — sends the Clerk invitation email
2. A profile stub is inserted with `clerkUserId = 'pending-<email>'` and the assigned role

Invitation acceptance must go through a dedicated public completion screen after Clerk activates the signup session. That screen calls the authenticated invitation-completion endpoint, which atomically claims only the matching pending stub and preserves its saved role before redirecting to the role's workspace.

**Why:** Redirecting Clerk signup directly to `/dashboard` causes valid guide and field-operations invitees to hit the role guard and see “Yetkisiz Erişim” before their profile is deterministically linked.

**How to apply:** Keep `/sign-up` and its completion route outside all profile/permission guards. Completion is idempotent for an already-claimed Clerk user but never creates a fallback profile, rebinds an existing profile, or permits an unmatched email. Redirect only after the completion response supplies the authoritative role.

For ordinary first sign-in outside an invitation, `getOrCreateProfile` retains its three-path behavior:
1. **By clerkUserId** — normal case; return as-is to preserve existing role
2. **By email with pending-% stub** — claim the stub
3. **New user** — insert with default `guide` role

## Last-admin protection (backend, PATCH /api/users/:clerkUserId)
- COUNT active admins (excluding pending-% stubs)
- If target is admin AND activeAdminCount ≤ 1: block `isActive=false` and `role !== 'admin'` changes with 403

## Pending stubs are excluded from GET /api/users list
`WHERE clerkUserId NOT LIKE 'pending-%'`

**Why:** Pending stubs exist only to carry the role across the invite → first-sign-in gap. Showing them in the user list would confuse admins.

**How to apply:** Any new query over `profilesTable` that should show "real" users must add `not(like(profilesTable.clerkUserId, 'pending-%'))`.

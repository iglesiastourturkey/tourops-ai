---
name: Super admin role
description: How the super_admin role is implemented and how it bypasses RBAC checks
---

## The Rule
`super_admin` is a universal-pass role added to `VALID_ROLES`. It supersedes every other role restriction.

**Backend (`requireRole`):** `profile.role === 'super_admin' || roles.includes(profile.role)` — super_admin passes any route regardless of which roles are listed.

**Frontend (`RoleRoute`):** `role !== 'super_admin' && !roles.includes(role)` — super_admin bypasses all frontend role restrictions.

## User management is super_admin-only
`GET/PATCH /api/users`, `POST /api/users/invite`, session revoke, password-reset token, invitations list/revoke/resend — all use `requireRole('super_admin')`.

The frontend `/users` route uses `roles={['super_admin']}`.

## Profile sync root cause (fixed)
Google OAuth users signed in with empty `sessionClaims.email` because the JWT claims weren't populated. `getOrCreateProfile` now calls `clerkClient.users.getUser(clerkUserId)` to back-fill missing name/email on first encounter (lazy, one-time per profile). This also fixed the pending-stub lookup which failed with empty email.

**Why:** Clerk's JWT `sessionClaims` only include `email`/`name` if the session claim template is configured. OAuth sign-ins may bypass this. Never rely on claims alone for user data.

## Initial super admin setup
Profile id=1 was updated via SQL: `UPDATE profiles SET role = 'super_admin' WHERE id = 1`. Email/name will auto-populate on next sign-in via `fetchClerkUserData`. To establish the initial super admin in a fresh deployment, run this SQL or use the DB skill.

**How to apply:** Any new deployment needs at least one `super_admin` profile row. The lazy email-sync handles name/email automatically; only the role needs manual bootstrapping.

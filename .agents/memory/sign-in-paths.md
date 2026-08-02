---
name: Separate sign-in paths
description: Two-path sign-in UX: staff uses Clerk's hosted component, admin uses a custom form with role enforcement and username+password.
---

## Route layout

| Path | Component | Purpose |
|---|---|---|
| `/sign-in` | `sign-in-select.tsx` | Selection screen — two cards |
| `/sign-in/staff/*?` | `sign-in-staff.tsx` | Thin wrapper around Clerk `<SignIn routing="path">` |
| `/sign-in/admin` | `sign-in-admin.tsx` | Custom form: username+password + Google OAuth + role check |

## Shared appearance

`src/lib/clerk-appearance.ts` exports `clerkAppearance`, `VITE_BASE`, and `API_BASE`.
Imported by App.tsx and all sign-in pages. Do not re-define it inline.

## Admin sign-in role enforcement

After any successful credential sign-in on the admin path, the frontend:
1. Gets a Clerk token via `getToken()`
2. Calls `GET /api/profiles/me` with Bearer header
3. If role not `admin` | `super_admin` → calls `clerk.signOut()` + shows denial inline

## Google OAuth on admin path

Sets `sessionStorage` key `tourpilot_admin_sso='1'` before the OAuth redirect.
`redirectUrl` points to `/sign-in/staff/sso-callback`; `redirectUrlComplete` → `/sign-in/admin`.
On mount, the component detects the key, sets mode to `'checking'`, clears the key, and runs the role check.

## Username assignment (PATCH /api/users/:clerkUserId)

- Body: `{ username: string }` (separate from role/isActive — handled first and returns early)
- Normalised to lowercase, validated `/^[a-z0-9_]{3,32}$/`
- Target profile must have role `admin` or `super_admin`; otherwise 403
- Calls `clerkClient.users.updateUser(clerkUserId, { username })` — Clerk enforces uniqueness (409 if taken)
- UI: "Kullanıcı Adı Ata" dropdown item appears only for admin/super_admin targets (users.tsx)

**Why:** Username-based sign-in on the admin path separates administrator credentials from the email-based staff path, so a compromised staff email cannot access the admin sign-in form.

**How to apply:** Any future change to the admin sign-in flow must preserve the post-login role check; removing it would allow non-admin Clerk accounts to reach the admin dashboard.

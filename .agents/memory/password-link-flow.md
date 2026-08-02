---
name: Password link flow
description: How admin-generated password setup/reset links work and how the UI distinguishes them
---

## The Rule
There is a single API endpoint `POST /api/users/:clerkUserId/password-reset` that generates a 24-hour Clerk sign-in token (`signInTokens.createSignInToken`). The UI shows different labels and dialog text based on `user.passwordEnabled`:

- `passwordEnabled === false` → "Şifre Kurulum Bağlantısı" (initial setup, e.g. Google-only or new invite)
- `passwordEnabled === true`  → "Şifre Sıfırlama Bağlantısı" (reset existing password)

**Why:** Clerk has no separate admin-side "send password reset email" API. `signInTokens` is the only mechanism for admin-generated access links and works for both initial setup and reset. The `passwordEnabled` field comes from the Clerk user object and is exposed in `GET /api/users` enrichment.

**How to apply:** `getEnrichedUsers()` in `artifacts/api-server/src/routes/users.ts` returns `passwordEnabled: cu?.passwordEnabled ?? false`. The `EnrichedUser` type in `users.tsx` includes `passwordEnabled: boolean`. The `handlePasswordLink(user)` function sets the dialog title/description before calling the mutation.

## aydin254@gmail.com super_admin setup
If the account already signed in once, run:
```sql
UPDATE profiles SET role = 'super_admin', is_active = true
WHERE email = 'aydin254@gmail.com' AND clerk_user_id NOT LIKE 'pending-%';
```
If never signed in (no real profile yet), upsert a pending stub:
```sql
INSERT INTO profiles (clerk_user_id, email, role, is_active)
VALUES ('pending-aydin254@gmail.com', 'aydin254@gmail.com', 'super_admin', true)
ON CONFLICT (clerk_user_id) DO UPDATE SET role = 'super_admin', is_active = true;
```
On first sign-in `getOrCreateProfile` will claim the stub automatically.

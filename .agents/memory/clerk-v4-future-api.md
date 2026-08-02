---
name: Clerk v4 future API
description: useSignIn hook returns a SignInFutureResource (signal-based), not the classic resource with isLoaded; setActive() is required after finalize()
---

## The Rule
`useSignIn()` in `@clerk/react` ≥ v4 (installed here) returns `{ signIn, errors, fetchStatus }` — **no `isLoaded`**. Check `!!signIn` for readiness.

All methods on `SignInFutureResource` return `Promise<{ error: ClerkError | null }>` — they do **not throw**. Always destructure `{ error }` and check it.

## Password reset flow (resetPasswordEmailCode)
```ts
const { signIn } = useSignIn();   // signIn: SignInFutureResource | null

// 1. Identify the user
const { error } = await signIn.create({ identifier: email });

// 2. Send reset code to email (no params — email comes from create())
const { error } = await signIn.resetPasswordEmailCode.sendCode();

// 3. Verify the code
const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
//    → signIn.status becomes 'needs_new_password'

// 4. Submit new password
const { error } = await signIn.resetPasswordEmailCode.submitPassword({ password, signOutOfOtherSessions: true });

// 5. Create session (signs the user in)
const { error } = await signIn.finalize();
```

## OAuth / Google sign-in
`authenticateWithRedirect()` is GONE. Use `signIn.sso()` instead:
```ts
const { error } = await signIn.sso({
  strategy:           'oauth_google',
  redirectUrl:         '<sso-callback-url>',
  redirectCallbackUrl: '<post-auth-destination>',   // was: redirectUrlComplete
});
if (error) throw new Error(clerkMsg(error));
```
Key rename: `redirectUrlComplete` → `redirectCallbackUrl`.

## Classic strategy strings are GONE
`create({ strategy: 'reset_password_email_code' })` is invalid in v4. Use the namespaced methods instead.

**Why:** Clerk shifted to a "future" namespace-based API in the React SDK; the old `attemptFirstFactor` / `resetPassword` / `authenticateWithRedirect` API lives on `SignInResource` (classic) which is no longer what `useSignIn()` returns.

**How to apply:** Any page using `useSignIn` must use the above pattern. Do not use `attemptFirstFactor`, `prepareFirstFactor`, `resetPassword`, `authenticateWithRedirect`, or the `strategy` string in `create()`.

## CRITICAL: setActive() is required after finalize()
After `signIn.create()` + `signIn.finalize()` both succeed, **you must call `clerk.setActive()`** or the session never reaches the browser:
```ts
const { error: createErr } = await signIn.create({ identifier, password });
if (createErr) { ... }
const { error: finalErr } = await signIn.finalize();
if (finalErr) { ... }
// signIn.status and signIn.createdSessionId are on the resource (mutated in-place),
// NOT on the return value of create()/finalize() — those return { error } only.
if (signIn.status === 'complete') {
  await clerk.setActive({ session: signIn.createdSessionId });
}
```
Without `setActive()`: session lives on Clerk's server only, `userId` stays `null` in the browser, and any effect gated on `userId` (role check, profile fetch) never fires → infinite spinner.
After `setActive()`: use hook-sourced `getToken()` from `useAuth()`, not `clerk.session?.getToken()` — `clerk.session` may still be `null` for a few ms after activation.

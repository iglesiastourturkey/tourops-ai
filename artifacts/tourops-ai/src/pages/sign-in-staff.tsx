/**
 * Staff sign-in page.
 *
 * Uses Clerk's hosted <SignIn> component at /sign-in/staff so Clerk handles:
 *   • Email + password
 *   • Google OAuth (and the SSO callback at /sign-in/staff/sso-callback)
 *   • MFA challenges
 *
 * After successful sign-in Clerk redirects to the forceRedirectUrl (/).
 * HomeRedirect then dispatches to the correct workspace by actual role.
 */
import { SignIn } from '@clerk/react';
import { Link } from 'wouter';
import { ChevronLeft } from 'lucide-react';
import { clerkAppearance, VITE_BASE } from '@/lib/clerk-appearance';

export default function SignInStaffPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-4">

      {/* Back link */}
      <div className="w-full max-w-md">
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Geri
        </Link>
      </div>

      {/* Clerk SignIn — handles SSO callback at /sign-in/staff/sso-callback automatically */}
      {/* Google social button and divider hidden via appearance; OAuth integration kept intact */}
      <SignIn
        routing="path"
        path={`${VITE_BASE}/sign-in/staff`}
        signUpUrl={`${VITE_BASE}/sign-up`}
        forceRedirectUrl={`${VITE_BASE}/`}
        appearance={{
          ...clerkAppearance,
          elements: {
            ...clerkAppearance.elements,
            socialButtonsRoot: 'hidden',
            dividerRow: 'hidden',
          },
        }}
      />

      {/* Forgot password link below the card */}
      <Link
        href="/forgot-password"
        className="text-sm text-muted-foreground hover:text-primary transition-colors"
      >
        Şifremi Unuttum?
      </Link>
    </div>
  );
}

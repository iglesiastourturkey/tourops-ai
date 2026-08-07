/**
 * Administrator sign-in page.
 *
 * Supports:
 *   • Clerk username + password  (admins receive a Clerk username)
 *   • Google OAuth               (only for already-linked admin accounts)
 *   • "Şifremi unuttum" → /forgot-password
 *
 * After sign-in the backend role is fetched via GET /api/profiles/me.
 * Non-admin users (staff who attempt to use this path) are immediately
 * signed out and shown the Turkish unauthorized message.
 *
 * NEVER trusts the sign-in path as proof of role — RBAC on the API is the
 * sole source of truth.
 */
import { useState, useEffect, useRef } from 'react';
import { useSignIn, useAuth, useClerk } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { APP_VERSION } from '@/lib/version';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Shield, ChevronLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { API_BASE, VITE_BASE } from '@/lib/clerk-appearance';
import { SecondFactorVerification } from '@/components/auth/second-factor-verification';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clerkMsg(err: { message?: string; longMessage?: string } | null | undefined): string {
  return err?.longMessage ?? err?.message ?? 'Bilinmeyen hata';
}

const ADMIN_SSO_KEY = 'tourpilot_admin_sso';

// ── Component ─────────────────────────────────────────────────────────────────

type Mode = 'form' | 'checking' | 'denied' | 'client-trust' | 'second-factor' | 'new-password';

export default function SignInAdminPage() {
  const { signIn }        = useSignIn();
  const { isLoaded, userId, getToken } = useAuth();
  const clerk             = useClerk();
  const { toast }         = useToast();
  const [, navigate]      = useLocation();

  const [username,  setUsername]  = useState('');
  const [password,  setPassword]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [mode,      setMode]      = useState<Mode>('form');
  const [formError, setFormError] = useState<string | null>(null);

  // Flag: this render was triggered by a returning Google OAuth
  const isOAuthReturn = useRef(false);

  // ── Mount: detect Google OAuth return ─────────────────────────────────────
  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_SSO_KEY) === '1') {
      sessionStorage.removeItem(ADMIN_SSO_KEY);
      isOAuthReturn.current = true;
      setMode('checking');
    }
  }, []);

  // ── Redirect already-signed-in users who navigated here directly ──────────
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (mode !== 'form') return;          // currently checking/denied/error — don't touch
    if (isOAuthReturn.current) return;    // OAuth return handled separately
    navigate('/');
  }, [isLoaded, userId, mode]);

  // ── Role enforcement: fires when userId is set AND we're in 'checking' ────
  useEffect(() => {
    if (mode !== 'checking') return;
    if (!isLoaded || !userId) return;
    doRoleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, isLoaded, userId]);

  // ── Role check ────────────────────────────────────────────────────────────
  async function doRoleCheck() {
    try {
      // getToken() can hang indefinitely after Google OAuth because Clerk may
      // need to make a network round-trip to verify the freshly-activated
      // session.  Race against a hard timeout so the spinner can never freeze.
      const nullAfter = (ms: number) =>
        new Promise<null>(resolve => setTimeout(() => resolve(null), ms));

      let token = await Promise.race([getToken(), nullAfter(5_000)]);
      if (!token) {
        // Brief wait then one retry in case the JWT wasn't ready on first call
        await new Promise<void>(r => setTimeout(r, 800));
        token = await Promise.race([getToken(), nullAfter(3_000)]);
      }

      if (!token) {
        // JWT never arrived — show form error without signing out so user can retry
        setMode('form');
        setFormError('Oturum başlatılamadı. Lütfen tekrar giriş yapın.');
        return;
      }

      // Abort the profile fetch after 15 s so a slow/unresponsive API can't
      // keep the spinner alive forever.
      const controller = new AbortController();
      const fetchTimer = setTimeout(() => controller.abort(), 15_000);

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/profiles/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimer);
      }

      if (res.status === 403) {
        // Deactivated account
        await clerk.signOut().catch(() => {});
        isOAuthReturn.current = false;
        setMode('denied');
        return;
      }

      if (!res.ok) {
        // Network or server error — do NOT sign out, let the user retry
        setMode('form');
        setFormError(`Profil doğrulanamadı (HTTP ${res.status}). Lütfen tekrar deneyin.`);
        return;
      }

      const profile = await res.json();

      if (['admin', 'super_admin'].includes(profile?.role)) {
        // Redirect to forced password change if the user has a temporary password
        const mustChangePw = !!(profile?.mustChangePassword);
        navigate(mustChangePw ? '/change-password' : '/dashboard');
      } else {
        // Valid session but wrong role — sign out and show denied screen
        await clerk.signOut().catch(() => {});
        isOAuthReturn.current = false;
        setMode('denied');
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        // API took >15 s — show error without signing out
        setMode('form');
        setFormError('Sunucu yanıt vermedi. Lütfen tekrar deneyin.');
        return;
      }
      // Unexpected network failure — show form error without signing out
      setMode('form');
      setFormError('Kimlik doğrulama sırasında bir hata oluştu. Lütfen tekrar deneyin.');
    }
  }

  // ── Username / password sign-in ───────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    if (!username.trim() || !password) return;

    setLoading(true);
    setFormError(null);

    try {
      // create() with both identifier + password completes the sign-in in one
      // step for password-based flows.  The resource is mutated in-place;
      // the return value only carries { error }.
      //
      // DO NOT call finalize() here — finalize() is for flows with a pending
      // next factor (e.g. MFA).  Calling it on an already-complete sign-in
      // returns "Cannot finalize sign-in without a created session".
      const { error: createErr } = await signIn.create({
        identifier: username.trim().toLowerCase(),
        password,
      });
      if (createErr) {
        setFormError(clerkMsg(createErr));
        return;
      }

      // Inspect the resource directly (mutated in-place by create()).
      // status and createdSessionId are NOT on the create() return value.
      await continueSignIn();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Giriş başarısız');
    } finally {
      setLoading(false);
    }
  }

  async function continueSignIn() {
    if (!signIn) return;
    if (signIn.status === 'complete' && signIn.createdSessionId) {
      await clerk.setActive({ session: signIn.createdSessionId });
      setMode('checking');
      return;
    }
    if (signIn.status === 'needs_client_trust') {
      setMode('client-trust');
      return;
    }
    if (signIn.status === 'needs_second_factor') {
      setMode('second-factor');
      return;
    }
    if (signIn.status === 'needs_new_password') {
      setMode('new-password');
      setFormError('Geçici şifrenizi değiştirmeniz gerekiyor. Lütfen şifre yenileme adımını tamamlayın.');
      return;
    }
    setFormError('Giriş işlemi tamamlanamadı. Lütfen tekrar deneyin.');
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────
  async function handleGoogleSignIn() {
    if (!signIn) return;
    // Mark: we are expecting an OAuth return on this page
    sessionStorage.setItem(ADMIN_SSO_KEY, '1');

    const origin = window.location.origin;
    // Use the staff sign-in's SSO callback path — Clerk's <SignIn routing="path">
    // component there automatically handles the OAuth handshake.
    // v4 API: authenticateWithRedirect → sso(); redirectUrlComplete → redirectCallbackUrl
    const { error } = await signIn.sso({
      strategy:           'oauth_google',
      redirectUrl:         `${origin}${VITE_BASE}/sign-in/staff/sso-callback`,
      redirectCallbackUrl: `${origin}${VITE_BASE}/sign-in/admin`,
    });
    if (error) throw new Error(clerkMsg(error));
  }

  const ready = !!signIn;

  if ((mode === 'client-trust' || mode === 'second-factor') && signIn) {
    return (
      <SecondFactorVerification
        signIn={signIn}
        kind={mode === 'client-trust' ? 'client-trust' : 'second-factor'}
        onComplete={continueSignIn}
        onBack={() => { setMode('form'); setFormError(null); }}
      />
    );
  }

  if (mode === 'new-password') {
    navigate('/change-password');
    return null;
  }

  // ── Checking / spinner ────────────────────────────────────────────────────
  if (mode === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Yetki doğrulanıyor…</p>
        </div>
      </div>
    );
  }

  // ── Denied ────────────────────────────────────────────────────────────────
  if (mode === 'denied') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-10 pb-8 flex flex-col items-center gap-6 text-center">
            <div className="w-14 h-14 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#0B1F3A] mb-2">Erişim Reddedildi</h2>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                Bu giriş alanı yalnızca yetkili yönetici hesapları içindir.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 w-full max-w-xs">
              <Button
                className="w-full"
                onClick={() => { setMode('form'); setFormError(null); }}
              >
                Tekrar Dene
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => navigate('/sign-in/staff')}
              >
                Personel Girişine Geç
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Sign-in form ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 p-4 pb-safe">

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

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-2">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-[#F97316]/10 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-[#F97316]" />
            </div>
            <CardTitle className="text-xl">Yönetici Girişi</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Yönetici hesabınızla giriş yapın. Yetkisiz erişim girişimleri kayıt altına alınır.
          </p>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">

          {/* ── Google ── hidden; OAuth integration kept intact ── */}

          {/* ── Username / password form ── */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="adm-user">E-posta veya Kullanıcı Adı</Label>
              <Input
                id="adm-user"
                placeholder="ornek@email.com veya kullanici_adi"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adm-pw">Şifre</Label>
              <Input
                id="adm-pw"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>

            {formError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5">
                <p className="text-sm text-destructive">{formError}</p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-[#0B1F3A] hover:bg-[#162033]"
              disabled={loading || !ready || !username.trim() || !password}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Giriş yapılıyor…</>
              ) : 'Giriş Yap'}
            </Button>
          </form>

          {/* ── Forgot password ── */}
          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Şifremi Unuttum?
            </Link>
          </div>

          {/* ── Staff path hint ── */}
          <p className="text-xs text-center text-muted-foreground border-t pt-3">
            Personel misiniz?{' '}
            <Link href="/sign-in/staff" className="text-primary hover:underline font-medium">
              Personel Girişi
            </Link>
          </p>
        </CardContent>
      </Card>

      {/* Version */}
      <p className="text-[10px] font-mono text-muted-foreground/30" aria-label={`Sürüm ${APP_VERSION}`}>
        v{APP_VERSION}
      </p>
    </div>
  );
}

/**
 * Staff sign-in page (custom form).
 *
 * Supports:
 *   • E-posta veya kullanıcı adı + şifre  (Clerk password)
 *   • "Şifremi unuttum" → /forgot-password
 *
 * After sign-in the backend role is fetched via GET /api/profiles/me.
 * Admin/super_admin who land here are immediately signed out and shown the
 * unauthorized screen — they must use /sign-in/admin instead.
 * All other valid roles are redirected to / (HomeRedirect dispatches by role).
 *
 * NEVER trusts the sign-in path as proof of role — RBAC on the API is the
 * sole source of truth.
 */
import { useState, useEffect } from 'react';
import { useSignIn, useAuth, useClerk } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { APP_VERSION } from '@/lib/version';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, ChevronLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { API_BASE } from '@/lib/clerk-appearance';
import { SecondFactorVerification } from '@/components/auth/second-factor-verification';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clerkMsg(err: { message?: string; longMessage?: string } | null | undefined): string {
  return err?.longMessage ?? err?.message ?? 'Bilinmeyen hata';
}

// ── Component ─────────────────────────────────────────────────────────────────

type Mode = 'form' | 'checking' | 'denied' | 'client-trust' | 'second-factor' | 'new-password';

export default function SignInStaffPage() {
  const { signIn }                     = useSignIn();
  const { isLoaded, userId, getToken } = useAuth();
  const clerk                          = useClerk();
  const [, navigate]                   = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password,  setPassword]  = useState('');
  const [loading,   setLoading]   = useState(false);
  const [mode,      setMode]      = useState<Mode>('form');
  const [formError, setFormError] = useState<string | null>(null);

  // ── Redirect already-signed-in users who navigated here directly ──────────
  useEffect(() => {
    if (!isLoaded || !userId) return;
    if (mode !== 'form') return;          // currently checking/denied — don't touch
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
      // Race getToken() against a timeout so a slow Clerk network call can't
      // freeze the spinner indefinitely.
      const nullAfter = (ms: number) =>
        new Promise<null>(resolve => setTimeout(() => resolve(null), ms));

      let token = await Promise.race([getToken(), nullAfter(5_000)]);
      if (!token) {
        await new Promise<void>(r => setTimeout(r, 800));
        token = await Promise.race([getToken(), nullAfter(3_000)]);
      }

      if (!token) {
        setMode('form');
        setFormError('Oturum başlatılamadı. Lütfen tekrar giriş yapın.');
        return;
      }

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
        setMode('denied');
        return;
      }

      if (!res.ok) {
        setMode('form');
        setFormError(`Profil doğrulanamadı (HTTP ${res.status}). Lütfen tekrar deneyin.`);
        return;
      }

      const profile = await res.json();

      if (['admin', 'super_admin'].includes(profile?.role)) {
        // Admin who used the staff path — sign out, redirect to the right page
        await clerk.signOut().catch(() => {});
        setMode('denied');
      } else {
        // Valid staff role — HomeRedirect at / dispatches to correct workspace
        navigate('/');
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') {
        setMode('form');
        setFormError('Sunucu yanıt vermedi. Lütfen tekrar deneyin.');
        return;
      }
      setMode('form');
      setFormError('Kimlik doğrulama sırasında bir hata oluştu. Lütfen tekrar deneyin.');
    }
  }

  // ── Email / password sign-in ──────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    if (!identifier.trim() || !password) return;

    setLoading(true);
    setFormError(null);

    try {
      // create() with identifier + password completes the sign-in in one step.
      // The resource is mutated in-place; return value only carries { error }.
      // Do NOT call finalize() — it is for pending-next-factor flows (MFA) only.
      const { error: createErr } = await signIn.create({
        identifier: identifier.trim().toLowerCase(),
        password,
      });
      if (createErr) {
        setFormError(clerkMsg(createErr));
        return;
      }

      // Inspect the resource directly (mutated in-place by create()).
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
                Bu giriş alanı yalnızca personel hesapları içindir. Yönetici hesabınız varsa lütfen yönetici girişini kullanın.
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
                onClick={() => navigate('/sign-in/admin')}
              >
                Yönetici Girişine Geç
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
            <div className="w-9 h-9 rounded-xl bg-[#0d7377]/10 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5 text-[#0d7377]" />
            </div>
            <CardTitle className="text-xl">Personel Girişi</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            E-posta veya kullanıcı adınız ve şifreniz ile giriş yapın.
          </p>
        </CardHeader>

        <CardContent className="pt-4 space-y-4">

          {/* ── E-posta / şifre formu ── */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="staff-email">E-posta veya Kullanıcı Adı</Label>
              <Input
                id="staff-email"
                type="text"
                placeholder="ad@sirket.com veya kullanici_adi"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                disabled={loading}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-pw">Şifre</Label>
              <Input
                id="staff-pw"
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
              disabled={loading || !ready || !identifier.trim() || !password}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Giriş yapılıyor…</>
              ) : 'Giriş Yap'}
            </Button>
          </form>

          {/* ── Şifremi unuttum ── */}
          <div className="text-center">
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Şifremi Unuttum?
            </Link>
          </div>

          {/* ── Yönetici yönlendirmesi ── */}
          <p className="text-xs text-center text-muted-foreground border-t pt-3">
            Yönetici misiniz?{' '}
            <Link href="/sign-in/admin" className="text-primary hover:underline font-medium">
              Yönetici Girişi
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

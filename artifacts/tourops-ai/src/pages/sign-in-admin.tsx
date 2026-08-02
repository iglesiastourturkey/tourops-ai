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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Shield, ChevronLeft, AlertTriangle, Loader2 } from 'lucide-react';
import { API_BASE, VITE_BASE } from '@/lib/clerk-appearance';

// ── Helpers ───────────────────────────────────────────────────────────────────

function clerkMsg(err: { message?: string; longMessage?: string } | null | undefined): string {
  return err?.longMessage ?? err?.message ?? 'Bilinmeyen hata';
}

const ADMIN_SSO_KEY = 'tourpilot_admin_sso';

// ── Component ─────────────────────────────────────────────────────────────────

type Mode = 'form' | 'checking' | 'denied' | 'error';

export default function SignInAdminPage() {
  const { signIn }        = useSignIn();
  const { isLoaded, userId } = useAuth();
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
      const token = await clerk.session?.getToken();
      if (!token) throw new Error('no-token');

      const res = await fetch(`${API_BASE}/profiles/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('fetch-failed');

      const profile = await res.json();

      if (['admin', 'super_admin'].includes(profile?.role)) {
        navigate('/dashboard');
      } else {
        await clerk.signOut();
        isOAuthReturn.current = false;
        setMode('denied');
      }
    } catch {
      await clerk.signOut().catch(() => {});
      isOAuthReturn.current = false;
      setMode('error');
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
      const { error: createErr } = await signIn.create({
        identifier: username.trim().toLowerCase(),
        password,
      });
      if (createErr) {
        setFormError(clerkMsg(createErr));
        return;
      }

      const { error: finalErr } = await signIn.finalize();
      if (finalErr) {
        setFormError(clerkMsg(finalErr));
        return;
      }

      // Session established — useEffect on [mode, isLoaded, userId] will pick this up
      setMode('checking');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Giriş başarısız');
    } finally {
      setLoading(false);
    }
  }

  // ── Google OAuth ──────────────────────────────────────────────────────────
  async function handleGoogleSignIn() {
    if (!signIn) return;
    // Mark: we are expecting an OAuth return on this page
    sessionStorage.setItem(ADMIN_SSO_KEY, '1');

    const origin = window.location.origin;
    // Use the staff sign-in's SSO callback path — Clerk's <SignIn routing="path">
    // component there automatically handles the OAuth handshake.
    await signIn.authenticateWithRedirect({
      strategy: 'oauth_google',
      redirectUrl:         `${origin}${VITE_BASE}/sign-in/staff/sso-callback`,
      redirectUrlComplete: `${origin}${VITE_BASE}/sign-in/admin`,
    });
  }

  const ready = !!signIn;

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

          {/* ── Google ── */}
          <Button
            type="button"
            variant="outline"
            className="w-full flex items-center gap-2"
            onClick={handleGoogleSignIn}
            disabled={loading || !ready}
          >
            {/* Inline Google G SVG to avoid external fetch blocking */}
            <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Google ile Giriş Yap
          </Button>

          {/* ── Divider ── */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">veya kullanıcı adıyla</span>
            </div>
          </div>

          {/* ── Username / password form ── */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="adm-user">Kullanıcı Adı</Label>
              <Input
                id="adm-user"
                placeholder="kullanici_adi"
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
    </div>
  );
}

import { useState } from 'react';
import { useSignIn } from '@clerk/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, Loader2, ShieldCheck } from 'lucide-react';

// Derive the signIn resource type directly from the hook so it always matches
// the installed Clerk version without importing non-exported legacy types.
type FutureSignIn = ReturnType<typeof useSignIn>['signIn'];

type VerificationKind = 'client-trust' | 'second-factor';

// email_link has no equivalent in the v6 future API's mfa namespace.
type FactorStrategy = 'email_code' | 'phone_code' | 'totp' | 'backup_code';

type SecondFactor = { strategy: string };

interface SecondFactorVerificationProps {
  signIn: FutureSignIn;
  kind: VerificationKind;
  onComplete: () => Promise<void>;
  onBack: () => void;
}

function clerkMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as { longMessage?: string; message?: string };
    return candidate.longMessage ?? candidate.message ?? fallback;
  }
  return fallback;
}

function pickFactor(factors: readonly SecondFactor[] | null | undefined): FactorStrategy | null {
  const strategies = new Set(factors?.map(f => f.strategy));
  // Priority: email_code → phone_code → totp → backup_code
  if (strategies.has('email_code')) return 'email_code';
  if (strategies.has('phone_code')) return 'phone_code';
  if (strategies.has('totp')) return 'totp';
  if (strategies.has('backup_code')) return 'backup_code';
  return null;
}

export function SecondFactorVerification({
  signIn,
  kind,
  onComplete,
  onBack,
}: SecondFactorVerificationProps) {
  const [strategy, setStrategy] = useState<FactorStrategy | null>(() =>
    pickFactor(signIn.supportedSecondFactors),
  );
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isClientTrust = kind === 'client-trust';
  const canUseCode = strategy === 'email_code' || strategy === 'phone_code';
  const isManualCode = canUseCode || strategy === 'totp' || strategy === 'backup_code';

  // ── Send / resend a one-time code ─────────────────────────────────────────
  async function prepareCode(resend = false) {
    if (!canUseCode || !strategy) return;
    setLoading(true);
    setError(null);

    try {
      // v6 future API: mfa.sendEmailCode() / mfa.sendPhoneCode()
      // Methods return { error } rather than throwing.
      const { error: sendErr } =
        strategy === 'email_code'
          ? await signIn.mfa.sendEmailCode()
          : await signIn.mfa.sendPhoneCode();

      if (sendErr) {
        setError(clerkMessage(sendErr, 'Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.'));
        return;
      }

      setSent(true);
      if (resend) setError(null);
    } catch (err) {
      setError(clerkMessage(err, 'Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.'));
    } finally {
      setLoading(false);
    }
  }

  // ── Verify the submitted code ─────────────────────────────────────────────
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!strategy || !isManualCode || !code.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // v6 future API: strategy-specific verify methods under mfa.*
      // Each returns { error }; the resource is mutated in-place on success.
      let verifyErr: unknown | null = null;
      const trimmed = code.trim();

      if (strategy === 'email_code') {
        ({ error: verifyErr } = await signIn.mfa.verifyEmailCode({ code: trimmed }));
      } else if (strategy === 'phone_code') {
        ({ error: verifyErr } = await signIn.mfa.verifyPhoneCode({ code: trimmed }));
      } else if (strategy === 'totp') {
        ({ error: verifyErr } = await signIn.mfa.verifyTOTP({ code: trimmed }));
      } else if (strategy === 'backup_code') {
        ({ error: verifyErr } = await signIn.mfa.verifyBackupCode({ code: trimmed }));
      }

      if (verifyErr) {
        setError(clerkMessage(verifyErr, 'Doğrulama kodu geçersiz veya süresi dolmuş.'));
        return;
      }

      // Resource is mutated in-place — check status directly.
      if (signIn.status === 'complete' && signIn.createdSessionId) {
        await onComplete();
        return;
      }

      if (signIn.status === 'needs_client_trust' || signIn.status === 'needs_second_factor') {
        setError('Doğrulama kodu geçersiz veya süresi dolmuş.');
        return;
      }

      setError('Oturum doğrulaması sona erdi. Lütfen tekrar giriş yapın.');
    } catch (err) {
      setError(clerkMessage(err, 'Doğrulama kodu geçersiz veya süresi dolmuş.'));
    } finally {
      setLoading(false);
    }
  }

  const title = isClientTrust ? 'Yeni Cihaz Doğrulaması' : 'Güvenlik Doğrulaması';
  const description = isClientTrust
    ? 'Güvenliğiniz için bu cihazı doğrulamamız gerekiyor. Hesabınıza kayıtlı iletişim adresine gönderilen doğrulama kodunu girin.'
    : 'Girişinizi tamamlamak için hesabınızda tanımlı güvenlik doğrulamasını tamamlayın.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F97316]/10 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-[#F97316]" />
            </div>
            <CardTitle className="text-xl">{title}</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!strategy && (
            <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5">
              <p className="text-sm text-destructive">
                Bu hesap için kullanılabilir bir doğrulama yöntemi bulunamadı. Lütfen yöneticinizle iletişime geçin.
              </p>
            </div>
          )}

          {canUseCode && (
            <>
              {!sent ? (
                <Button className="w-full" onClick={() => prepareCode()} disabled={loading}>
                  {loading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Kod gönderiliyor…</>
                    : 'Doğrulama Kodu Gönder'}
                </Button>
              ) : (
                <form onSubmit={verify} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="verification-code">Doğrulama Kodu</Label>
                    <Input
                      id="verification-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={event => setCode(event.target.value)}
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
                    {loading
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Doğrulanıyor…</>
                      : 'Doğrula'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => prepareCode(true)}
                    disabled={loading}
                  >
                    Kodu Yeniden Gönder
                  </Button>
                </form>
              )}
            </>
          )}

          {(strategy === 'totp' || strategy === 'backup_code') && (
            <form onSubmit={verify} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="verification-code">
                  {strategy === 'totp' ? 'Doğrulama Kodu' : 'Yedek Kod'}
                </Label>
                <Input
                  id="verification-code"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={event => setCode(event.target.value)}
                  disabled={loading}
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !code.trim()}>
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Doğrulanıyor…</>
                  : 'Doğrula'}
              </Button>
            </form>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onBack}
            disabled={loading}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />Geri
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import type { SignInResource } from '@clerk/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, Loader2, ShieldCheck } from 'lucide-react';

type VerificationKind = 'client-trust' | 'second-factor';

type FactorStrategy =
  | 'email_code'
  | 'phone_code'
  | 'email_link'
  | 'totp'
  | 'backup_code';

type SecondFactor = { strategy: FactorStrategy };

interface SecondFactorVerificationProps {
  signIn: Pick<SignInResource, 'status' | 'createdSessionId' | 'supportedSecondFactors' | 'prepareSecondFactor' | 'attemptSecondFactor'>;
  kind: VerificationKind;
  onComplete: () => Promise<void>;
  onBack: () => void;
}

function clerkMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const candidate = error as { longMessage?: string; message?: string };
    return candidate.longMessage ?? candidate.message ?? fallback;
  }
  return fallback;
}

function pickFactor(factors: readonly SecondFactor[] | null | undefined): FactorStrategy | null {
  const strategies = new Set(factors?.map(factor => factor.strategy));
  if (strategies.has('email_code')) return 'email_code';
  if (strategies.has('phone_code')) return 'phone_code';
  if (strategies.has('email_link')) return 'email_link';
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

  async function prepareCode(resend = false) {
    if (!signIn || !canUseCode || !strategy) return;
    setLoading(true);
    setError(null);

    try {
      const result = await signIn.prepareSecondFactor({ strategy });
      if (result.status !== 'needs_client_trust' && result.status !== 'needs_second_factor') {
        setError('Oturum doğrulaması sona erdi. Lütfen tekrar giriş yapın.');
        return;
      }
      setSent(true);
      if (resend) {
        setError(null);
      }
    } catch (err) {
      setError(clerkMessage(err, 'Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.'));
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!strategy || !isManualCode || !code.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const result = await signIn.attemptSecondFactor({ strategy, code: code.trim() });
      if (result.status === 'complete' && result.createdSessionId) {
        await onComplete();
        return;
      }

      if (result.status === 'needs_client_trust' || result.status === 'needs_second_factor') {
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

  async function startEmailLink() {
    if (!strategy || strategy !== 'email_link') return;
    setLoading(true);
    setError(null);
    try {
      const result = await signIn.prepareSecondFactor({ strategy: 'email_link' });
      if (result.status !== 'needs_client_trust' && result.status !== 'needs_second_factor') {
        setError('Oturum doğrulaması sona erdi. Lütfen tekrar giriş yapın.');
        return;
      }
      setSent(true);
    } catch (err) {
      setError(clerkMessage(err, 'Doğrulama bağlantısı gönderilemedi. Lütfen tekrar deneyin.'));
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
                  {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Kod gönderiliyor…</> : 'Doğrulama Kodu Gönder'}
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
                    {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Doğrulanıyor…</> : 'Doğrula'}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => prepareCode(true)} disabled={loading}>
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
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Doğrulanıyor…</> : 'Doğrula'}
              </Button>
            </form>
          )}

          {strategy === 'email_link' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Hesabınıza kayıtlı e-posta adresine gönderilecek güvenli bağlantıyı kullanın.
              </p>
              <Button className="w-full" onClick={startEmailLink} disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Bağlantı gönderiliyor…</> : sent ? 'Bağlantıyı Yeniden Gönder' : 'Doğrulama Bağlantısı Gönder'}
              </Button>
              {sent && <p className="text-xs text-muted-foreground text-center">Bağlantıyı e-posta kutunuzda açtıktan sonra bu sayfaya geri dönün.</p>}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <Button type="button" variant="ghost" className="w-full" onClick={onBack} disabled={loading}>
            <ChevronLeft className="w-4 h-4 mr-1" />Geri
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
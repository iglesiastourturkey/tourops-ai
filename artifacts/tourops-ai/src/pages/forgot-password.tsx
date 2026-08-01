import { useState } from 'react';
import { useSignIn } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

/**
 * Clerk's "future" API returns { error: ClerkError | null } instead of throwing.
 * This helper extracts a human-readable message from a ClerkError.
 */
function clerkErrMsg(err: { message?: string; longMessage?: string } | null | undefined): string {
  return err?.longMessage ?? err?.message ?? 'Bilinmeyen hata';
}

type Step = 'email' | 'code' | 'password' | 'done';

export default function ForgotPasswordPage() {
  // Clerk v4 future API: returns { signIn, errors, fetchStatus }
  // signIn is null until the Clerk JS bundle loads
  const { signIn } = useSignIn();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Step 1: Identify the user and send reset code ──────────────────────
  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    if (!email.trim() || !email.includes('@')) {
      toast({ title: 'Hata', description: 'Geçerli bir e-posta adresi giriniz', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      // Identify the user by email (initialises the sign-in attempt)
      const { error: createErr } = await signIn.create({ identifier: email.trim() });
      if (createErr) {
        toast({ title: 'Hata', description: clerkErrMsg(createErr), variant: 'destructive' });
        return;
      }
      // Send the password-reset code to the email address
      const { error: sendErr } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendErr) {
        toast({ title: 'Hata', description: clerkErrMsg(sendErr), variant: 'destructive' });
        return;
      }
      setStep('code');
    } catch (err) {
      toast({ title: 'Hata', description: err instanceof Error ? err.message : 'Bilinmeyen hata', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Verify the code ────────────────────────────────────────────
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    if (!code.trim()) {
      toast({ title: 'Hata', description: 'Doğrulama kodunu giriniz', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (error) {
        toast({ title: 'Geçersiz kod', description: clerkErrMsg(error), variant: 'destructive' });
        return;
      }
      setStep('password');
    } catch (err) {
      toast({ title: 'Hata', description: err instanceof Error ? err.message : 'Bilinmeyen hata', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  // ── Step 3: Submit new password ────────────────────────────────────────
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!signIn) return;
    if (password.length < 8) {
      toast({ title: 'Hata', description: 'Şifre en az 8 karakter olmalıdır', variant: 'destructive' });
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: 'Hata', description: 'Şifreler eşleşmiyor', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error: submitErr } = await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true,
      });
      if (submitErr) {
        toast({ title: 'Hata', description: clerkErrMsg(submitErr), variant: 'destructive' });
        return;
      }
      // Finalise — creates the session and signs the user in
      const { error: finalErr } = await signIn.finalize();
      if (finalErr) {
        // Finalize failing just means we can't auto-sign-in; password was still changed.
        // Redirect to sign-in page.
      }
      setStep('done');
    } catch (err) {
      toast({ title: 'Hata', description: err instanceof Error ? err.message : 'Bilinmeyen hata', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  const ready = !!signIn;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-xl">Şifremi Unuttum</CardTitle>
          <p className="text-sm text-muted-foreground">
            {step === 'email' && 'Kayıtlı e-posta adresinize doğrulama kodu göndereceğiz.'}
            {step === 'code' && `${email} adresine gönderilen kodu giriniz.`}
            {step === 'password' && 'Yeni şifrenizi belirleyiniz.'}
            {step === 'done' && 'Şifreniz başarıyla güncellendi.'}
          </p>
        </CardHeader>

        <CardContent className="pt-4">
          {/* ── Step 1: Email ── */}
          {step === 'email' && (
            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-email">E-posta Adresi</Label>
                <Input
                  id="fp-email"
                  type="email"
                  placeholder="ornek@sirket.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={loading}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !ready}>
                {loading ? 'Gönderiliyor…' : 'Doğrulama Kodu Gönder'}
              </Button>
              <div className="text-center">
                <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />
                  Giriş sayfasına dön
                </Link>
              </div>
            </form>
          )}

          {/* ── Step 2: Verification code ── */}
          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-code">Doğrulama Kodu</Label>
                <Input
                  id="fp-code"
                  placeholder="6 haneli kod"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={loading}
                  maxLength={6}
                  autoFocus
                  inputMode="numeric"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading || code.length < 6}>
                {loading ? 'Doğrulanıyor…' : 'Kodu Doğrula'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full text-sm"
                onClick={() => { setStep('email'); setCode(''); }}
                disabled={loading}
              >
                E-postayı değiştir veya kodu yeniden gönder
              </Button>
            </form>
          )}

          {/* ── Step 3: New password ── */}
          {step === 'password' && (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-pw">Yeni Şifre</Label>
                <Input
                  id="fp-pw"
                  type="password"
                  placeholder="En az 8 karakter"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-pw2">Yeni Şifre (Tekrar)</Label>
                <Input
                  id="fp-pw2"
                  type="password"
                  placeholder="Şifreyi tekrarlayınız"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </div>
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-xs text-destructive">Şifreler eşleşmiyor</p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={loading || password.length < 8 || password !== confirmPassword}
              >
                {loading ? 'Kaydediliyor…' : 'Şifremi Güncelle'}
              </Button>
            </form>
          )}

          {/* ── Step 4: Done ── */}
          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="text-sm text-center text-muted-foreground">
                Şifreniz güncellendi. Artık yeni şifrenizle giriş yapabilirsiniz.
              </p>
              <Button className="w-full" onClick={() => navigate('/sign-in')}>
                Giriş Sayfasına Git
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

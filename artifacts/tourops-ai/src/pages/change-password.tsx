/**
 * Mandatory password change page.
 *
 * Shown when a user signs in with a temporary password (mustChangePassword=true).
 * The app blocks all navigation until this form is successfully submitted.
 *
 * Flow:
 *   1. Admin generates a temp password (POST /api/users/:id/temp-password)
 *   2. User signs in with the temp password
 *   3. ProfileContext sees mustChangePassword=true  → redirect here
 *   4. User submits a new password → Clerk updates the credential
 *   5. POST /api/profiles/me/clear-password-change clears the Clerk publicMetadata flag
 *   6. ProfileContext refetches → mustChangePassword=false → role dashboard
 */
import { useState } from 'react';
import { useUser, useClerk } from '@clerk/react';
import { useLocation } from 'wouter';
import { KeyRound, Loader2, LogOut, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useProfile } from '@/contexts/ProfileContext';
import { customFetch } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/clerk-appearance';

export default function ChangePasswordPage() {
  const { user }           = useUser();
  const clerk              = useClerk();
  const { role, refetchProfile } = useProfile();
  const [, navigate]       = useLocation();
  const { toast }          = useToast();

  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [showCur,    setShowCur]    = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPw !== confirmPw) {
      setError('Yeni şifreler eşleşmiyor.');
      return;
    }
    if (newPw.length < 8) {
      setError('Yeni şifre en az 8 karakter olmalıdır.');
      return;
    }
    if (newPw === currentPw) {
      setError('Yeni şifre geçici şifreden farklı olmalıdır.');
      return;
    }

    setLoading(true);
    try {
      // 1. Update password in Clerk (handles hashing — plaintext never stored)
      await user!.updatePassword({
        currentPassword: currentPw,
        newPassword:     newPw,
        signOutOfOtherSessions: false,
      });

      // 2. Clear the forced-change flag via our API. The server verifies that
      // Clerk no longer accepts the original temporary credential; it never
      // trusts the submitted "new password" value as proof of a change.
      await customFetch(`${API_BASE}/profiles/me/clear-password-change`, {
        method: 'POST',
        headers: { 'x-tourpilot-force-change-proof': currentPw },
        cache: 'no-store',
      });

      // 3. Invalidate ProfileContext cache so mustChangePassword becomes false
      await refetchProfile();

      toast({ title: 'Şifreniz güncellendi', description: 'Hesabınıza yönlendiriliyorsunuz.' });

      // 4. Navigate to the correct role dashboard
      if (role === 'guide')            navigate('/guide');
      else if (role === 'field_operations') navigate('/field');
      else                              navigate('/dashboard');

    } catch (err: unknown) {
      const clerkErrors = (err as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors;
      const msg =
        clerkErrors?.[0]?.longMessage ??
        clerkErrors?.[0]?.message ??
        (err instanceof Error ? err.message : 'Şifre değiştirilemedi. Mevcut şifrenizi kontrol edin.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = !!currentPw && !!newPw && !!confirmPw && !loading;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F7F9FC] p-4 gap-4">

      {/* Security notice banner */}
      <div className="w-full max-w-md flex items-start gap-2.5 rounded-xl border border-[#F97316]/25 bg-[#F97316]/8 px-4 py-3">
        <ShieldCheck className="w-4 h-4 text-[#F97316] shrink-0 mt-0.5" />
        <p className="text-xs text-[#0B1F3A]/80 leading-relaxed">
          Güvenliğiniz için geçici şifrenizi yeni bir şifre ile değiştirmeniz gerekmektedir.
          Bu adımı tamamlamadan uygulamaya erişemezsiniz.
        </p>
      </div>

      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-1 pb-2">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-[#F97316]/10 flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5 text-[#F97316]" />
            </div>
            <CardTitle className="text-xl">Şifrenizi Değiştirin</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            Size verilen geçici şifreyi kullanarak yeni kalıcı şifrenizi belirleyin.
          </p>
        </CardHeader>

        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Current (temp) password */}
            <div className="space-y-1.5">
              <Label htmlFor="cur-pw">Mevcut Şifre (Geçici)</Label>
              <div className="relative">
                <Input
                  id="cur-pw"
                  type={showCur ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCur(v => !v)}
                  tabIndex={-1}
                  aria-label={showCur ? 'Şifreyi gizle' : 'Şifreyi göster'}
                >
                  {showCur ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">Yeni Şifre</Label>
              <div className="relative">
                <Input
                  id="new-pw"
                  type={showNew ? 'text' : 'password'}
                  placeholder="En az 8 karakter"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={8}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowNew(v => !v)}
                  tabIndex={-1}
                  aria-label={showNew ? 'Şifreyi gizle' : 'Şifreyi göster'}
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm new password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Yeni Şifre Tekrar</Label>
              <Input
                id="confirm-pw"
                type="password"
                placeholder="••••••••"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                disabled={loading}
                autoComplete="new-password"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2.5">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Submit */}
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {loading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Güncelleniyor…</>
                : 'Şifreyi Güncelle'}
            </Button>
          </form>

          {/* Sign out */}
          <div className="mt-4 text-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground text-xs"
              onClick={() => clerk.signOut().catch(() => {})}
            >
              <LogOut className="w-3.5 h-3.5 mr-1.5" />
              Çıkış Yap
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

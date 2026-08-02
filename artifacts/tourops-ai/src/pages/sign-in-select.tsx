/**
 * TourPilot sign-in selection screen.
 *
 * Presents two clear paths:
 *   • Personel Girişi  → /sign-in/staff  (email, Google)
 *   • Yönetici Girişi  → /sign-in/admin  (username, Google — admin/super_admin only)
 *
 * This page is purely cosmetic. It never assigns or changes a user role.
 */
import { Link } from 'wouter';
import { Users, Shield, ArrowRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';

const base    = import.meta.env.BASE_URL ?? '/';
const LOGO    = base.endsWith('/') ? `${base}logo.svg` : `${base}/logo.svg`;

export default function SignInSelectPage() {
  return (
    <div className="min-h-screen bg-[#F7F9FC] flex flex-col">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-200/70 px-6 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-2.5">
          <img src={LOGO} alt="TourPilot" className="w-8 h-8 shrink-0" />
          <span className="font-bold text-lg leading-none tracking-tight text-[#0B1F3A]">
            Tour<span className="text-[#F97316]">Pilot</span>
          </span>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg">

          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-[#0B1F3A] mb-2">
              TourPilot'a Hoş Geldiniz
            </h1>
            <p className="text-[#162033]/55 text-sm">
              Giriş yapmak istediğiniz hesap türünü seçin.
            </p>
          </div>

          {/* ── Selection cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

            {/* Personel */}
            <Link href="/sign-in/staff">
              <div className="group relative bg-white rounded-2xl border-2 border-gray-100 hover:border-[#0d7377] p-7 cursor-pointer transition-all shadow-sm hover:shadow-lg flex flex-col gap-5 h-full">
                <div className="w-12 h-12 rounded-xl bg-[#0d7377]/10 flex items-center justify-center text-[#0d7377] shrink-0">
                  <Users className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-[#0B1F3A] mb-1.5 group-hover:text-[#0d7377] transition-colors">
                    Personel Girişi
                  </h2>
                  <p className="text-xs text-[#162033]/55 leading-relaxed">
                    Operasyon, muhasebe, rehber ve saha personeliniz için giriş.
                  </p>
                </div>
                <div className="flex items-center gap-1 text-xs text-[#0d7377] font-medium">
                  E-posta veya Google
                  <ArrowRight className="w-3.5 h-3.5 ml-0.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>

            {/* Yönetici */}
            <Link href="/sign-in/admin">
              <div className="group relative bg-white rounded-2xl border-2 border-gray-100 hover:border-[#F97316] p-7 cursor-pointer transition-all shadow-sm hover:shadow-lg flex flex-col gap-5 h-full">
                <div className="w-12 h-12 rounded-xl bg-[#F97316]/10 flex items-center justify-center text-[#F97316] shrink-0">
                  <Shield className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-[#0B1F3A] mb-1.5 group-hover:text-[#F97316] transition-colors">
                    Yönetici Girişi
                  </h2>
                  <p className="text-xs text-[#162033]/55 leading-relaxed">
                    Yönetici ve süper yönetici hesapları için güvenli giriş.
                  </p>
                </div>
                <div className="flex items-center gap-1 text-xs text-[#F97316] font-medium">
                  Kullanıcı adı veya Google
                  <ArrowRight className="w-3.5 h-3.5 ml-0.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>
          </div>

          {/* Back to home */}
          <div className="mt-10 flex justify-center">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5 text-sm">
                <ChevronLeft className="w-4 h-4" />
                Ana Sayfaya Dön
              </Button>
            </Link>
          </div>

          {/* Version */}
          <p className="mt-6 text-center text-[10px] font-mono text-[#162033]/25" aria-label={`Sürüm ${APP_VERSION}`}>
            v{APP_VERSION}
          </p>
        </div>
      </main>
    </div>
  );
}

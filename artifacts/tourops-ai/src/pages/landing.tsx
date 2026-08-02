import { useState, lazy, Suspense } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { Button } from '@/components/ui/button';
import {
  Menu, X, CheckCircle2, Shield, Users, FileText,
  BarChart3, MapPin, Zap, Clock, ChevronRight, Lock,
  Smartphone, Star, ArrowRight,
} from 'lucide-react';
import { APP_VERSION } from '@/lib/version';

const ProductWalkthroughLazy = lazy(() =>
  import('@/components/ProductWalkthrough').then(m => ({ default: m.ProductWalkthrough }))
);

const BASE = import.meta.env.BASE_URL ?? '/';
const LOGO_SRC = BASE.endsWith('/') ? `${BASE}logo.svg` : `${BASE}/logo.svg`;

// ── Inline horizontal logo ────────────────────────────────────────────────────
function TourPilotLogo({ dark = false, className = '' }: { dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src={LOGO_SRC} alt="" aria-hidden="true" className="w-8 h-8 shrink-0" />
      <span className={`font-bold text-lg leading-none tracking-tight ${dark ? 'text-white' : 'text-[#0B1F3A]'}`}>
        Tour<span className="text-[#F97316]">Pilot</span>
      </span>
    </span>
  );
}

// ── Data ──────────────────────────────────────────────────────────────────────
const NAV_LINKS = [
  { href: '#ozellikler', label: 'Özellikler' },
  { href: '#nasil-calisir', label: 'Nasıl Çalışır?' },
  { href: '#guvenlik', label: 'Güvenlik' },
];

const VALUE_CARDS = [
  {
    icon: MapPin,
    title: 'Operasyon Kontrolü',
    desc: 'Turlar, görevler, rehberler ve saha süreçleri tek akışta.',
    color: 'bg-blue-50 text-blue-600',
  },
  {
    icon: FileText,
    title: 'Belge ve Makbuz Yönetimi',
    desc: 'Mobil belge yükleme, OCR destekli veri çıkarma ve muhasebe inceleme akışı.',
    color: 'bg-orange-50 text-[#F97316]',
  },
  {
    icon: BarChart3,
    title: 'Finansal Görünürlük',
    desc: 'Gelir, gider, alacak, borç ve operasyon kârlılığını takip edin.',
    color: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: Users,
    title: 'Rol Bazlı Çalışma',
    desc: 'Yönetici, operasyon, muhasebe ve rehber ekipleri yalnızca ihtiyaç duydukları alanları görür.',
    color: 'bg-purple-50 text-purple-600',
  },
];


const KEY_MODULES = [
  { label: 'Rol Bazlı Kontrol Paneli', available: true },
  { label: 'Müşteri ve Tedarikçi Yönetimi', available: true },
  { label: 'Tur ve Teklif Yönetimi', available: true },
  { label: 'Operasyon ve Görev Takibi', available: true },
  { label: 'Rehber / Şoför Atama', available: true },
  { label: 'Mobil Makbuz Yükleme', available: true },
  { label: 'OCR Destekli Belge Okuma', available: true },
  { label: 'Muhasebe Belge İnceleme Merkezi', available: true },
  { label: 'PDF, Excel ve ZIP Dışa Aktarma', available: true },
  { label: 'AI Muhasebe Özeti', available: true },
];

const ROLES = [
  {
    role: 'Yönetici',
    desc: 'Tüm modüllere erişim, kullanıcı yönetimi, raporlar ve sistem ayarları.',
    color: 'border-[#F97316]',
  },
  {
    role: 'Operasyon',
    desc: 'Müşteri, teklif, tur ve operasyon akışlarını uçtan uca yönetir.',
    color: 'border-blue-400',
  },
  {
    role: 'Muhasebe',
    desc: 'Finansal işlemler, belgeler, raporlar ve AI muhasebe özetlerine erişir.',
    color: 'border-emerald-400',
  },
  {
    role: 'Rehber',
    desc: 'Yalnızca atandığı operasyonları ve turları görür; saha makbuzu yükleyebilir.',
    color: 'border-purple-400',
  },
];

const SECURITY_ITEMS = [
  { icon: Lock, label: 'Güvenli Kimlik Doğrulama', desc: 'Clerk altyapısıyla çok faktörlü kimlik doğrulama ve oturum yönetimi.' },
  { icon: Shield, label: 'Rol Tabanlı Erişim', desc: 'Her kullanıcı yalnızca kendi rolüne tanımlı sayfa ve verilere erişebilir.' },
  { icon: Zap, label: 'Korumalı API Erişimi', desc: 'Tüm API istekleri kimlik doğrulaması ve rol kontrolüyle güvence altındadır.' },
  { icon: FileText, label: 'Özel Belge Depolama', desc: 'Yüklenen belgeler yetkisiz erişime karşı korumalı nesne depolamada saklanır.' },
  { icon: CheckCircle2, label: 'Denetim Uyumlu İnceleme', desc: 'Belgeler onay, ret ve eksik bilgi durumlarıyla izlenebilir tutulur.' },
  { icon: Users, label: 'AI Güvenlik Sınırı', desc: 'AI yalnızca analiz ve öneri sunar; hiçbir zaman otomatik onay veya işlem yapmaz.' },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { isLoaded, userId } = useAuth();
  const isSignedIn = isLoaded && !!userId;
  const [menuOpen, setMenuOpen] = useState(false);

  const dashHref = `${BASE.endsWith('/') ? BASE : BASE + '/'}dashboard`;

  return (
    <div className="min-h-screen bg-[#F7F9FC] text-[#162033] overflow-x-hidden scroll-smooth">

      {/* ── A. Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-200/60 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <TourPilotLogo />

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6" aria-label="Ana navigasyon">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="text-sm font-medium text-[#162033]/70 hover:text-[#0B1F3A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] rounded"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            {isSignedIn ? (
              <a href={dashHref}>
                <Button className="bg-[#0B1F3A] hover:bg-[#162033] text-white text-sm font-semibold">
                  Kontrol Paneline Git
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </a>
            ) : (
              <Link href="/sign-in">
                <Button className="bg-[#0B1F3A] hover:bg-[#162033] text-white text-sm font-semibold">
                  Giriş Yap
                </Button>
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-lg text-[#162033]/70 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
            onClick={() => setMenuOpen(v => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-gray-200/60 bg-white px-4 py-4 space-y-2">
            {NAV_LINKS.map(({ href, label }) => (
              <a
                key={href}
                href={href}
                className="block py-2.5 text-sm font-medium text-[#162033]/80 hover:text-[#0B1F3A]"
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </a>
            ))}
            <div className="pt-2 border-t border-gray-100">
              {isSignedIn ? (
                <a href={dashHref} className="block">
                  <Button className="w-full bg-[#0B1F3A] hover:bg-[#162033] text-white">
                    Kontrol Paneline Git
                  </Button>
                </a>
              ) : (
                <Link href="/sign-in" onClick={() => setMenuOpen(false)}>
                  <Button className="w-full bg-[#0B1F3A] hover:bg-[#162033] text-white">
                    Giriş Yap
                  </Button>
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ── B. Hero ────────────────────────────────────────────────────────── */}
      <section
        id="hero"
        className="relative bg-[#0B1F3A] text-white overflow-hidden"
        aria-label="Ana bölüm"
      >
        {/* Subtle background texture */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #F97316 0%, transparent 60%), radial-gradient(circle at 80% 20%, #fff 0%, transparent 50%)' }}
          aria-hidden="true"
        />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-20 lg:py-28 flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
          {/* Left: copy */}
          <div className="flex-1 text-center lg:text-left max-w-xl">
            <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs sm:text-sm px-4 py-1.5 rounded-full mb-8 border border-white/15">
              <Zap className="w-3.5 h-3.5 text-[#F97316]" />
              Yapay Zekâ Destekli Turizm Operasyon Platformu
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-6">
              Tur operasyonlarınızı{' '}
              <span className="text-[#F97316]">tek merkezden</span>{' '}
              yönetin.
            </h1>
            <p className="text-white/65 text-base sm:text-lg leading-relaxed mb-10">
              TourPilot; müşteri, teklif, tur, operasyon, saha belgeleri ve finansal
              süreçleri modern ve yapay zekâ destekli bir platformda bir araya getirir.
            </p>
            <div className="flex flex-col sm:flex-row items-center lg:items-start gap-4 justify-center lg:justify-start">
              <Link href="/sign-in">
                <Button
                  size="lg"
                  className="bg-[#F97316] hover:bg-[#ea6c0a] text-white font-semibold px-8 gap-2 h-11 motion-safe:transition-transform motion-safe:hover:scale-[1.02]"
                  data-testid="cta-sign-in"
                >
                  Giriş Yap <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
              <a href="#ozellikler">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/25 text-white hover:bg-white/10 font-semibold px-8 h-11"
                >
                  Özellikleri İncele
                </Button>
              </a>
            </div>
          </div>

          {/* Right: product preview mockup */}
          <div className="relative w-full lg:w-auto lg:flex-shrink-0 lg:w-[460px] xl:w-[500px]" aria-hidden="true">
            {/* Floating glow — brightened for more visual depth */}
            <div className="absolute -inset-8 rounded-3xl opacity-[0.35] blur-3xl pointer-events-none"
              style={{ background: 'radial-gradient(ellipse at 50% 60%, #F97316 0%, #0d7377 50%, transparent 75%)' }} />
            <div className="relative rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              {/* Browser chrome */}
              <div className="bg-[#111f35] px-4 py-2.5 flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                  <span className="w-2.5 h-2.5 rounded-full bg-white/15" />
                </div>
                <div className="flex-1 rounded bg-white/10 px-3 py-0.5 text-white/40 text-[11px] truncate">
                  tourpilot.com.tr/dashboard
                </div>
              </div>
              {/* Dashboard UI */}
              <div className="bg-white p-4 space-y-3">
                {/* Header strip */}
                <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                  <span className="text-xs font-semibold text-[#0B1F3A]">Muhasebe Paneli</span>
                  <span className="text-[10px] text-gray-400">Ağustos 2026</span>
                </div>
                {/* KPI row */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Bu Ay Gelir', val: '₺42.580', bg: 'bg-emerald-50 border-emerald-100', txt: 'text-emerald-700' },
                    { label: 'Bu Ay Gider', val: '₺16.320', bg: 'bg-red-50 border-red-100', txt: 'text-red-700' },
                    { label: 'İnceleme', val: '4 Belge', bg: 'bg-amber-50 border-amber-100', txt: 'text-amber-700' },
                  ].map((k, i) => (
                    <div key={i} className={`rounded-lg p-2 border ${k.bg}`}>
                      <p className="text-[9px] font-medium opacity-60 mb-0.5">{k.label}</p>
                      <p className={`text-xs font-bold ${k.txt}`}>{k.val}</p>
                    </div>
                  ))}
                </div>
                {/* Chart bars */}
                <div className="bg-[#F7F9FC] rounded-lg p-3 border border-gray-100">
                  <p className="text-[9px] text-gray-400 font-medium mb-2">Aylık Gelir / Gider (TRY)</p>
                  <div className="flex items-end gap-1 h-14">
                    {[[55,30],[68,38],[60,32],[80,40],[72,36],[90,42]].map(([g,e],i) => (
                      <div key={i} className="flex-1 flex items-end gap-0.5">
                        <div style={{height:`${g}%`}} className="flex-1 bg-[#0d7377] rounded-t-sm" />
                        <div style={{height:`${e}%`}} className="flex-1 bg-[#0B1F3A] rounded-t-sm opacity-70" />
                      </div>
                    ))}
                  </div>
                </div>
                {/* Operations list */}
                <div className="space-y-1">
                  {[
                    'Efes Turu — 12 Ağu',
                    'Pamukkale Transferi — 14 Ağu',
                    'Kuşadası Şehir Turu — 15 Ağu',
                  ].map((op, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 bg-[#F7F9FC] rounded-lg border border-gray-100">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-[10px] text-gray-700 flex-1 font-medium">{op}</span>
                      <span className="text-[9px] text-gray-400">Aktif</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── C. Value cards ─────────────────────────────────────────────────── */}
      <section id="ozellikler" className="py-20 px-4 bg-white" aria-label="Özellikler">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] mb-3">
              Operasyondan muhasebeye her şey bir arada
            </h2>
            <p className="text-[#162033]/60 max-w-xl mx-auto">
              TourPilot, seyahat acentelerinin günlük iş akışlarını tek platformda toplar.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {VALUE_CARDS.map(({ icon: Icon, title, desc, color }) => (
              <div
                key={title}
                className="rounded-xl border border-gray-100 p-6 hover:shadow-md motion-safe:transition-shadow"
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-[#0B1F3A] mb-2">{title}</h3>
                <p className="text-sm text-[#162033]/60 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── D. Interactive product walkthrough ─────────────────────────────── */}
      <section id="nasil-calisir" className="py-20 px-4 bg-[#F7F9FC]" aria-label="Nasıl Çalışır?">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] mb-3">
              TourPilot Nasıl Çalışır?
            </h2>
            <p className="text-[#162033]/60 max-w-xl mx-auto">
              Müşteri talebinden muhasebe kapanışına kadar 8 adımlık iş akışını interaktif olarak keşfedin.
            </p>
          </div>
          <Suspense fallback={
            <div className="flex items-center justify-center h-64 rounded-2xl border border-gray-100 bg-white">
              <div className="flex flex-col items-center gap-3 text-gray-400">
                <div className="w-8 h-8 border-2 border-gray-200 border-t-[#F97316] rounded-full animate-spin" />
                <span className="text-sm">Yükleniyor…</span>
              </div>
            </div>
          }>
            <ProductWalkthroughLazy />
          </Suspense>
        </div>
      </section>

      {/* ── E. Key modules ─────────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-white" aria-label="Modüller">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] mb-3">Mevcut modüller</h2>
            <p className="text-[#162033]/60 max-w-xl mx-auto">
              Yalnızca gerçekten mevcut ve çalışır durumdaki özellikler listelenmektedir.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {KEY_MODULES.map(({ label, available }) => (
              <div
                key={label}
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-gray-100 bg-[#F7F9FC]"
              >
                {available ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : (
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                )}
                <span className="text-sm font-medium text-[#162033]">{label}</span>
                {!available && (
                  <span className="ml-auto text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-full px-2 py-0.5 shrink-0">
                    Geliştirme aşamasında
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── F. Role-based experience ────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-[#0B1F3A] text-white" aria-label="Rol bazlı deneyim">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3">Her ekip, kendi görünümü</h2>
            <p className="text-white/55 max-w-xl mx-auto">
              Dört farklı rol, yalnızca ihtiyaç duyduğu alanları ve verileri görür.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {ROLES.map(({ role, desc, color }) => (
              <div
                key={role}
                className={`rounded-xl border-l-4 ${color} bg-white/5 backdrop-blur-sm px-5 py-5`}
              >
                <h3 className="font-semibold text-white mb-2">{role}</h3>
                <p className="text-sm text-white/60 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── G. Security ────────────────────────────────────────────────────── */}
      <section id="guvenlik" className="py-20 px-4 bg-white" aria-label="Güvenlik">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] mb-3">
              Güvenlik ve kontrol
            </h2>
            <p className="text-[#162033]/60 max-w-xl mx-auto">
              Kritik iş verileri yetkisiz erişime karşı koruma altındadır.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {SECURITY_ITEMS.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex gap-4">
                <div className="w-10 h-10 rounded-lg bg-[#0B1F3A]/8 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-5 h-5 text-[#0B1F3A]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#0B1F3A] mb-1 text-sm">{label}</h3>
                  <p className="text-sm text-[#162033]/60 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-10 text-center text-xs text-[#162033]/40 max-w-lg mx-auto">
            TourPilot mutlak güvenlik vaadi vermez. Platform, seyahat acenteleri için tasarlanmış katmanlı erişim kontrolü ve endüstri standartlarına uygun kimlik doğrulama sağlar.
          </p>
        </div>
      </section>

      {/* ── H. Current status ──────────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-[#F7F9FC]" aria-label="Ürün durumu">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 text-xs font-semibold px-4 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Aktif Geliştirme
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#0B1F3A] mb-4">
            TourPilot şu anda aktif geliştirme ve pilot kullanım aşamasındadır.
          </h2>
          <div className="space-y-3 text-[#162033]/65 text-sm max-w-lg mx-auto">
            <p className="flex items-start gap-2.5 justify-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Temel operasyon modülleri kullanıma hazırdır.
            </p>
            <p className="flex items-start gap-2.5 justify-center">
              <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              Muhasebe ve AI iş akışları geliştirilmeye ve iyileştirilmeye devam etmektedir.
            </p>
            <p className="flex items-start gap-2.5 justify-center">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Gerçek seyahat acentesi süreçleri gözetilerek tasarlanmıştır.
            </p>
          </div>
        </div>
      </section>

      {/* ── I. Final CTA ───────────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-[#0B1F3A] text-white" aria-label="Giriş yap">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">
            TourPilot'a Giriş Yap
          </h2>
          <p className="text-white/60 mb-8">
            Yetkili hesabınızla operasyon paneline erişin.
          </p>
          <Link href="/sign-in">
            <Button
              size="lg"
              className="bg-[#F97316] hover:bg-[#ea6c0a] text-white font-semibold px-10 gap-2 motion-safe:transition-transform motion-safe:hover:scale-[1.02]"
              data-testid="cta-final-sign-in"
            >
              Giriş Yap <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* ── J. Footer ──────────────────────────────────────────────────────── */}
      <footer className="bg-[#060d1a] text-white py-14 px-4" aria-label="Alt bilgi">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-10">

            {/* Brand block */}
            <div className="space-y-3">
              <TourPilotLogo dark />
              <p className="text-white/50 text-sm leading-snug max-w-xs">
                AI Destekli Tur Operasyon Yönetim Platformu
              </p>
              <div className="flex items-center gap-2.5">
                <span className="text-white/25 text-xs">tourpilot.com.tr</span>
                <span
                  className="text-[10px] font-mono text-white/30 bg-white/5 border border-white/10 rounded px-1.5 py-0.5"
                  aria-label={`Sürüm ${APP_VERSION}`}
                >
                  v{APP_VERSION}
                </span>
              </div>
            </div>

            {/* Nav */}
            <nav className="flex flex-col sm:flex-row gap-4 sm:gap-8" aria-label="Alt navigasyon">
              {NAV_LINKS.map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  className="text-sm text-white/50 hover:text-white transition-colors"
                >
                  {label}
                </a>
              ))}
              <Link href="/sign-in" className="text-sm text-white/50 hover:text-white transition-colors">
                Giriş Yap
              </Link>
            </nav>
          </div>

          {/* Bottom strip */}
          <div className="mt-10 pt-6 border-t border-white/8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-white/30 text-xs">
              &copy; {new Date().getFullYear()} TourPilot. Tüm hakları saklıdır.
            </p>
            <p className="text-white/20 text-xs">
              Turizm operasyon yazılımı &mdash; Türkiye
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

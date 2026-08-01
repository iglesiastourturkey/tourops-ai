import { Link } from 'wouter';
import { MapPin, Sparkles, FileText, ClipboardList, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'linear-gradient(160deg, hsl(213 57% 10%) 0%, hsl(184 79% 16%) 100%)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <img src="/tourops-ai/logo.svg" alt="TourOps AI" className="w-9 h-9" />
          <span className="text-white font-bold text-xl">TourOps AI</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in">
            <Button variant="ghost" className="text-white hover:bg-white/10" data-testid="link-sign-in">
              Giriş Yap
            </Button>
          </Link>
          <Link href="/sign-up">
            <Button className="bg-white text-primary hover:bg-white/90 font-semibold" data-testid="link-sign-up">
              Ücretsiz Dene
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20">
        <div className="inline-flex items-center gap-2 bg-white/10 text-white/90 text-sm px-4 py-1.5 rounded-full mb-8 border border-white/20">
          <Sparkles className="w-3.5 h-3.5" />
          Yapay Zeka Destekli Tur Yönetimi
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white max-w-3xl leading-tight mb-6" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
          Tur Operasyonlarınızı Yapay Zeka ile Güçlendirin
        </h1>
        <p className="text-white/70 text-lg max-w-2xl mb-10 leading-relaxed">
          Müşteri taleplerinden operasyon takibine kadar tüm süreçlerinizi tek platformda yönetin. Kuşadası, Efes, Pamukkale ve çevresi için özel olarak tasarlandı.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/sign-up">
            <Button size="lg" className="bg-primary hover:bg-primary/90 text-white font-semibold px-8 gap-2" data-testid="cta-sign-up">
              Hemen Başla <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="ghost" className="text-white hover:bg-white/10 border border-white/30 font-semibold px-8" data-testid="cta-sign-in">
              Giriş Yap
            </Button>
          </Link>
        </div>

        {/* Feature cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 w-full max-w-4xl">
          {[
            { icon: Sparkles, title: 'AI Talep Analizi', desc: 'Müşteri mesajlarından otomatik olarak tur bilgilerini çıkarın ve eksik alanları anında belirleyin.' },
            { icon: FileText, title: 'Akıllı Teklif Oluşturma', desc: 'Maliyet hesaplamaları, kar marjı optimizasyonu ve otomatik teklif numaralandırması ile profesyonel teklifler oluşturun.' },
            { icon: ClipboardList, title: 'Operasyon Takibi', desc: 'Tur operasyonlarınızı görev listeleri ve tamamlanma takibi ile kusursuz bir şekilde yönetin.' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-white/8 border border-white/15 rounded-xl p-6 text-left backdrop-blur-sm">
              <div className="w-10 h-10 rounded-lg bg-primary/30 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-white" />
              </div>
              <h3 className="text-white font-semibold mb-2">{title}</h3>
              <p className="text-white/60 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center py-6 text-white/40 text-sm border-t border-white/10">
        TourOps AI — Kuşadası, Efes, Pamukkale ve Ege bölgesi turları icin
      </footer>
    </div>
  );
}

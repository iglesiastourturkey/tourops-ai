/**
 * ProductWalkthrough — interactive 8-step product demo for the landing page.
 * - No backend / auth / DB dependency.
 * - Framer Motion soft transitions only.
 * - Responsive: desktop = sidebar + panel, mobile = carousel.
 * - Auto-plays every 5 s, pauses on hover / keyboard focus.
 * - Fully lazy-loadable (no top-level side-effects).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Users, FileText, MapPin, Smartphone, Receipt,
  Calculator, Bot, BarChart3,
  ChevronLeft, ChevronRight, CheckCircle2, Clock,
  AlertTriangle, TrendingUp, TrendingDown, Navigation,
  Phone, Camera, Scan, ArrowRight, Star,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Step {
  id: number;
  label: string;       // short nav label
  title: string;       // section heading
  subtitle: string;    // one-liner
  icon: React.FC<{ className?: string }>;
  accent: string;      // tailwind bg class for icon badge
  panel: React.FC<{ playing: boolean }>;
}

// ── Step panels ──────────────────────────────────────────────────────────────

function StaggerRow({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay }}
    >
      {children}
    </motion.div>
  );
}

// Step 1 — Müşteri Talebi
function PanelCustomerRequest() {
  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-xs font-semibold text-blue-700">Yeni Müşteri Talebi</span>
        </div>
      </StaggerRow>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
        <StaggerRow delay={0.08}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Müşteri" value="Heinrich Müller" />
            <Field label="Uyruk" value="🇩🇪 Almanya" />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.14}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tur Tipi" value="Şehir Turu" />
            <Field label="Yolcu Sayısı" value="4 Kişi" />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.20}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tarih" value="12 Ağu 2026" />
            <Field label="Destinasyon" value="İzmir / Efes" />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.28}>
          <div className="pt-1">
            <div className="text-[10px] text-gray-400 font-medium mb-1">Not</div>
            <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
              Sabah erken başlangıç tercih ediyoruz. İngilizce konuşan rehber gerekli.
            </div>
          </div>
        </StaggerRow>
        <StaggerRow delay={0.34}>
          <button className="w-full bg-[#0B1F3A] text-white text-xs font-semibold py-2 rounded-lg flex items-center justify-center gap-1.5">
            Teklif Oluştur <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </StaggerRow>
      </div>
    </div>
  );
}

// Step 2 — Teklif
function PanelQuotation() {
  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#0B1F3A]">Teklif #TKF-2026-0041</span>
          <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-semibold">
            AI Destekli
          </span>
        </div>
      </StaggerRow>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
        <StaggerRow delay={0.08}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tur" value="Efes Günübirlik" />
            <Field label="Fiyat" value="₺8.400" highlight />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.14}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Araç" value="Minibüs (8 kişi)" />
            <Field label="Rehber" value="Ahmet Yılmaz" />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.20}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Geçerlilik" value="7 gün" />
            <Field label="Döviz" value="TRY" />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.26}>
          <div className="border-t border-gray-100 pt-3">
            <div className="text-[10px] text-gray-400 font-medium mb-2">AI Önerileri</div>
            <div className="space-y-1">
              {['Efes Antik Şehri girişi dahil edildi', 'Öğle yemeği restoranı eklendi', 'Dönüş transferi optimize edildi'].map((tip, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-gray-600">
                  <Star className="w-3 h-3 text-amber-400 shrink-0" />
                  {tip}
                </div>
              ))}
            </div>
          </div>
        </StaggerRow>
        <StaggerRow delay={0.34}>
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-xs font-semibold text-emerald-700">Müşteri tarafından onaylandı</span>
          </div>
        </StaggerRow>
      </div>
    </div>
  );
}

// Step 3 — Operasyon Planlaması
function PanelOperationPlanning() {
  const tasks = ['Rehber Görev Atandı', 'Araç Rezervasyonu Yapıldı', 'Rota Planlandı', 'Müşteri Bilgilendirildi'];
  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-3 shadow-sm">
          <span className="text-xs font-bold text-[#0B1F3A]">OPR-2026-0088</span>
          <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2 py-0.5 font-semibold">Planlandı</span>
        </div>
      </StaggerRow>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
        <StaggerRow delay={0.08}>
          <div className="grid grid-cols-3 gap-2">
            <AssignCard icon={Users} label="Rehber" value="Ahmet Y." color="text-blue-600 bg-blue-50" />
            <AssignCard icon={Navigation} label="Şoför" value="Murat K." color="text-purple-600 bg-purple-50" />
            <AssignCard icon={MapPin} label="Araç" value="34 ABC 07" color="text-orange-600 bg-orange-50" />
          </div>
        </StaggerRow>
        <StaggerRow delay={0.16}>
          <div className="border-t border-gray-100 pt-3">
            <div className="text-[10px] text-gray-400 font-medium mb-2">Hazırlık Kontrol Listesi</div>
            <div className="space-y-1.5">
              {tasks.map((t, i) => (
                <motion.div
                  key={t}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.18 + i * 0.08 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="text-[11px] text-gray-700">{t}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </StaggerRow>
        <StaggerRow delay={0.54}>
          <div className="bg-[#F7F9FC] rounded-lg px-3 py-2 border border-gray-100">
            <div className="text-[9px] text-gray-400 font-medium mb-1.5">Zaman Çizelgesi</div>
            <div className="flex items-center gap-0 text-[10px]">
              {['08:00', '09:30', '12:00', '14:30', '17:00'].map((t, i, arr) => (
                <div key={t} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#0B1F3A]" />
                    <span className="text-[9px] text-gray-500 mt-0.5">{t}</span>
                  </div>
                  {i < arr.length - 1 && <div className="flex-1 h-px bg-[#F97316]/40 mx-0.5" />}
                </div>
              ))}
            </div>
          </div>
        </StaggerRow>
      </div>
    </div>
  );
}

// Step 4 — Saha Operasyonları (mobile view)
function PanelFieldOps() {
  return (
    <div className="flex justify-center">
      <div className="w-[200px] bg-[#0B1F3A] rounded-2xl p-1.5 shadow-2xl">
        <div className="bg-white rounded-xl overflow-hidden">
          {/* Status bar */}
          <div className="bg-[#0B1F3A] px-3 py-1.5 flex justify-between items-center">
            <span className="text-[9px] text-white/60">09:14</span>
            <span className="text-[9px] text-white font-bold">TourPilot</span>
            <span className="text-[9px] text-white/60">●●●</span>
          </div>
          <div className="p-3 space-y-2">
            <StaggerRow delay={0.0}>
              <div className="bg-blue-50 rounded-lg px-2.5 py-2">
                <div className="text-[9px] text-blue-500 font-semibold">Bugünkü Tur</div>
                <div className="text-[10px] text-[#0B1F3A] font-bold">Efes Günübirlik</div>
                <div className="text-[9px] text-gray-400">4 yolcu · 08:00 kalkış</div>
              </div>
            </StaggerRow>
            <StaggerRow delay={0.1}>
              <div className="space-y-1">
                {[
                  { label: 'Yolcular karşılandı', done: true },
                  { label: 'Araç kontrolü', done: true },
                  { label: 'Efes ziyareti', done: false },
                  { label: 'Öğle yemeği', done: false },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[9px]">
                    {item.done
                      ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      : <div className="w-3 h-3 rounded-full border border-gray-300 shrink-0" />
                    }
                    <span className={item.done ? 'text-gray-400 line-through' : 'text-gray-700'}>{item.label}</span>
                  </div>
                ))}
              </div>
            </StaggerRow>
            <StaggerRow delay={0.22}>
              <div className="grid grid-cols-2 gap-1">
                <button className="bg-[#F97316] text-white text-[8px] font-semibold rounded-lg py-1.5 flex items-center justify-center gap-1">
                  <Camera className="w-2.5 h-2.5" /> Makbuz
                </button>
                <button className="bg-[#0B1F3A] text-white text-[8px] font-semibold rounded-lg py-1.5 flex items-center justify-center gap-1">
                  <Phone className="w-2.5 h-2.5" /> Acil
                </button>
              </div>
            </StaggerRow>
          </div>
        </div>
      </div>
    </div>
  );
}

// Step 5 — Makbuz Yükleme
function PanelReceiptUpload({ playing }: { playing: boolean }) {
  const [phase, setPhase] = useState(0); // 0=preview 1=scanning 2=done
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!playing || reduced) { setPhase(2); return; }
    setPhase(0);
    const t1 = setTimeout(() => setPhase(1), 900);
    const t2 = setTimeout(() => setPhase(2), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [playing, reduced]);

  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
          {/* Receipt image placeholder */}
          <div className="relative rounded-lg overflow-hidden mb-3 bg-gray-50 border border-gray-200 h-20 flex items-center justify-center">
            <div className="text-center">
              <Receipt className="w-6 h-6 text-gray-300 mx-auto mb-1" />
              <span className="text-[9px] text-gray-400">makbuz_foto.jpg</span>
            </div>
            {/* Scan beam */}
            {phase === 1 && (
              <motion.div
                className="absolute inset-x-0 h-0.5 bg-[#F97316]/80 shadow-lg"
                initial={{ top: 0 }}
                animate={{ top: '100%' }}
                transition={{ duration: 1.2, ease: 'linear' }}
              />
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 mb-3">
            {phase < 2 ? (
              <div className="flex items-center gap-2 text-[11px] text-amber-600">
                <Scan className="w-3.5 h-3.5 animate-pulse" />
                {phase === 0 ? 'Yükleniyor…' : 'OCR analiz yapılıyor…'}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> OCR tamamlandı
              </div>
            )}
          </div>

          {/* Detected fields */}
          <AnimatePresence>
            {phase === 2 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 space-y-1.5"
              >
                <div className="text-[9px] text-emerald-600 font-semibold mb-1">Tespit Edilenler</div>
                {[
                  { label: 'İşyeri', value: 'Efes Restoran' },
                  { label: 'Tutar', value: '₺2.450,00' },
                  { label: 'KDV (%10)', value: '₺222,73' },
                  { label: 'Tarih', value: '12.08.2026' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-[10px]">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-semibold text-[#0B1F3A]">{value}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {phase === 2 && (
            <StaggerRow delay={0.1}>
              <div className="mt-2 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-[10px] text-amber-700 font-semibold">Muhasebe incelemesi bekliyor</span>
              </div>
            </StaggerRow>
          )}
        </div>
      </StaggerRow>
    </div>
  );
}

// Step 6 — Muhasebe
function PanelAccounting() {
  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="text-xs font-bold text-[#0B1F3A]">Belge İnceleme Merkezi</div>
      </StaggerRow>
      <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm space-y-3">
        <StaggerRow delay={0.06}>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gray-50 border border-gray-200 rounded-lg h-16 flex items-center justify-center">
              <div className="text-center">
                <Receipt className="w-5 h-5 text-gray-300 mx-auto" />
                <span className="text-[8px] text-gray-400">Orijinal Belge</span>
              </div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg h-16 p-2 space-y-1">
              <div className="text-[8px] text-emerald-600 font-semibold">OCR Sonucu</div>
              {[['₺2.450', 'Tutar'], ['12.08', 'Tarih'], ['Efes R.', 'Tedarikçi']].map(([v, l]) => (
                <div key={l} className="flex justify-between text-[9px]">
                  <span className="text-gray-400">{l}</span>
                  <span className="font-semibold text-gray-700">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </StaggerRow>
        <StaggerRow delay={0.18}>
          <div className="flex gap-2">
            <button className="flex-1 bg-emerald-500 text-white text-[10px] font-semibold py-2 rounded-lg flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Onayla
            </button>
            <button className="flex-1 bg-gray-100 text-gray-600 text-[10px] font-semibold py-2 rounded-lg">
              Reddet
            </button>
          </div>
        </StaggerRow>
        <StaggerRow delay={0.26}>
          <div className="bg-[#F7F9FC] border border-gray-100 rounded-lg px-3 py-2">
            <div className="text-[9px] text-gray-400 font-medium mb-1.5">İşlem Oluştur</div>
            <div className="grid grid-cols-3 gap-1 text-[9px]">
              <Field label="Hesap" value="Yemek" />
              <Field label="Tutar" value="₺2.450" />
              <Field label="Döviz" value="TRY" />
            </div>
          </div>
        </StaggerRow>
        <StaggerRow delay={0.34}>
          <div className="flex items-center gap-1.5 text-[10px] text-blue-600 font-medium">
            <ArrowRight className="w-3 h-3" /> Excel / PDF dışa aktarma hazır
          </div>
        </StaggerRow>
      </div>
    </div>
  );
}

// Step 7 — AI Asistan
function PanelAIAssistant({ playing }: { playing: boolean }) {
  const insights = [
    { icon: AlertTriangle, text: '3 belge inceleme bekliyor', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-100' },
    { icon: Clock, text: '1 gecikmiş ödeme mevcut', color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
    { icon: TrendingUp, text: 'Yakıt gideri %12 arttı', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
    { icon: Users, text: '2 olası mükerrer kayıt', color: 'text-purple-600', bg: 'bg-purple-50 border-purple-100' },
    { icon: TrendingDown, text: 'Nakit akışı sağlıklı görünüyor', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
  ];
  const reduced = useReducedMotion();

  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="flex items-center gap-2 bg-[#0B1F3A] text-white rounded-xl px-4 py-3">
          <Bot className="w-5 h-5 text-[#F97316] shrink-0" />
          <div>
            <div className="text-xs font-bold">AI Muhasebe Asistanı</div>
            <div className="text-[10px] text-white/60">Ağustos 2026 analizi hazır</div>
          </div>
          <span className="ml-auto text-[10px] bg-[#F97316]/20 text-[#F97316] px-2 py-0.5 rounded-full font-semibold">Canlı</span>
        </div>
      </StaggerRow>
      <div className="space-y-2">
        {insights.map(({ icon: Icon, text, color, bg }, i) => (
          <motion.div
            key={text}
            initial={reduced ? false : { opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: playing ? 0.08 + i * 0.1 : 0, duration: 0.3 }}
            className={`flex items-center gap-2.5 border rounded-lg px-3 py-2.5 ${bg}`}
          >
            <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
            <span className={`text-[11px] font-medium ${color}`}>{text}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// Step 8 — Yönetim Paneli
function PanelDashboard({ playing }: { playing: boolean }) {
  const reduced = useReducedMotion();
  const bars = [55, 68, 60, 80, 72, 90];
  const expenses = [30, 38, 32, 40, 36, 42];

  return (
    <div className="space-y-3">
      <StaggerRow delay={0.0}>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Toplam Gelir', val: '₺189.420', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
            { label: 'Toplam Gider', val: '₺72.310', icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
            { label: 'Aktif Operasyon', val: '3', icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
            { label: 'Aktif Rehber', val: '5', icon: Users, color: 'text-purple-600', bg: 'bg-purple-50 border-purple-100' },
          ].map(({ label, val, icon: Icon, color, bg }, i) => (
            <motion.div
              key={label}
              initial={reduced ? false : { opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: playing ? 0.04 + i * 0.07 : 0, duration: 0.3 }}
              className={`border rounded-xl p-3 ${bg}`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span className={`text-[9px] font-medium ${color} opacity-80`}>{label}</span>
              </div>
              <div className={`text-sm font-bold ${color}`}>{val}</div>
            </motion.div>
          ))}
        </div>
      </StaggerRow>
      <StaggerRow delay={0.32}>
        <div className="bg-white border border-gray-100 rounded-xl p-3 shadow-sm">
          <div className="text-[9px] text-gray-400 font-medium mb-2">Gelir / Gider — Şubat–Ağustos 2026</div>
          <div className="flex items-end gap-0.5 h-14">
            {bars.map((g, i) => (
              <div key={i} className="flex-1 flex items-end gap-px">
                <motion.div
                  className="flex-1 bg-[#0d7377] rounded-t-sm"
                  initial={reduced ? false : { height: 0 }}
                  animate={{ height: `${g}%` }}
                  transition={{ delay: playing ? 0.36 + i * 0.06 : 0, duration: 0.4, ease: 'easeOut' }}
                />
                <motion.div
                  className="flex-1 bg-[#0B1F3A]/50 rounded-t-sm"
                  initial={reduced ? false : { height: 0 }}
                  animate={{ height: `${expenses[i]}%` }}
                  transition={{ delay: playing ? 0.42 + i * 0.06 : 0, duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="flex items-center gap-1 text-[8px] text-gray-400"><span className="w-2 h-2 rounded-sm bg-[#0d7377]" /> Gelir</span>
            <span className="flex items-center gap-1 text-[8px] text-gray-400"><span className="w-2 h-2 rounded-sm bg-[#0B1F3A]/50" /> Gider</span>
          </div>
        </div>
      </StaggerRow>
    </div>
  );
}

// ── Small reusable atoms ─────────────────────────────────────────────────────

function Field({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-[#F7F9FC] rounded-lg px-2.5 py-2 border border-gray-100">
      <div className="text-[9px] text-gray-400 font-medium">{label}</div>
      <div className={`text-[11px] font-semibold mt-0.5 ${highlight ? 'text-[#F97316]' : 'text-[#0B1F3A]'}`}>{value}</div>
    </div>
  );
}

function AssignCard({ icon: Icon, label, value, color }: { icon: React.FC<{ className?: string }>; label: string; value: string; color: string }) {
  return (
    <div className="border border-gray-100 rounded-lg p-2 text-center bg-[#F7F9FC]">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center mx-auto mb-1 ${color}`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="text-[8px] text-gray-400 font-medium">{label}</div>
      <div className="text-[10px] font-bold text-[#0B1F3A] leading-tight">{value}</div>
    </div>
  );
}

// ── Step definitions ─────────────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    id: 1,
    label: 'Müşteri Talebi',
    title: 'Müşteri Talebi',
    subtitle: 'Yeni bir müşteri turu talep etti.',
    icon: Users,
    accent: 'bg-blue-500',
    panel: () => <PanelCustomerRequest />,
  },
  {
    id: 2,
    label: 'Teklif',
    title: 'AI Destekli Teklif',
    subtitle: 'Yapay zekâ teklifi hazırlamaya yardım etti.',
    icon: FileText,
    accent: 'bg-amber-500',
    panel: () => <PanelQuotation />,
  },
  {
    id: 3,
    label: 'Operasyon',
    title: 'Operasyon Planlaması',
    subtitle: 'Rehber, şoför ve araç atandı.',
    icon: MapPin,
    accent: 'bg-[#0B1F3A]',
    panel: () => <PanelOperationPlanning />,
  },
  {
    id: 4,
    label: 'Saha',
    title: 'Saha Operasyonları',
    subtitle: 'Rehber mobil uygulamadan takip ediyor.',
    icon: Smartphone,
    accent: 'bg-purple-500',
    panel: () => <PanelFieldOps />,
  },
  {
    id: 5,
    label: 'Makbuz',
    title: 'Makbuz Yükleme',
    subtitle: 'Rehber fiş yükledi, OCR verileri çıkardı.',
    icon: Receipt,
    accent: 'bg-[#F97316]',
    panel: ({ playing }) => <PanelReceiptUpload playing={playing} />,
  },
  {
    id: 6,
    label: 'Muhasebe',
    title: 'Muhasebe İncelemesi',
    subtitle: 'Muhasebeci belgeyi inceledi ve onayladı.',
    icon: Calculator,
    accent: 'bg-emerald-600',
    panel: () => <PanelAccounting />,
  },
  {
    id: 7,
    label: 'AI Özeti',
    title: 'AI Muhasebe Asistanı',
    subtitle: 'AI dönem analizi ve önerileri sundu.',
    icon: Bot,
    accent: 'bg-violet-600',
    panel: ({ playing }) => <PanelAIAssistant playing={playing} />,
  },
  {
    id: 8,
    label: 'Kontrol Paneli',
    title: 'Yönetim Paneli',
    subtitle: 'Tüm operasyon ve finansal veriler bir ekranda.',
    icon: BarChart3,
    accent: 'bg-[#0B1F3A]',
    panel: ({ playing }) => <PanelDashboard playing={playing} />,
  },
];

// ── Main component ───────────────────────────────────────────────────────────

export function ProductWalkthrough() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(true);
  const reduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-play
  useEffect(() => {
    if (paused || reduced) return;
    const id = setInterval(() => setActive(p => (p + 1) % STEPS.length), 5000);
    return () => clearInterval(id);
  }, [paused, reduced]);

  // Re-trigger panel animations whenever step changes
  useEffect(() => {
    setPlaying(false);
    const t = setTimeout(() => setPlaying(true), 50);
    return () => clearTimeout(t);
  }, [active]);

  const go = useCallback((idx: number) => {
    setActive(idx);
    setPaused(true);
  }, []);

  const prev = () => go((active - 1 + STEPS.length) % STEPS.length);
  const next = () => go((active + 1) % STEPS.length);

  // Keyboard nav
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  };

  const step = STEPS[active];
  const StepIcon = step.icon;
  const PanelContent = step.panel;

  return (
    <div
      ref={containerRef}
      className="max-w-6xl mx-auto"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label="TourPilot ürün demosu"
      aria-roledescription="slayt gösterisi"
    >
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">

        {/* ── Sidebar: step list (desktop) / tabs (mobile) ──────────────── */}
        <div className="lg:w-56 shrink-0">
          {/* Mobile: horizontal scrollable pill tabs */}
          <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => go(i)}
                  aria-selected={i === active}
                  aria-label={`Adım ${s.id}: ${s.label}`}
                  className={`snap-start shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border transition-colors ${
                    i === active
                      ? 'bg-[#0B1F3A] text-white border-[#0B1F3A]'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Desktop: vertical list */}
          <nav className="hidden lg:flex flex-col gap-1" aria-label="Adımlar">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === active;
              return (
                <button
                  key={s.id}
                  onClick={() => go(i)}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={`Adım ${s.id}: ${s.label}`}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] ${
                    isActive
                      ? 'bg-[#0B1F3A] text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[10px] font-bold ${
                    isActive ? s.accent : 'bg-gray-200 text-gray-500'
                  } group-hover:${s.accent} transition-colors`}>
                    {s.id}
                  </span>
                  <span className={`text-xs font-medium ${isActive ? 'text-white' : 'text-gray-600'}`}>
                    {s.label}
                  </span>
                  {isActive && !paused && !reduced && (
                    <motion.div
                      className="ml-auto w-1 h-1 rounded-full bg-[#F97316]"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Main panel ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
            {/* Panel header */}
            <div className="border-b border-gray-100 px-5 py-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white ${step.accent}`}>
                <StepIcon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-gray-400 font-medium">
                    Adım {step.id} / {STEPS.length}
                  </span>
                  <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">Demo</span>
                </div>
                <h3 className="text-sm font-bold text-[#0B1F3A] leading-tight">{step.title}</h3>
                <p className="text-xs text-gray-400 leading-tight">{step.subtitle}</p>
              </div>
            </div>

            {/* Animated panel content */}
            <div className="p-5 min-h-[280px] relative" aria-live="polite" aria-atomic="true">
              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={reduced ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -6 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                >
                  <PanelContent playing={playing} />
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer: progress + nav */}
            <div className="border-t border-gray-100 px-5 py-3 flex items-center gap-4">
              {/* Progress dots */}
              <div className="flex items-center gap-1.5 flex-1" role="tablist" aria-label="Adım göstergesi">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    role="tab"
                    aria-selected={i === active}
                    aria-label={`Adım ${i + 1}: ${STEPS[i].label}`}
                    onClick={() => go(i)}
                    className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] rounded-full"
                  >
                    <motion.div
                      animate={{
                        width: i === active ? 20 : 6,
                        backgroundColor: i === active ? '#F97316' : '#d1d5db',
                      }}
                      transition={{ duration: 0.25 }}
                      className="h-1.5 rounded-full"
                    />
                  </button>
                ))}
              </div>

              {/* Auto-play indicator */}
              {!paused && !reduced && (
                <div className="flex items-center gap-1 text-[9px] text-gray-400">
                  <motion.span
                    className="w-1.5 h-1.5 rounded-full bg-[#F97316]"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                  />
                  Otomatik
                </div>
              )}

              {/* Prev / Next */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={prev}
                  aria-label="Önceki adım"
                  className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={next}
                  aria-label="Sonraki adım"
                  className="w-8 h-8 rounded-lg bg-[#0B1F3A] text-white flex items-center justify-center hover:bg-[#162033] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

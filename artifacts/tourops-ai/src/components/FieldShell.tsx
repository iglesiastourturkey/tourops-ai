/**
 * FieldShell — mobile-first layout wrapper for the Field Operations Center.
 * Desktop: standard AppShell sidebar.
 * Mobile: AppShell top header + fixed bottom navigation bar.
 */
import { useLocation, Link } from 'wouter';
import { AppShell } from '@/components/AppShell';
import { cn } from '@/lib/utils';
import { CalendarDays, ClipboardList, AlertTriangle, Bell } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useListNotifications } from '@workspace/api-client-react';

const BOTTOM_NAV = [
  { icon: CalendarDays, label: 'Bugün', href: '/field' },
  { icon: ClipboardList, label: 'Operasyonlar', href: '/field/operations' },
  { icon: AlertTriangle, label: 'Olaylar', href: '/field/incidents' },
  { icon: Bell, label: 'Bildirimler', href: '/notifications' },
];

interface FieldShellProps {
  children: React.ReactNode;
  title?: string;
}

export function FieldShell({ children, title }: FieldShellProps) {
  const [location] = useLocation();
  const { isOnline } = useNetworkStatus();
  const { data: notifications } = useListNotifications();
  const unreadCount = notifications?.filter(n => !n.isRead).length ?? 0;

  return (
    <AppShell title={title}>
      {/* Offline banner */}
      {!isOnline && (
        <div className="sticky top-0 z-30 bg-orange-500 text-white text-xs font-semibold text-center py-1.5 px-4 flex items-center justify-center gap-2">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse shrink-0" />
          Çevrimdışı — bağlantı kurulamıyor
        </div>
      )}

      {/* Page content with bottom padding on mobile for the nav bar */}
      <div className="pb-16 lg:pb-0">
        {children}
      </div>

      {/* Fixed bottom navigation — mobile only */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-white border-t border-gray-200 safe-area-pb"
        aria-label="Saha navigasyonu"
      >
        <div className="flex">
          {BOTTOM_NAV.map(({ icon: Icon, label, href }) => {
            const isActive = href === '/field'
              ? location === '/field'
              : location.startsWith(href);
            const isNotif = href === '/notifications';

            return (
              <Link key={href} href={href} className="flex-1">
                <div
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 py-2 px-1 relative cursor-pointer transition-colors',
                    isActive ? 'text-[#0B1F3A]' : 'text-gray-400 hover:text-gray-600',
                  )}
                >
                  <div className="relative">
                    <Icon className={cn('w-5 h-5', isActive && 'text-[#F97316]')} />
                    {isNotif && unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    )}
                  </div>
                  <span className={cn('text-[10px] font-medium leading-none', isActive ? 'text-[#F97316]' : '')}>
                    {label}
                  </span>
                  {isActive && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-[#F97316] rounded-full" />
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </nav>
    </AppShell>
  );
}

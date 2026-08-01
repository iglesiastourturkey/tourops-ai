import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { UserButton } from '@clerk/react';
import { useListNotifications } from '@workspace/api-client-react';
import {
  LayoutDashboard, Sparkles, Users, Building2, MapPin,
  FileText, ClipboardList, Bell, Settings, Menu, UserCog
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useProfile, ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';

type NavItem = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  roles?: UserRole[]; // undefined = all authenticated roles
};

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Kontrol Paneli', href: '/dashboard', roles: ['admin', 'operations', 'accounting'] },
  { icon: Sparkles, label: 'Yeni Talep', href: '/requests/new', roles: ['admin', 'operations', 'accounting'] },
  { icon: Users, label: 'Müşteriler', href: '/customers', roles: ['admin', 'operations', 'accounting'] },
  { icon: Building2, label: 'Tedarikçiler', href: '/suppliers', roles: ['admin', 'operations', 'accounting'] },
  { icon: MapPin, label: 'Turlar', href: '/tours', roles: ['admin', 'operations', 'guide', 'accounting'] },
  { icon: FileText, label: 'Teklifler', href: '/quotations', roles: ['admin', 'operations', 'accounting'] },
  { icon: ClipboardList, label: 'Operasyonlar', href: '/operations', roles: ['admin', 'operations', 'accounting', 'guide'] },
  { icon: Bell, label: 'Bildirimler', href: '/notifications' },
  { icon: Settings, label: 'Ayarlar', href: '/settings', roles: ['admin', 'operations'] },
  { icon: UserCog, label: 'Kullanıcı Yönetimi', href: '/users', roles: ['super_admin'] },
];

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: notifications } = useListNotifications();
  const unreadCount = notifications?.filter(n => !n.isRead).length ?? 0;
  const { role, isLoading: profileLoading } = useProfile();

  const visibleNavItems = navItems.filter(item => {
    if (profileLoading) return false;
    if (!item.roles) return true;          // visible to all authenticated roles
    if (!role) return false;
    if (role === 'super_admin') return true; // super_admin sees every nav item
    return item.roles.includes(role);
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <img src="/tourops-ai/logo.svg" alt="TourOps AI" className="w-8 h-8 flex-shrink-0" />
        <div>
          <div className="text-white font-bold text-base leading-tight">TourOps AI</div>
          <div className="text-sidebar-foreground/60 text-xs">Tur Yönetim Sistemi</div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-2 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ icon: Icon, label, href }) => {
          const isActive = location === href || (href !== '/dashboard' && location.startsWith(href));
          return (
            <Link key={href} href={href}
              onClick={() => setSidebarOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative',
                isActive
                  ? 'bg-sidebar-primary text-white'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white'
              )}
              data-testid={`nav-${href.replace(/\//g, '-').replace(/^-/, '')}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{label}</span>
              {href === '/notifications' && unreadCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-sidebar-border flex items-center gap-2">
        <UserButton appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
        {role && (
          <span className="text-xs text-sidebar-foreground/70 font-medium">
            {ROLE_LABELS[role]}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-sidebar">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative flex flex-col w-60 bg-sidebar z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-border flex-shrink-0">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)} data-testid="button-sidebar-toggle">
            <Menu className="w-5 h-5" />
          </Button>
          {title && <h1 className="text-base font-semibold text-foreground flex-1">{title}</h1>}
          {!title && <div className="flex-1" />}
          <Link href="/notifications" data-testid="link-notifications-header">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </Link>
          <UserButton appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

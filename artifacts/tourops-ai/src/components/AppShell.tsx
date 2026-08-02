import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { UserButton } from '@clerk/react';
import { useListNotifications } from '@workspace/api-client-react';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import {
  LayoutDashboard, Sparkles, Users, Building2, MapPin,
  FileText, ClipboardList, Bell, Settings, Menu, UserCog,
  BookOpen, Compass, HardHat, Shield, Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useProfile, ROLE_LABELS } from '@/contexts/ProfileContext';

type NavItem = {
  icon:       React.ComponentType<{ className?: string }>;
  label:      string;
  href:       string;
  /**
   * Required permission as [module, action].
   * undefined = visible to all authenticated users.
   */
  permission?: [string, string];
};

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Kontrol Paneli',     href: '/dashboard',          permission: ['dashboard',        'view']   },
  { icon: Compass,         label: 'Operasyonlarım',     href: '/guide',              permission: ['guide_workspace',  'view']   },
  { icon: Sparkles,        label: 'Yeni Talep',         href: '/requests/new',       permission: ['operations',       'create'] },
  { icon: Users,           label: 'Müşteriler',         href: '/customers',          permission: ['customers',        'view']   },
  { icon: Building2,       label: 'Tedarikçiler',       href: '/suppliers',          permission: ['suppliers',        'view']   },
  { icon: MapPin,          label: 'Turlar',             href: '/tours',              permission: ['tours',            'view']   },
  { icon: FileText,        label: 'Teklifler',          href: '/quotations',         permission: ['quotations',       'view']   },
  { icon: ClipboardList,   label: 'Operasyonlar',       href: '/operations',         permission: ['operations',       'view']   },
  { icon: HardHat,         label: 'Saha Operasyon',     href: '/field',              permission: ['field_operations', 'view']   },
  { icon: Bell,            label: 'Bildirimler',        href: '/notifications',      permission: ['notifications',    'view']   },
  { icon: Settings,        label: 'Ayarlar',            href: '/settings',           permission: ['settings',         'view']   },
  { icon: BookOpen,        label: 'Muhasebe',           href: '/accounting',         permission: ['accounting',       'view']   },
  { icon: Settings,        label: 'Muhasebe Ayarları',  href: '/accounting/settings',permission: ['accounting',       'manage'] },
  { icon: UserCog,         label: 'Kullanıcı Yönetimi', href: '/users',              permission: ['users',            'manage'] },
  { icon: Shield,          label: 'Rol Yönetimi',       href: '/roles',              permission: ['roles',            'manage'] },
  { icon: Monitor,         label: 'Sistem Kontrolü',    href: '/system-control',     permission: ['system_control',   'manage'] },
];

// Base-path-safe logo: resolves against Vite's BASE_URL at build time so it
// works in Replit preview (/tourops-ai/), custom domains (/), and prod builds.
const LOGO_SRC = `${import.meta.env.BASE_URL}logo.svg`;

function AppLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <svg
        width="36" height="36" viewBox="0 0 40 40" fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        <rect width="40" height="40" rx="10" fill="#0B1F3A" />
        <circle cx="20" cy="20" r="11" stroke="#F97316" strokeWidth="2" fill="none" opacity="0.35" />
        <line x1="11" y1="29" x2="29" y2="11" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="29" cy="11" r="3" fill="#F97316" />
        <circle cx="11" cy="29" r="2" fill="white" opacity="0.7" />
      </svg>
    );
  }
  return (
    <img
      src={LOGO_SRC}
      alt="TourPilot"
      width={36}
      height={36}
      className="flex-shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AppShell({ children, title }: AppShellProps) {
  const [location]      = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: notifications }       = useListNotifications();
  const unreadCount = notifications?.filter(n => !n.isRead).length ?? 0;
  const { role, isLoading: profileLoading, permissionSet, allPermissions, permissionsLoaded } = useProfile();

  const visibleNavItems = navItems.filter(item => {
    if (profileLoading || !permissionsLoaded) return false;
    if (!item.permission) return true;           // no permission required
    if (allPermissions) return true;             // super_admin sees everything
    const [module, action] = item.permission;
    return permissionSet.has(`${module}.${action}`);
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <AppLogo />
        <div>
          <div className="text-white font-bold text-base leading-tight">TourPilot</div>
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
          <OfflineIndicator />
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

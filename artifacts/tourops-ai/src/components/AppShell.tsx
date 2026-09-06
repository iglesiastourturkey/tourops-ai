import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { UserButton } from '@clerk/react';
import { useListNotifications } from '@workspace/api-client-react';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import {
  LayoutDashboard, Sparkles, Users, Building2, MapPin,
  FileText, ClipboardList, Bell, Settings, Menu, UserCog,
  BookOpen, Compass, HardHat, Shield, Monitor, Inbox, MessageSquareText, FileSpreadsheet, CalendarDays,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useProfile, ROLE_LABELS, type UserRole } from '@/contexts/ProfileContext';
import { APP_VERSION } from '@/lib/version';

type NavItem = {
  icon:       React.ComponentType<{ className?: string }>;
  label:      string;
  href:       string;
  /**
   * Required permission as [module, action].
   * undefined = visible to all authenticated users.
   */
  permission?: [string, string];
  superAdminOnly?: boolean;
  allowedRoles?: UserRole[];
};

type NavGroup = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hrefs: string[];
};

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Kontrol Paneli',     href: '/dashboard',          permission: ['dashboard',        'view']   },
  { icon: Compass,         label: 'Görevlerim',         href: '/guide',              permission: ['guide_workspace',  'view']   },
  { icon: Sparkles,        label: 'Yeni Talep',         href: '/requests/new',       permission: ['operations',       'create'] },
  { icon: Users,           label: 'Müşteriler',         href: '/customers',          permission: ['customers',        'view']   },
  { icon: MessageSquareText,label: 'İletişim & Otomasyonlar', href: '/communications', allowedRoles: ['admin', 'operations'] },
  { icon: ClipboardList,   label: 'Gözlem İncelemesi',  href: '/external-observations', allowedRoles: ['admin', 'operations'] },
  { icon: FileSpreadsheet, label: 'Sheet İçe Aktarım',  href: '/sheet-import',        allowedRoles: ['admin', 'operations'] },
  { icon: Building2,       label: 'Tedarikçiler',       href: '/suppliers',           permission: ['suppliers',        'view']   },
  { icon: MapPin,          label: 'Turlar',             href: '/tours',               permission: ['tours',            'view']   },
  { icon: FileText,        label: 'Teklifler',          href: '/quotations',          permission: ['quotations',       'view']   },
  { icon: ClipboardList,   label: 'Operasyon Planlama', href: '/operations',          permission: ['operations',       'view']   },
  { icon: CalendarDays,    label: 'Takvim',             href: '/calendar',            permission: ['operations',       'view']   },
  { icon: Inbox,           label: 'Gelen Rezervasyonlar', href: '/reservations',      permission: ['reservations',     'view']   },
  { icon: HardHat,         label: 'Operasyon Merkezi',  href: '/field',               permission: ['field_operations', 'view']   },
  { icon: Bell,            label: 'Bildirimler',        href: '/notifications',       permission: ['notifications',    'view']   },
  { icon: Settings,        label: 'Ayarlar',            href: '/settings',            permission: ['settings',         'view']   },
  { icon: BookOpen,        label: 'Muhasebe',           href: '/accounting',          permission: ['accounting',       'view']   },
  { icon: Settings,        label: 'Muhasebe Ayarları',  href: '/accounting/settings', permission: ['accounting',       'manage'] },
  { icon: UserCog,         label: 'Kullanıcı Yönetimi', href: '/users',               permission: ['users',            'manage'] },
  { icon: Shield,          label: 'Rol Yönetimi',       href: '/roles',               permission: ['roles',            'manage'] },
  { icon: Monitor,         label: 'Sistem Kontrolü',    href: '/system-control',      permission: ['system_control',   'manage'] },
  { icon: Shield,          label: 'Denetim Kayıtları',  href: '/audit',               superAdminOnly: true },
];

/**
 * Scalable information architecture: the sidebar exposes a small set of
 * business domains and keeps concrete pages one level below them. Existing
 * route hrefs and per-page permission rules stay untouched.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'reservations',
    label: 'Rezervasyonlar',
    icon: Inbox,
    hrefs: ['/requests/new', '/reservations', '/quotations', '/sheet-import'],
  },
  {
    id: 'operations',
    label: 'Operasyon',
    icon: ClipboardList,
    hrefs: ['/operations', '/calendar', '/field', '/external-observations'],
  },
  {
    id: 'crm',
    label: 'Müşteri & İş Ortakları',
    icon: Users,
    hrefs: ['/customers', '/communications', '/suppliers'],
  },
  {
    id: 'products',
    label: 'Ürünler',
    icon: MapPin,
    hrefs: ['/tours'],
  },
  {
    id: 'finance',
    label: 'Finans',
    icon: BookOpen,
    hrefs: ['/accounting', '/accounting/settings'],
  },
  {
    id: 'admin',
    label: 'Yönetim',
    icon: Settings,
    hrefs: ['/settings', '/users', '/roles', '/system-control', '/audit'],
  },
];

const STANDALONE_HREFS = ['/dashboard', '/guide'] as const;
// Notifications remain available from the persistent header bell; keeping them
// out of the sidebar avoids duplicating a global action as another primary menu.
const HEADER_ONLY_HREFS = new Set(['/notifications']);

function isRouteActive(location: string, href: string) {
  if (location === href) return true;
  if (!location.startsWith(`${href}/`)) return false;

  // Prefer the most-specific nav route. For example `/accounting/settings`
  // should activate only "Muhasebe Ayarları", while `/operations/123` should
  // still activate its `/operations` parent entry.
  return !navItems.some(item => (
    item.href !== href
    && item.href.length > href.length
    && (location === item.href || location.startsWith(`${item.href}/`))
  ));
}

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
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const activeGroup = NAV_GROUPS.find(group => group.hrefs.some(href => isRouteActive(location, href)));
    return new Set(activeGroup ? [activeGroup.id] : []);
  });
  const { data: notifications } = useListNotifications();
  const unreadCount = notifications?.filter(n => !n.isRead).length ?? 0;
  const { role, isLoading: profileLoading, permissionSet, allPermissions, permissionsLoaded } = useProfile();

  useEffect(() => {
    const activeGroup = NAV_GROUPS.find(group => group.hrefs.some(href => isRouteActive(location, href)));
    if (!activeGroup) return;
    setOpenGroups(current => {
      if (current.has(activeGroup.id)) return current;
      return new Set([...current, activeGroup.id]);
    });
  }, [location]);

  const visibleNavItems = navItems.filter(item => {
    if (profileLoading || !permissionsLoaded) return false;
    if (item.superAdminOnly) return role === 'super_admin';
    if (item.allowedRoles && role !== 'super_admin' && (!role || !item.allowedRoles.includes(role))) return false;
    if (!item.permission) return true;
    if (allPermissions) return true;
    const [module, action] = item.permission;
    return permissionSet.has(`${module}.${action}`);
  });

  const visibleByHref = new Map(visibleNavItems.map(item => [item.href, item]));
  const groupedHrefs = new Set(NAV_GROUPS.flatMap(group => group.hrefs));
  const visibleGroups = NAV_GROUPS.map(group => ({
    ...group,
    items: group.hrefs
      .map(href => visibleByHref.get(href))
      .filter((item): item is NavItem => Boolean(item)),
  })).filter(group => group.items.length > 0);

  const standaloneItems = STANDALONE_HREFS
    .map(href => visibleByHref.get(href))
    .filter((item): item is NavItem => Boolean(item));

  // Defensive fallback: future routes that are neither intentionally header-only
  // nor assigned to a domain still remain reachable instead of disappearing.
  const ungroupedItems = visibleNavItems.filter(item => (
    !groupedHrefs.has(item.href)
    && !STANDALONE_HREFS.includes(item.href as typeof STANDALONE_HREFS[number])
    && !HEADER_ONLY_HREFS.has(item.href)
  ));

  function toggleGroup(groupId: string) {
    setOpenGroups(current => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function renderNavLink(item: NavItem, nested = false) {
    const { icon: Icon, label, href } = item;
    const isActive = isRouteActive(location, href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          'flex items-center gap-3 rounded-lg text-sm font-medium transition-colors relative',
          nested ? 'py-2 pl-9 pr-3' : 'px-3 py-2.5',
          isActive
            ? 'bg-sidebar-primary text-white'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white'
        )}
        data-testid={`nav-${href.replace(/\//g, '-').replace(/^-/, '')}`}
      >
        <Icon className={cn('w-4 h-4 flex-shrink-0', nested && 'opacity-80')} />
        <span className="min-w-0 truncate">{label}</span>
      </Link>
    );
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <AppLogo />
        <div>
          <div className="text-white font-bold text-base leading-tight">TourPilot</div>
          <div className="text-sidebar-foreground/60 text-xs">Tur Yönetim Sistemi</div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-2 overflow-y-auto" aria-label="Ana navigasyon">
        <div className="space-y-1">
          {standaloneItems.map(item => renderNavLink(item))}
        </div>

        {visibleGroups.length > 0 && (
          <div className="mt-4 space-y-1">
            {visibleGroups.map(group => {
              const GroupIcon = group.icon;
              const isOpen = openGroups.has(group.id);
              const isActive = group.items.some(item => isRouteActive(location, item.href));
              const regionId = `nav-group-${group.id}`;

              return (
                <div key={group.id}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors text-left',
                      isActive
                        ? 'bg-sidebar-accent text-white'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-white'
                    )}
                    aria-expanded={isOpen}
                    aria-controls={regionId}
                    data-testid={`nav-group-${group.id}`}
                  >
                    <GroupIcon className="w-4 h-4 flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    <ChevronDown className={cn('w-4 h-4 flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
                  </button>

                  {isOpen && (
                    <div id={regionId} className="mt-0.5 space-y-0.5" role="group" aria-label={group.label}>
                      {group.items.map(item => renderNavLink(item, true))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {ungroupedItems.length > 0 && (
          <div className="mt-4 pt-3 border-t border-sidebar-border/60 space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
              Diğer
            </p>
            {ungroupedItems.map(item => renderNavLink(item))}
          </div>
        )}
      </nav>

      <div className="px-4 py-4 border-t border-sidebar-border space-y-2.5">
        <div className="flex items-center gap-2">
          <UserButton appearance={{ elements: { avatarBox: 'w-8 h-8' } }} />
          {role && (
            <span className="text-xs text-sidebar-foreground/70 font-medium truncate flex-1">
              {ROLE_LABELS[role]}
            </span>
          )}
        </div>
        <p
          className="text-[10px] font-mono text-sidebar-foreground/25 pl-0.5"
          aria-label={`TourPilot sürüm ${APP_VERSION}`}
        >
          TourPilot v{APP_VERSION}
        </p>
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
          <aside className="relative flex flex-col w-72 max-w-[86vw] bg-sidebar z-50">
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
            <Button variant="ghost" size="icon" className="relative" aria-label="Bildirimler">
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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-safe">
          {children}
        </main>
      </div>
    </div>
  );
}
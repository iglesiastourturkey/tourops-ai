import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useGetMyProfile } from '@workspace/api-client-react';
import { API_BASE } from '@/lib/clerk-appearance';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'operations'
  | 'guide'
  | 'accounting'
  | 'field_operations';

export interface ProfileContextValue {
  role:              UserRole | null;
  isActive:          boolean;
  isLoading:         boolean;
  /** True when the /api/profiles/me fetch has permanently failed (after retries). */
  isError:           boolean;
  /** Trigger a fresh profile fetch (e.g. after a transient error). */
  refetchProfile:    () => void;
  /** True when the user signed in with a temporary password and must change it. */
  mustChangePassword: boolean;
  /** Flat set of "module.action" strings this user may perform */
  permissionSet:     Set<string>;
  /** true for super_admin — has every possible permission */
  allPermissions:    boolean;
  /** true once the permissions fetch has completed (or role resolved as super_admin) */
  permissionsLoaded: boolean;
}

const ProfileContext = createContext<ProfileContextValue>({
  role:              null,
  isActive:          true,
  isLoading:         true,
  isError:           false,
  refetchProfile:    () => {},
  mustChangePassword: false,
  permissionSet:     new Set(),
  allPermissions:    false,
  permissionsLoaded: false,
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading, isError, refetch: refetchProfile } = useGetMyProfile();
  const { getToken } = useAuth();

  const [permissionSet,     setPermissionSet]     = useState<Set<string>>(new Set());
  const [allPermissions,    setAllPermissions]    = useState(false);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    if (!profile?.role) return;

    if ((profile.role as string) === 'super_admin') {
      setAllPermissions(true);
      setPermissionSet(new Set());
      setPermissionsLoaded(true);
      return;
    }

    let cancelled = false;
    getToken().then(token => {
      if (cancelled || !token) {
        if (!cancelled) setPermissionsLoaded(true); // fallback
        return;
      }
      fetch(`${API_BASE}/profiles/me/permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then((data: { all: boolean; permissions: string[] }) => {
          if (cancelled) return;
          if (data.all) {
            setAllPermissions(true);
          } else {
            setPermissionSet(new Set(data.permissions));
            setAllPermissions(false);
          }
          setPermissionsLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setPermissionsLoaded(true); // non-fatal; show nav anyway
        });
    });

    return () => { cancelled = true; };
  // Re-fetch when profile id or role changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.role]);

  // Stabilise the context value object so consumers only re-render when a
  // field they depend on actually changes, not on every ProfileProvider render.
  // mustChangePassword comes from Clerk's publicMetadata, included in the /me response.
  // Cast needed because the generated Profile type predates this field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mustChangePassword = ((profile as any)?.mustChangePassword as boolean) ?? false;

  const value = useMemo<ProfileContextValue>(() => ({
    role:              (profile?.role as UserRole) ?? null,
    isActive:          profile?.isActive ?? true,
    isLoading,
    isError,
    refetchProfile,
    mustChangePassword,
    permissionSet,
    allPermissions,
    permissionsLoaded,
  }), [profile?.role, profile?.isActive, isLoading, isError, refetchProfile, mustChangePassword, permissionSet, allPermissions, permissionsLoaded]);

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:      'Süper Yönetici',
  admin:            'Yönetici',
  operations:       'Operasyon',
  guide:            'Rehber',
  accounting:       'Muhasebe',
  field_operations: 'Operasyon Merkezi',
};

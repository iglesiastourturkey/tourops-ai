import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { useGetMyProfile, getGetMyProfileQueryKey } from '@workspace/api-client-react';
import { useQuery } from '@tanstack/react-query';
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
  const { getToken, isLoaded, userId } = useAuth();

  // ── Token-ready gate ───────────────────────────────────────────────────────
  // After clerk.setActive() on first sign-in, isLoaded and userId are set
  // immediately, but getToken() can return null for 100–800 ms while Clerk
  // propagates the JWT into browser storage.  Firing the profile query before
  // the token is ready sends a request with no Authorization header, receives
  // a 401, and React Query treats it as a permanent failure (4xx → no retry).
  //
  // Solution: poll getToken() every 200 ms until it returns a real token, then
  // flip tokenReady which enables the profile query.
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenTimedOut, setTokenTimedOut] = useState(false);
  const [tokenProbeAttempt, setTokenProbeAttempt] = useState(0);

  useEffect(() => {
    if (!isLoaded || !userId) {
      setTokenReady(false);
      setTokenTimedOut(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setTokenReady(false);
        setTokenTimedOut(true);
      }
    }, 10_000);

    async function probe() {
      const token = await getToken();
      if (cancelled) return;
      if (token) {
        setTokenReady(true);
        setTokenTimedOut(false);
        clearTimeout(timeout);
      } else {
        // Token not yet available — retry in 200 ms, but never forever.
        // Typically resolves within 1–2 probes after a fresh sign-in.
        timer = setTimeout(() => { void probe(); }, 200);
      }
    }

    void probe();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(timeout);
    };
  // Re-run when the signed-in user changes (sign-out / account switch).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, userId, tokenProbeAttempt]);

  // ── Profile query ──────────────────────────────────────────────────────────
  // enabled: only fire when Clerk is loaded, a user is signed in, AND the
  // token getter is confirmed to return a real JWT.
  //
  // retry: one automatic retry after 1.5 s for transient failures (401, 5xx,
  // network error).  403 (deactivated / forbidden) is a final state — never
  // retry it so the denial screen appears immediately.
  const {
    data: profile,
    isLoading: queryLoading,
    isError: profileQueryError,
    refetch: refetchProfileQuery,
  } = useGetMyProfile({
    query: {
      queryKey: getGetMyProfileQueryKey(),
      enabled: tokenReady,
      retry: (failureCount, error) => {
        // Duck-type: ApiError carries a numeric `status` field.
        const status = (error as { status?: number })?.status;
        if (status === undefined || status === 401 || (status >= 500 && status < 600)) {
          return failureCount < 1; // one retry for network, 401 and 5xx only
        }
        return false; // 403 and all other client errors are final
      },
      retryDelay: 1_500,
    },
  });

  // isLoading is true across three phases:
  //   1. Clerk is still initialising (isLoaded=false)
  //   2. Clerk is ready but the token hasn't propagated yet (tokenReady=false)
  //   3. The profile query is in-flight
  const isLoading = !isLoaded || (!!userId && !tokenReady && !tokenTimedOut) || queryLoading;
  const isError = profileQueryError || tokenTimedOut;

  // ── Permissions fetch ──────────────────────────────────────────────────────
  const profileRole = profile?.role as string | undefined;
  const permissionsQuery = useQuery<{ all: boolean; permissions: string[] }>({
    queryKey: ['profile-permissions', userId, profile?.id, profile?.role],
    enabled: tokenReady && !!profileRole && profileRole !== 'super_admin',
    staleTime: 30_000,
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        const error = new Error('Authentication token is not ready') as Error & { status?: number };
        error.status = 401;
        throw error;
      }

      const response = await fetch(`${API_BASE}/profiles/me/permissions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const error = new Error(`Permission request failed (${response.status})`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      return response.json() as Promise<{ all: boolean; permissions: string[] }>;
    },
    retry: (failureCount, error) => {
      const status = (error as { status?: number })?.status;
      if (status === 403) return false;
      if (status === 401 || status === undefined || (status >= 500 && status < 600)) {
        return failureCount < 1;
      }
      return false;
    },
    retryDelay: 1_500,
  });

  const permissionSet = useMemo(
    () => new Set(permissionsQuery.data?.permissions ?? []),
    [permissionsQuery.data?.permissions],
  );
  const allPermissions = profileRole === 'super_admin' || permissionsQuery.data?.all === true;
  // Errors fail closed: navigation/actions stay hidden rather than appearing
  // authorized when the permissions endpoint is unavailable.
  const permissionsLoaded =
    profileRole === 'super_admin' || permissionsQuery.isSuccess || permissionsQuery.isError;
  const retryProfile = useCallback(() => {
    if (tokenTimedOut) {
      setTokenTimedOut(false);
      setTokenReady(false);
      setTokenProbeAttempt(attempt => attempt + 1);
    }
    void refetchProfileQuery();
  }, [refetchProfileQuery, tokenTimedOut]);

  // ── Context value ──────────────────────────────────────────────────────────
  // Stabilise the object so consumers only re-render when a field they depend
  // on actually changes, not on every ProfileProvider render.
  // mustChangePassword comes from Clerk's publicMetadata, included in /me.
  // Cast needed because the generated Profile type predates this field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mustChangePassword = ((profile as any)?.mustChangePassword as boolean) ?? false;

  const value = useMemo<ProfileContextValue>(() => ({
    role:              (profile?.role as UserRole) ?? null,
    isActive:          profile?.isActive ?? true,
    isLoading,
    isError,
    refetchProfile: retryProfile,
    mustChangePassword,
    permissionSet,
    allPermissions,
    permissionsLoaded,
  }), [profile?.role, profile?.isActive, isLoading, isError, retryProfile, mustChangePassword, permissionSet, allPermissions, permissionsLoaded]);

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

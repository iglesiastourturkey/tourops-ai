import { createContext, useContext } from 'react';
import { useGetMyProfile } from '@workspace/api-client-react';

export type UserRole = 'super_admin' | 'admin' | 'operations' | 'guide' | 'accounting';

export interface ProfileContextValue {
  role: UserRole | null;
  isActive: boolean;
  isLoading: boolean;
}

const ProfileContext = createContext<ProfileContextValue>({
  role: null,
  isActive: true,
  isLoading: true,
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { data: profile, isLoading } = useGetMyProfile();

  const value: ProfileContextValue = {
    role: (profile?.role as UserRole) ?? null,
    isActive: profile?.isActive ?? true,
    isLoading,
  };

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
  super_admin: 'Süper Yönetici',
  admin: 'Yönetici',
  operations: 'Operasyon',
  guide: 'Rehber',
  accounting: 'Muhasebe',
};

/**
 * useNotificationSync — watches the in-app notification list and mirrors
 * critical items to the Browser Notification API.
 *
 * Rules:
 *  - Only fires when permission is 'granted' (never prompts by itself).
 *  - Uses a ref-tracked Set of seen IDs so each notification fires once per
 *    browser session, even across React re-renders.
 *  - Handles: guide_assignment, operation starting-soon, delayed operations,
 *    critical incidents, overdue tasks.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { getListNotificationsQueryKey, useListNotifications } from '@workspace/api-client-react';
import {
  getPermissionStatus,
  notifyGuideAssigned,
  notifyDelayedOperation,
  notifyCriticalIncident,
  notifyOverdueTask,
  notifyOperationStartingSoon,
} from '@/lib/notificationService';

const CRITICAL_TYPES = ['guide_assignment', 'operation', 'system'] as const;

interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string | null;
  isRead: boolean;
}

export function useNotificationSync() {
  const { isLoaded, userId } = useAuth();
  const { data: notifications } = useListNotifications(undefined, {
    query: {
      queryKey: getListNotificationsQueryKey(),
      enabled: isLoaded && !!userId,
    },
  });
  const seenIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (getPermissionStatus() !== 'granted') return;
    if (!notifications?.length) return;

    const unread = (notifications as AppNotification[]).filter((n) => !n.isRead);

    for (const n of unread) {
      if (seenIds.current.has(n.id)) continue;
      seenIds.current.add(n.id);

      // Route to the appropriate notification type
      const titleLower = n.title.toLowerCase();
      const typeLower = n.type.toLowerCase();

      if (typeLower.includes('guide') || titleLower.includes('rehber')) {
        notifyGuideAssigned(n.message ?? n.title);
      } else if (titleLower.includes('gecik') || titleLower.includes('delay')) {
        notifyDelayedOperation(n.message ?? n.title);
      } else if (titleLower.includes('olay') || titleLower.includes('incident') || titleLower.includes('kritik')) {
        notifyCriticalIncident(n.message ?? n.title);
      } else if (titleLower.includes('başlıyor') || titleLower.includes('starting')) {
        notifyOperationStartingSoon(n.title, n.message ?? '');
      } else if (titleLower.includes('görev') || titleLower.includes('task') || titleLower.includes('süre')) {
        notifyOverdueTask(n.message ?? n.title);
      }
      // Non-critical notification types are silently tracked but not shown via browser API
    }
  }, [notifications]);
}

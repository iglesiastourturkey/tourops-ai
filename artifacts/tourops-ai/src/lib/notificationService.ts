/**
 * Browser Notification API wrapper.
 *
 * Rules:
 *  - Permission is NEVER requested on page load.
 *  - Permission is requested only after an explicit user action (button press).
 *  - If the API is not supported or permission is denied, this module is a no-op.
 *  - No Firebase, APNs, or any third-party push provider.
 *
 * Usage:
 *   const ok = await requestNotificationPermission();
 *   if (ok) showNotification('Rehber atandı', { body: 'Efes Turu — bugün saat 09:00' });
 */

const ICON = '/logo.svg';
const BADGE = '/favicon.svg';

// ── Support detection ─────────────────────────────────────────────────────────

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

// ── Permission request ────────────────────────────────────────────────────────

/**
 * Request browser notification permission.
 * Must be called from a user interaction handler (click/tap).
 * Returns the resulting permission status.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotificationSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return 'denied';
  }
}

// ── Show notification ─────────────────────────────────────────────────────────

export interface NotificationPayload {
  title: string;
  body?: string;
  tag?: string; // deduplication key — same tag replaces previous notification
  onClick?: () => void;
}

export function showNotification({ title, body, tag, onClick }: NotificationPayload): void {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return;

  const options: NotificationOptions = {
    body,
    icon: ICON,
    badge: BADGE,
    tag,
    requireInteraction: false,
    silent: false,
  };

  // Prefer SW-based notification for mobile (works when tab is backgrounded)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, options))
      .catch(() => {
        // Fallback to direct Notification if SW fails
        const n = new Notification(title, options);
        if (onClick) n.onclick = onClick;
      });
  } else {
    const n = new Notification(title, options);
    if (onClick) n.onclick = onClick;
  }
}

// ── Notification types ────────────────────────────────────────────────────────

export function notifyGuideAssigned(operationName: string): void {
  showNotification({
    title: 'Rehber Atandı',
    body: operationName,
    tag: `guide-assigned-${operationName}`,
  });
}

export function notifyOperationStartingSoon(operationName: string, timeLabel: string): void {
  showNotification({
    title: 'Operasyon Yakında Başlıyor',
    body: `${operationName} — ${timeLabel}`,
    tag: `starting-soon-${operationName}`,
  });
}

export function notifyDelayedOperation(operationName: string): void {
  showNotification({
    title: '⚠️ Operasyon Gecikti',
    body: operationName,
    tag: `delayed-${operationName}`,
  });
}

export function notifyCriticalIncident(incidentTitle: string): void {
  showNotification({
    title: '🚨 Kritik Olay',
    body: incidentTitle,
    tag: `incident-${incidentTitle}`,
  });
}

export function notifyOverdueTask(taskTitle: string): void {
  showNotification({
    title: '⏰ Görev Süresi Geçti',
    body: taskTitle,
    tag: `overdue-${taskTitle}`,
  });
}

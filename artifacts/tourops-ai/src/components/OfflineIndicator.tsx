/**
 * OfflineIndicator — compact network status badge for the AppShell header.
 *
 * Shows:
 *  - Orange "Çevrimdışı" pill when offline
 *  - Amber "N işlem bekliyor" badge when there are queued actions
 *  - Spinning retry indicator when auto-retry is running
 */
import { WifiOff, RefreshCw, Clock } from 'lucide-react';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineQueue } from '@/contexts/OfflineQueueContext';
import { cn } from '@/lib/utils';
import { Link } from 'wouter';

export function OfflineIndicator() {
  const { isOnline } = useNetworkStatus();
  const { pendingCount, isRetrying, retryAll } = useOfflineQueue();

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      {!isOnline && (
        <span className="flex items-center gap-1 text-[10px] font-semibold bg-orange-500 text-white rounded-full px-2 py-0.5">
          <WifiOff className="w-3 h-3" />
          Çevrimdışı
        </span>
      )}

      {pendingCount > 0 && (
        <Link
          href="/field/pending-actions"
          title={`${pendingCount} bekleyen işlem`}
          className={cn(
            'flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 transition-colors',
            isOnline
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-amber-100 text-amber-700 cursor-default',
          )}
        >
          {isRetrying ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Clock className="w-3 h-3" />
          )}
          {pendingCount} bekliyor
        </Link>
      )}
    </div>
  );
}

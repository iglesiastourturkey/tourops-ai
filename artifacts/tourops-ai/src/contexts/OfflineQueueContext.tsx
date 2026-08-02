/**
 * OfflineQueueContext — React context that manages the offline action queue.
 *
 * Consumers:
 *  - `useOfflineQueue()` — access queue state and helpers
 *  - Wrap the app with `<OfflineQueueProvider>` once in App.tsx
 *
 * Retry behaviour:
 *  - Automatic retry when `window.online` fires
 *  - Manual retry via `retryAll()`
 *  - Actions are deduplicated by idempotencyKey before being added
 *  - Successful retries are removed; failed retries stay and increment retryCount
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import {
  type ActionType,
  type PendingAction,
  addAction,
  bumpRetry,
  generateId,
  getAllActions,
  hasActionWithKey,
  makeIdempotencyKey,
  removeAction,
} from '@/lib/offlineQueue';
import { customFetch } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueNewAction {
  url: string;
  method: string;
  body?: Record<string, unknown> | null;
  type: ActionType;
  label: string;
  operationId?: number;
}

interface OfflineQueueContextValue {
  pending: PendingAction[];
  pendingCount: number;
  isRetrying: boolean;
  /** Add a failed action to the queue. Returns false if already queued. */
  queueAction: (action: QueueNewAction) => Promise<boolean>;
  retryAll: () => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
}

const ctx = createContext<OfflineQueueContextValue>({
  pending: [],
  pendingCount: 0,
  isRetrying: false,
  queueAction: async () => false,
  retryAll: async () => {},
  removeFromQueue: async () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryingRef = useRef(false);
  const { toast } = useToast();

  // Load queue from IndexedDB on mount
  useEffect(() => {
    getAllActions().then(setPending).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const all = await getAllActions();
    setPending(all);
    return all;
  }, []);

  const queueAction = useCallback(async (action: QueueNewAction): Promise<boolean> => {
    const bodyJson = action.body ? JSON.stringify(action.body) : null;
    const iKey = makeIdempotencyKey(action.method, action.url, bodyJson);

    // Deduplication — don't queue the same action twice
    const already = await hasActionWithKey(iKey);
    if (already) return false;

    const pending: PendingAction = {
      id: generateId(),
      idempotencyKey: iKey,
      url: action.url,
      method: action.method,
      bodyJson,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': iKey },
      type: action.type,
      label: action.label,
      operationId: action.operationId,
      createdAt: Date.now(),
      retryCount: 0,
    };

    await addAction(pending);
    await refresh();
    return true;
  }, [refresh]);

  const retryAll = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setIsRetrying(true);

    try {
      const actions = await refresh();
      if (actions.length === 0) return;

      let successCount = 0;
      let failCount = 0;

      for (const action of actions) {
        try {
          await customFetch(action.url, {
            method: action.method as 'POST' | 'PATCH' | 'PUT' | 'DELETE',
            headers: action.headers,
            body: action.bodyJson ? JSON.parse(action.bodyJson) : undefined,
          });
          await removeAction(action.id);
          successCount++;
        } catch {
          await bumpRetry(action.id);
          failCount++;
        }
      }

      await refresh();

      if (successCount > 0) {
        toast({
          title: `${successCount} işlem senkronize edildi`,
          description: failCount > 0 ? `${failCount} işlem tekrar deneniyor` : undefined,
        });
      }
    } finally {
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }, [refresh, toast]);

  const removeFromQueue = useCallback(async (id: string) => {
    await removeAction(id);
    await refresh();
  }, [refresh]);

  // Auto-retry on reconnect
  useEffect(() => {
    const onOnline = () => { void retryAll(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [retryAll]);

  return (
    <ctx.Provider value={{
      pending,
      pendingCount: pending.length,
      isRetrying,
      queueAction,
      retryAll,
      removeFromQueue,
    }}>
      {children}
    </ctx.Provider>
  );
}

export function useOfflineQueue() {
  return useContext(ctx);
}

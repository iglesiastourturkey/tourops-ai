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
  rebaseNextAction,
  updateAction,
  makeFreshIdempotencyKey,
} from '@/lib/offlineQueue';
import { customFetch } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@clerk/react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueNewAction {
  url: string;
  method: string;
  body?: Record<string, unknown> | null;
  type: ActionType;
  label: string;
  operationId?: number;
  expectedVersion?: number;
}

interface OfflineQueueContextValue {
  pending: PendingAction[];
  pendingCount: number;
  isRetrying: boolean;
  /** Add a failed action to the queue. Returns false if already queued. */
  queueAction: (action: QueueNewAction) => Promise<boolean>;
  retryAll: () => Promise<void>;
  removeFromQueue: (id: string) => Promise<void>;
  resendAsNew: (id: string) => Promise<boolean>;
  checkServerState: (id: string) => Promise<unknown>;
}

const ctx = createContext<OfflineQueueContextValue>({
  pending: [],
  pendingCount: 0,
  isRetrying: false,
  queueAction: async () => false,
  retryAll: async () => {},
  removeFromQueue: async () => {},
  resendAsNew: async () => false,
  checkServerState: async () => null,
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function OfflineQueueProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryingRef = useRef(false);
  const { toast } = useToast();
  const { userId } = useAuth();

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
      userId: userId ?? undefined,
      expectedVersion: action.expectedVersion,
      createdAt: Date.now(),
      retryCount: 0,
      status: 'pending',
    };

    await addAction(pending);
    await refresh();
    return true;
  }, [refresh, userId]);

  const retryAll = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setIsRetrying(true);

    try {
      const actions = await refresh();
      if (actions.length === 0) return;

      let successCount = 0;
      let failCount = 0;

      const blockedOperations = new Set<number>();
      for (const action of actions) {
        // Preserve FIFO within one operation. A failed earlier mutation blocks
        // later same-operation mutations until the user resolves it.
        if (action.operationId && blockedOperations.has(action.operationId)) continue;
        if (action.status === 'ambiguous' || action.status === 'conflict') continue;
        await updateAction(action.id, { status: 'sending', lastError: undefined });
        try {
          const result = await customFetch(action.url, {
            method: action.method as 'POST' | 'PATCH' | 'PUT' | 'DELETE',
            headers: action.headers,
            body: action.bodyJson ? JSON.parse(action.bodyJson) : undefined,
          });
          const responseVersion = result && typeof result === 'object'
            ? (result as { version?: unknown }).version
            : undefined;
          await removeAction(action.id);
          if (action.operationId && typeof responseVersion === 'number') {
            await rebaseNextAction(action.operationId, action.id, responseVersion);
          }
          successCount++;
        } catch (error) {
          const status = error && typeof error === 'object' && 'status' in error
            ? Number((error as { status: number }).status)
            : undefined;
          const data = error && typeof error === 'object' && 'data' in error
            ? (error as { data?: unknown }).data
            : undefined;
          const message = data && typeof data === 'object' && 'error' in data
            ? String((data as { error: unknown }).error)
            : error instanceof Error ? error.message : 'Senkronizasyon başarısız';

          if (status === 409) {
            await updateAction(action.id, {
              status: 'conflict',
              lastError: message,
              lastResponse: data,
            });
            if (action.operationId) blockedOperations.add(action.operationId);
          } else if (status && status >= 500) {
            // A cached 5xx is ambiguous: it may have reached the server.
            await updateAction(action.id, {
              status: 'ambiguous',
              lastError: message,
              lastResponse: data,
            });
            if (action.operationId) blockedOperations.add(action.operationId);
          } else if (status && status >= 400) {
            await updateAction(action.id, { status: 'error', lastError: message, lastResponse: data });
            if (action.operationId) blockedOperations.add(action.operationId);
          } else {
            await bumpRetry(action.id);
            await updateAction(action.id, { status: 'pending', lastError: message });
            if (action.operationId) blockedOperations.add(action.operationId);
          }
          failCount++;
        }
      }

      await refresh();

      if (successCount > 0) {
        toast({
          title: `${successCount} işlem senkronize edildi`,
          description: failCount > 0 ? `${failCount} işlem incelenmeyi bekliyor` : undefined,
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

  const resendAsNew = useCallback(async (id: string) => {
    const action = (await getAllActions()).find(item => item.id === id);
    if (!action || action.status !== 'ambiguous') return false;
    const key = makeFreshIdempotencyKey();
    const headers = { ...action.headers, 'Idempotency-Key': key };
    await addAction({
      ...action,
      id: generateId(),
      idempotencyKey: key,
      headers,
      createdAt: Date.now(),
      retryCount: 0,
      status: 'pending',
      lastError: undefined,
      lastResponse: undefined,
    });
    await refresh();
    return true;
  }, [refresh]);

  const checkServerState = useCallback(async (id: string) => {
    const action = (await getAllActions()).find(item => item.id === id);
    if (!action) return null;
    const match = action.url.match(/^(.*)\/(operations|incidents)\/(\d+)(?:\/.*)?$/);
    const url = match
      ? `${match[1]}/${match[2]}/${match[3]}`
      : action.url.replace(/\/(status|tasks\/\d+|notes)$/, '');
    return customFetch(url, { method: 'GET' });
  }, []);

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
      resendAsNew,
      checkServerState,
    }}>
      {children}
    </ctx.Provider>
  );
}

export function useOfflineQueue() {
  return useContext(ctx);
}

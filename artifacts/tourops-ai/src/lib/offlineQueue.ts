/**
 * Offline queue — IndexedDB-backed store for mutations that fail while offline.
 *
 * Design:
 *  - DB name : tourpilot-offline-queue
 *  - Store   : pending-actions
 *  - Each action is identified by a UUID and an idempotencyKey (prevents
 *    duplicate submissions when the same action is retried multiple times).
 *  - Retry happens automatically when the browser fires the `online` event;
 *    the `OfflineQueueContext` drives this.
 */

export type ActionType =
  | 'field_note'
  | 'task_update'
  | 'incident'
  | 'incident_update'
  | 'status_update'
  | 'location'
  | 'receipt_draft';

export interface PendingAction {
  id: string;              // UUID v4
  idempotencyKey: string;  // hash(method+url+body) — prevents double-queue
  url: string;
  method: string;          // POST | PATCH | PUT | DELETE
  bodyJson: string | null; // JSON.stringify(body) or null
  headers: Record<string, string>;
  type: ActionType;
  label: string;           // Turkish description shown in the UI
  operationId?: number;
  userId?: string;
  expectedVersion?: number;
  createdAt: number;       // Date.now()
  retryCount: number;
  status: 'pending' | 'sending' | 'error' | 'conflict' | 'ambiguous';
  lastError?: string;
  lastResponse?: unknown;
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

const DB_NAME = 'tourpilot-offline-queue';
const DB_VERSION = 2;
const STORE_NAME = 'pending-actions';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Return all pending actions, oldest first. */
export async function getAllActions(): Promise<PendingAction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readonly');
    const store = t.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = (req.result as PendingAction[]).sort((a, b) => a.createdAt - b.createdAt);
      resolve(rows);
      db.close();
    };
    req.onerror = () => reject(req.error);
  });
}

export function addAction(action: PendingAction): Promise<PendingAction> {
  return tx('readwrite', (store) => store.put(action)).then(() => action);
}

export function removeAction(id: string): Promise<undefined> {
  return tx('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function updateAction(
  id: string,
  changes: Partial<PendingAction>,
): Promise<PendingAction | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readwrite');
    const store = t.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const action = getReq.result as PendingAction | undefined;
      if (!action) {
        resolve(undefined);
        return;
      }
      const next = { ...action, ...changes };
      const putReq = store.put(next);
      putReq.onsuccess = () => resolve(next);
    };
    getReq.onerror = () => reject(getReq.error);
    t.oncomplete = () => db.close();
    t.onerror = () => reject(t.error);
  });
}

export async function rebaseNextAction(
  operationId: number,
  completedActionId: string,
  version: number,
): Promise<PendingAction | undefined> {
  const actions = await getAllActions();
  const next = actions.find(
    (action) =>
      action.id !== completedActionId &&
      action.operationId === operationId &&
      action.createdAt > (actions.find(a => a.id === completedActionId)?.createdAt ?? -1) &&
      action.status !== 'ambiguous' &&
      action.status !== 'conflict',
  );
  if (!next || !next.bodyJson) return next;
  try {
    const body = JSON.parse(next.bodyJson) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(body, 'expectedVersion')) return next;
    body.expectedVersion = version;
    return updateAction(next.id, { bodyJson: JSON.stringify(body), expectedVersion: version });
  } catch {
    return next;
  }
}

export async function hasActionWithKey(idempotencyKey: string): Promise<boolean> {
  const all = await getAllActions();
  return all.some((a) => a.idempotencyKey === idempotencyKey);
}

/** Increment the retryCount and update lastAttempt for a given action. */
export async function bumpRetry(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_NAME, 'readwrite');
    const store = t.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const action = getReq.result as PendingAction | undefined;
      if (!action) { resolve(); return; }
      action.retryCount += 1;
      store.put(action);
      t.oncomplete = () => { db.close(); resolve(); };
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Simple but sufficient idempotency key from method + url + body. */
export function makeIdempotencyKey(method: string, url: string, bodyJson: string | null): string {
  const raw = `${method}|${url}|${bodyJson ?? ''}`;
  // djb2 hash — good enough for deduplication
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h) ^ raw.charCodeAt(i);
    h = h >>> 0; // keep 32-bit unsigned
  }
  return h.toString(16);
}

/** A fresh key is required when an ambiguous action is intentionally sent as a new action. */
export function makeFreshIdempotencyKey(): string {
  return `offline-${generateId()}`;
}

export function isNetworkError(error: unknown): boolean {
  return !(error && typeof error === 'object' && 'status' in error);
}

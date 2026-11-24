
export const STORE_COLLECTIONS = Object.freeze([
  'users', 'applications', 'members', 'events', 'announcements', 'audit',
  'privacyRequests', 'snapshots', 'messageLogs', 'accountRequests',
]);

const REVISION_COLLECTION = '_system';
const REVISION_DOCUMENT = 'store';
const MAX_TRANSACTION_WRITES = 450;
const MAX_DOCUMENT_BYTES = 900_000;

const clone = (value) => JSON.parse(JSON.stringify(value));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

function defaults(defaultStore) {
  const base = defaultStore();
  for (const name of STORE_COLLECTIONS) if (!Array.isArray(base[name])) base[name] = [];
  return base;
}

function readRevision(snapshot) {
  const revision = Number(snapshot?.exists ? snapshot.data()?.revision ?? 0 : 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('A revisão de persistência do Firestore está inválida.');
  }
  return revision;
}

function snapshotToStore(querySnapshots, settingsSnapshot, defaultStore, revision) {
  const data = defaults(defaultStore);
  STORE_COLLECTIONS.forEach((name, index) => {
    data[name] = querySnapshots[index].docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  });
  if (settingsSnapshot.exists) data.settings = { ...data.settings, ...settingsSnapshot.data() };
  data.__firestoreRevision = revision;
  return data;
}

async function readAllStoreData(transaction, db, defaultStore, revision) {
  const [querySnapshots, settingsSnapshot] = await Promise.all([
    Promise.all(STORE_COLLECTIONS.map((name) => transaction.get(db.collection(name)))),
    transaction.get(db.collection('settings').doc('main')),
  ]);
  return snapshotToStore(querySnapshots, settingsSnapshot, defaultStore, revision);
}

/** Loads a transactionally consistent startup snapshot and its shared revision. */
export async function loadStoreFromFirestore(db, defaultStore) {
  const revisionRef = db.collection(REVISION_COLLECTION).doc(REVISION_DOCUMENT);
  return db.runTransaction(async (transaction) => {
    const revision = readRevision(await transaction.get(revisionRef));
    return readAllStoreData(transaction, db, defaultStore, revision);
  }, { maxAttempts: 8 });
}

/** Refreshes a server instance only when another instance has advanced the shared revision. */
export async function refreshStoreFromFirestoreIfChanged(db, targetStore, defaultStore) {
  const revisionRef = db.collection(REVISION_COLLECTION).doc(REVISION_DOCUMENT);
  const remoteRevision = readRevision(await revisionRef.get());
  const localRevision = Number.isSafeInteger(targetStore.__firestoreRevision)
    ? targetStore.__firestoreRevision
    : -1;
  if (remoteRevision === localRevision) return false;
  const latest = await loadStoreFromFirestore(db, defaultStore);
  syncStoreObject(targetStore, latest);
  return true;
}

/**
 * Keeps references to existing objects so routes holding an object reference remain valid.
 * The internal revision is kept in memory and is never written into business collections.
 */
export function syncStoreObject(target, source) {
  for (const name of STORE_COLLECTIONS) {
    const existing = new Map((target[name] || []).map((item) => [item.id, item]));
    target[name] = (source[name] || []).map((incoming) => {
      const current = existing.get(incoming.id);
      if (!current) return clone(incoming);
      for (const key of Object.keys(current)) delete current[key];
      Object.assign(current, clone(incoming));
      return current;
    });
  }
  target.settings = { ...(source.settings || {}) };
  target.__firestoreRevision = Number(source.__firestoreRevision ?? 0);
}

function collectChanges(before, after) {
  const changes = [];
  for (const name of STORE_COLLECTIONS) {
    const oldById = new Map((before[name] || []).map((item) => [item.id, item]));
    const newById = new Map((after[name] || []).map((item) => [item.id, item]));
    for (const [docId] of oldById) {
      if (!newById.has(docId)) changes.push({ type: 'delete', collection: name, id: docId });
    }
    for (const [docId, value] of newById) {
      const oldValue = oldById.get(docId);
      if (!oldById.has(docId) || !same(oldValue, value)) {
        changes.push({ type: 'set', collection: name, id: docId, data: value });
      }
    }
  }
  if (!same(before.settings || {}, after.settings || {})) {
    changes.push({ type: 'set', collection: 'settings', id: 'main', data: after.settings || {} });
  }
  return changes;
}

/**
 * Executes a mutation under a shared Firestore revision lock.
 * A normal write reads one metadata document and persists only the changed records.
 * If another server instance has committed since this instance last synchronized,
 * the store is refreshed inside the same transaction before the callback is re-applied.
 *
 * The callback may be re-applied after a transaction retry. Keep it limited to in-memory
 * store changes; do not perform network calls, send messages, or other external side effects
 * inside it. The STAR PARK routes currently use it only for in-memory mutations.
 */
export async function mutateStoreInFirestore(db, targetStore, fn, defaultStore) {
  const initialSnapshot = clone(targetStore);
  const expectedRevision = Number.isSafeInteger(targetStore.__firestoreRevision)
    ? targetStore.__firestoreRevision
    : -1;
  const revisionRef = db.collection(REVISION_COLLECTION).doc(REVISION_DOCUMENT);
  let rollbackSnapshot = initialSnapshot;

  try {
    const committed = await db.runTransaction(async (transaction) => {
      const revision = readRevision(await transaction.get(revisionRef));
      let latest;

      if (revision === expectedRevision) {
        // Reuse the in-memory snapshot: no collection reads on the normal write path.
        latest = clone(initialSnapshot);
        latest.__firestoreRevision = revision;
      } else {
        // Another process wrote since this instance's last successful mutation.
        // Refresh inside this transaction so validation and persistence share one snapshot.
        latest = await readAllStoreData(transaction, db, defaultStore, revision);
      }

      rollbackSnapshot = clone(latest);
      syncStoreObject(targetStore, latest);
      const before = clone(latest);
      const result = await fn();
      const after = clone(targetStore);
      const changes = collectChanges(before, after);

      if (changes.length > MAX_TRANSACTION_WRITES) {
        throw new Error(`Esta operação alteraria mais de ${MAX_TRANSACTION_WRITES} documentos. Divida a operação em lotes.`);
      }

      for (const change of changes) {
        const ref = db.collection(change.collection).doc(change.id);
        if (change.type === 'delete') {
          transaction.delete(ref);
          continue;
        }
        const size = Buffer.byteLength(JSON.stringify(change.data), 'utf8');
        if (size > MAX_DOCUMENT_BYTES) {
          throw new Error(`O registro ${change.collection}/${change.id} está próximo do limite de tamanho de um documento Firestore.`);
        }
        transaction.set(ref, change.data);
      }

      const nextRevision = revision + 1;
      transaction.set(revisionRef, { revision: nextRevision, updatedAt: new Date().toISOString() });
      return { result, revision: nextRevision };
    }, { maxAttempts: 8 });

    targetStore.__firestoreRevision = committed.revision;
    return committed.result;
  } catch (error) {
    syncStoreObject(targetStore, rollbackSnapshot);
    throw error;
  }
}

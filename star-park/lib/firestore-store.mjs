export const STORE_COLLECTIONS = Object.freeze([
  'users', 'applications', 'members', 'events', 'announcements', 'audit',
  'privacyRequests', 'snapshots', 'messageLogs',
]);

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

function snapshotToStore(querySnapshots, settingsSnapshot, defaultStore) {
  const data = defaults(defaultStore);
  STORE_COLLECTIONS.forEach((name, index) => {
    data[name] = querySnapshots[index].docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  });
  if (settingsSnapshot.exists) data.settings = { ...data.settings, ...settingsSnapshot.data() };
  return data;
}

/** Carrega documentos por registro. Dados privados nunca são lidos diretamente pelo navegador. */
export async function loadStoreFromFirestore(db, defaultStore) {
  const refs = STORE_COLLECTIONS.map((name) => db.collection(name));
  const [querySnapshots, settingsSnapshot] = await Promise.all([
    Promise.all(refs.map((ref) => ref.get())),
    db.collection('settings').doc('main').get(),
  ]);
  return snapshotToStore(querySnapshots, settingsSnapshot, defaultStore);
}

/** Mantém referências aos objetos existentes para que as rotas possam revalidar objetos capturados. */
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
}

function collectChanges(before, after) {
  const changes = [];
  for (const name of STORE_COLLECTIONS) {
    const oldById = new Map((before[name] || []).map((item) => [item.id, item]));
    const newById = new Map((after[name] || []).map((item) => [item.id, item]));
    for (const [docId, oldValue] of oldById) {
      if (!newById.has(docId)) changes.push({ type: 'delete', collection: name, id: docId });
      else if (!same(oldValue, newById.get(docId))) changes.push({ type: 'set', collection: name, id: docId, data: newById.get(docId) });
    }
    for (const [docId, value] of newById) {
      if (!oldById.has(docId)) changes.push({ type: 'set', collection: name, id: docId, data: value });
    }
  }
  if (!same(before.settings || {}, after.settings || {})) {
    changes.push({ type: 'set', collection: 'settings', id: 'main', data: after.settings || {} });
  }
  return changes;
}

/**
 * Executa as mutações existentes da STAR PARK dentro de uma transação Firestore.
 * O modelo atual carrega os registros na memória; a transação relê o estado mais recente
 * antes de cada gravação e persiste somente os documentos alterados.
 */
export async function mutateStoreInFirestore(db, targetStore, fn, defaultStore) {
  let latestSnapshot = clone(targetStore);
  try {
    return await db.runTransaction(async (transaction) => {
    const refs = STORE_COLLECTIONS.map((name) => db.collection(name));
    const [querySnapshots, settingsSnapshot] = await Promise.all([
      Promise.all(refs.map((ref) => transaction.get(ref))),
      transaction.get(db.collection('settings').doc('main')),
    ]);
    const latest = snapshotToStore(querySnapshots, settingsSnapshot, defaultStore);
    const before = clone(latest);
    latestSnapshot = clone(latest);
    syncStoreObject(targetStore, latest);

    const result = await fn();
    const after = clone(targetStore);
    const changes = collectChanges(before, after);
    if (changes.length > 450) {
      syncStoreObject(targetStore, latest);
      throw new Error('Esta operação alteraria mais de 450 documentos. Divida a operação ou faça a migração em lotes.');
    }

    for (const change of changes) {
      const ref = db.collection(change.collection).doc(change.id);
      if (change.type === 'delete') transaction.delete(ref);
      else {
        const size = Buffer.byteLength(JSON.stringify(change.data), 'utf8');
        if (size > 900_000) throw new Error(`O registro ${change.collection}/${change.id} está próximo do limite de tamanho de um documento Firestore.`);
        transaction.set(ref, change.data);
      }
    }
    return result;
    }, { maxAttempts: 8 });
  } catch (error) {
    syncStoreObject(targetStore, latestSnapshot);
    throw error;
  }
}

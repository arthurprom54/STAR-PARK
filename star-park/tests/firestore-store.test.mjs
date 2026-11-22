import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStoreFromFirestore, mutateStoreInFirestore } from '../lib/firestore-store.mjs';
import { createFirestoreDb } from '../lib/firebase-admin.mjs';

const names = ['users','applications','members','events','announcements','audit','privacyRequests','snapshots','messageLogs','settings'];

class FakeDocumentSnapshot {
  constructor(id, value) { this.id = id; this.value = value; this.exists = value !== undefined; }
  data() { return this.value; }
}

class FakeQuerySnapshot {
  constructor(docs) { this.docs = docs; this.empty = docs.length === 0; }
}

class FakeDocumentReference {
  constructor(db, collection, id) { this.db = db; this.collectionName = collection; this.id = id; this.kind = 'document'; }
  async get() { return new FakeDocumentSnapshot(this.id, this.db.data.get(this.collectionName)?.get(this.id)); }
}

class FakeCollectionReference {
  constructor(db, name) { this.db = db; this.name = name; this.kind = 'collection'; }
  doc(id) { return new FakeDocumentReference(this.db, this.name, id); }
  async get() {
    const values = [...(this.db.data.get(this.name) || new Map())];
    return new FakeQuerySnapshot(values.map(([id, value]) => ({ id, data: () => value })));
  }
}

class FakeFirestore {
  constructor() { this.data = new Map(names.map((name) => [name, new Map()])); }
  collection(name) { return new FakeCollectionReference(this, name); }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => {
        const collection = this.data.get(ref.name || ref.collectionName) || new Map();
        if (ref.kind === 'collection') {
          return new FakeQuerySnapshot([...collection].map(([id, value]) => ({ id, data: () => value })));
        }
        return new FakeDocumentSnapshot(ref.id, collection.get(ref.id));
      },
      set: (ref, value) => writes.push({ type: 'set', ref, value }),
      delete: (ref) => writes.push({ type: 'delete', ref }),
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const collection = this.data.get(write.ref.collectionName);
      if (write.type === 'delete') collection.delete(write.ref.id);
      else collection.set(write.ref.id, structuredClone(write.value));
    }
    return result;
  }
}

const makeStore = () => ({
  users: [], applications: [], members: [], events: [], announcements: [], audit: [],
  privacyRequests: [], snapshots: [], messageLogs: [],
  settings: { recruitmentOpen: false, reservationHours: 72 },
});

test('Firestore carrega coleções em listas e configurações no documento settings/main', async () => {
  const db = new FakeFirestore();
  db.data.get('members').set('m1', { id: 'm1', displayName: 'Membro' });
  db.data.get('settings').set('main', { recruitmentOpen: true, reservationHours: 48 });
  const loaded = await loadStoreFromFirestore(db, makeStore);
  assert.equal(loaded.members.length, 1);
  assert.equal(loaded.members[0].id, 'm1');
  assert.equal(loaded.settings.recruitmentOpen, true);
  assert.equal(loaded.settings.reservationHours, 48);
});

test('mutação Firestore grava somente o estado alterado e mantém referência do membro', async () => {
  const db = new FakeFirestore();
  db.data.get('members').set('m1', { id: 'm1', displayName: 'Nome antigo', status: 'ACTIVE' });
  const store = await loadStoreFromFirestore(db, makeStore);
  const heldMember = store.members[0];
  await mutateStoreInFirestore(db, store, () => {
    store.members[0].displayName = 'Nome novo';
    store.settings.recruitmentOpen = true;
    store.audit.push({ id: 'a1', action: 'Teste' });
  }, makeStore);
  assert.equal(store.members[0], heldMember);
  assert.equal(db.data.get('members').get('m1').displayName, 'Nome novo');
  assert.equal(db.data.get('settings').get('main').recruitmentOpen, true);
  assert.equal(db.data.get('audit').get('a1').action, 'Teste');
});

test('falha em uma mutação reverte alterações locais e não grava dados', async () => {
  const db = new FakeFirestore();
  const store = makeStore();
  await assert.rejects(() => mutateStoreInFirestore(db, store, () => {
    store.members.push({ id: 'm-falha', displayName: 'Não persistir' });
    throw new Error('falha simulada');
  }, makeStore), /falha simulada/);
  assert.equal(store.members.length, 0);
  assert.equal(db.data.get('members').size, 0);
});

test('Firebase exige credenciais de serviço e não tenta inicializar com segredo ausente', async () => {
  await assert.rejects(() => createFirestoreDb({}), /Configure FIREBASE_SERVICE_ACCOUNT_JSON/);
  await assert.rejects(() => createFirestoreDb({ FIREBASE_SERVICE_ACCOUNT_JSON: 'null' }), /objeto JSON de conta de serviço/);
});

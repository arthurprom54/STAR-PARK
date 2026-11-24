
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_COLLECTIONS, loadStoreFromFirestore, mutateStoreInFirestore, refreshStoreFromFirestoreIfChanged } from '../lib/firestore-store.mjs';

const META_COLLECTION = '_system';
const META_DOCUMENT = 'store';
const SETTINGS_COLLECTION = 'settings';

class FakeDocumentSnapshot {
  constructor(id, value) { this.id = id; this.value = value; this.exists = value !== undefined; }
  data() { return this.value; }
}

class FakeQuerySnapshot {
  constructor(docs) { this.docs = docs; this.empty = docs.length === 0; }
}

class FakeDocumentReference {
  constructor(db, collectionName, id) {
    this.db = db;
    this.collectionName = collectionName;
    this.name = collectionName;
    this.id = id;
    this.kind = 'document';
  }
  async get() { return new FakeDocumentSnapshot(this.id, this.db.data.get(this.collectionName)?.get(this.id)); }
}

class FakeCollectionReference {
  constructor(db, name) { this.db = db; this.name = name; this.kind = 'collection'; }
  doc(id) { return new FakeDocumentReference(this.db, this.name, id); }
}

class FakeFirestore {
  constructor() {
    this.data = new Map([...STORE_COLLECTIONS, SETTINGS_COLLECTION, META_COLLECTION]
      .map((name) => [name, new Map()]));
    this.collectionReads = 0;
    this.failNextCommit = false;
  }

  collection(name) {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return new FakeCollectionReference(this, name);
  }

  async runTransaction(callback, options = {}) {
    const maxAttempts = options.maxAttempts || 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const writes = [];
      const validations = [];
      const transaction = {
        get: async (ref) => {
          const collection = this.data.get(ref.name || ref.collectionName) || new Map();
          if (ref.kind === 'collection') {
            this.collectionReads += 1;
            const captured = [...collection].map(([id, value]) => [id, structuredClone(value)]);
            validations.push(() => {
              const current = [...(this.data.get(ref.name) || new Map())].map(([id, value]) => [id, structuredClone(value)]);
              return JSON.stringify(current) === JSON.stringify(captured);
            });
            return new FakeQuerySnapshot(captured.map(([id, value]) => ({ id, data: () => value })));
          }
          const captured = collection.has(ref.id) ? structuredClone(collection.get(ref.id)) : undefined;
          validations.push(() => {
            const current = this.data.get(ref.collectionName)?.get(ref.id);
            return JSON.stringify(current ?? null) === JSON.stringify(captured ?? null);
          });
          return new FakeDocumentSnapshot(ref.id, captured);
        },
        set: (ref, value) => writes.push({ type: 'set', ref, value: structuredClone(value) }),
        delete: (ref) => writes.push({ type: 'delete', ref }),
      };

      const result = await callback(transaction);
      if (this.failNextCommit) {
        this.failNextCommit = false;
        throw new Error('falha simulada de commit');
      }
      if (!validations.every((validate) => validate())) continue;
      for (const write of writes) {
        const collection = this.data.get(write.ref.collectionName);
        if (write.type === 'delete') collection.delete(write.ref.id);
        else collection.set(write.ref.id, write.value);
      }
      return result;
    }
    throw new Error('ABORTED: limite de tentativas da transação excedido');
  }
}

const makeStore = () => ({
  users: [], applications: [], members: [], events: [], announcements: [], audit: [],
  privacyRequests: [], snapshots: [], messageLogs: [], accountRequests: [],
  settings: { recruitmentOpen: true, recruitmentClosedMessage: 'Inscrições fechadas.', reservationHours: 72 },
});

const revisionOf = (db) => db.data.get(META_COLLECTION).get(META_DOCUMENT)?.revision ?? 0;

test('carrega uma fotografia consistente, configurações e revisão do Firestore', async () => {
  const db = new FakeFirestore();
  db.data.get('members').set('m1', { displayName: 'Membro' });
  db.data.get('settings').set('main', { recruitmentOpen: false, reservationHours: 48 });
  db.data.get(META_COLLECTION).set(META_DOCUMENT, { revision: 7 });

  const loaded = await loadStoreFromFirestore(db, makeStore);
  assert.equal(loaded.members.length, 1);
  assert.equal(loaded.members[0].id, 'm1');
  assert.equal(loaded.settings.recruitmentOpen, false);
  assert.equal(loaded.settings.reservationHours, 48);
  assert.equal(loaded.__firestoreRevision, 7);
  assert.equal(db.collectionReads, STORE_COLLECTIONS.length);
});

test('grava apenas documentos alterados sem reler todas as coleções em cada mutação', async () => {
  const db = new FakeFirestore();
  db.data.get('members').set('m1', { displayName: 'Nome antigo', status: 'ACTIVE' });
  const store = await loadStoreFromFirestore(db, makeStore);
  const heldMember = store.members[0];
  db.collectionReads = 0;

  await mutateStoreInFirestore(db, store, () => {
    store.members[0].displayName = 'Nome novo';
    store.settings.recruitmentOpen = false;
    store.audit.push({ id: 'a1', action: 'Teste' });
  }, makeStore);

  assert.equal(db.collectionReads, 0);
  assert.equal(store.members[0], heldMember);
  assert.equal(db.data.get('members').get('m1').displayName, 'Nome novo');
  assert.equal(db.data.get('settings').get('main').recruitmentOpen, false);
  assert.equal(db.data.get('audit').get('a1').action, 'Teste');
  assert.equal(revisionOf(db), 1);

  await mutateStoreInFirestore(db, store, () => {
    store.events.push({ id: 'e1', title: 'Evento' });
  }, makeStore);
  assert.equal(db.collectionReads, 0, 'a segunda gravação também não deve reler coleções');
  assert.equal(revisionOf(db), 2);
});


test('checagem de revisão detecta mudanças externas e evita releitura quando nada mudou', async () => {
  const db = new FakeFirestore();
  const first = await loadStoreFromFirestore(db, makeStore);
  const second = await loadStoreFromFirestore(db, makeStore);
  db.collectionReads = 0;

  assert.equal(await refreshStoreFromFirestoreIfChanged(db, second, makeStore), false);
  assert.equal(db.collectionReads, 0);

  await mutateStoreInFirestore(db, first, () => {
    first.applications.push({ id: 'app-refresh', status: 'PENDING' });
  }, makeStore);

  assert.equal(await refreshStoreFromFirestoreIfChanged(db, second, makeStore), true);
  assert.equal(second.applications.some((application) => application.id === 'app-refresh'), true);
  assert.equal(db.collectionReads, STORE_COLLECTIONS.length);
  db.collectionReads = 0;
  assert.equal(await refreshStoreFromFirestoreIfChanged(db, second, makeStore), false);
  assert.equal(db.collectionReads, 0);
});

test('instância desatualizada recarrega dados no mesmo transaction antes de mutar', async () => {
  const db = new FakeFirestore();
  const first = await loadStoreFromFirestore(db, makeStore);
  const second = await loadStoreFromFirestore(db, makeStore);
  db.collectionReads = 0;

  await mutateStoreInFirestore(db, first, () => {
    first.members.push({ id: 'm1', displayName: 'Criado pela primeira instância' });
  }, makeStore);
  assert.equal(db.collectionReads, 0);

  await mutateStoreInFirestore(db, second, () => {
    assert.equal(second.members.some((member) => member.id === 'm1'), true);
    second.audit.push({ id: 'a1', action: 'Segunda instância sincronizada' });
  }, makeStore);

  assert.equal(db.collectionReads, STORE_COLLECTIONS.length);
  assert.equal(db.data.get('members').has('m1'), true);
  assert.equal(db.data.get('audit').has('a1'), true);
  assert.equal(second.members.some((member) => member.id === 'm1'), true);
  assert.equal(revisionOf(db), 2);
});

test('instância desatualizada revalida recrutamento fechado antes de gravar', async () => {
  const db = new FakeFirestore();
  const first = await loadStoreFromFirestore(db, makeStore);
  const second = await loadStoreFromFirestore(db, makeStore);

  await mutateStoreInFirestore(db, first, () => {
    first.settings.recruitmentOpen = false;
  }, makeStore);

  await assert.rejects(() => mutateStoreInFirestore(db, second, () => {
    if (!second.settings.recruitmentOpen) throw new Error('RECRUTAMENTO_FECHADO');
    second.applications.push({ id: 'app1', desiredBrawlerKey: 'shelly' });
  }, makeStore), /RECRUTAMENTO_FECHADO/);
  assert.equal(second.settings.recruitmentOpen, false);
  assert.equal(db.data.get('applications').size, 0);
  assert.equal(revisionOf(db), 1);
});

test('instância desatualizada revalida reserva de Brawler antes de gravar', async () => {
  const db = new FakeFirestore();
  const first = await loadStoreFromFirestore(db, makeStore);
  const second = await loadStoreFromFirestore(db, makeStore);

  await mutateStoreInFirestore(db, first, () => {
    first.applications.push({ id: 'app1', status: 'PENDING', desiredBrawlerKey: 'shelly' });
  }, makeStore);

  await assert.rejects(() => mutateStoreInFirestore(db, second, () => {
    const alreadyReserved = second.applications.some((application) =>
      ['PENDING', 'IN_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'AWAITING_WHATSAPP'].includes(application.status)
      && application.desiredBrawlerKey === 'shelly');
    if (alreadyReserved) throw new Error('BRAWLER_RESERVADO');
    second.applications.push({ id: 'app2', status: 'PENDING', desiredBrawlerKey: 'shelly' });
  }, makeStore), /BRAWLER_RESERVADO/);

  assert.equal(db.data.get('applications').size, 1);
  assert.equal(second.applications.length, 1);
  assert.equal(revisionOf(db), 1);
});


test('duas candidaturas simultâneas não conseguem reservar o mesmo Brawler', async () => {
  const db = new FakeFirestore();
  const first = await loadStoreFromFirestore(db, makeStore);
  const second = await loadStoreFromFirestore(db, makeStore);

  const attempt = (store, applicationId) => mutateStoreInFirestore(db, store, () => {
    const reserved = store.applications.some((application) =>
      ['PENDING', 'IN_REVIEW', 'NEEDS_INFORMATION', 'APPROVED', 'AWAITING_WHATSAPP'].includes(application.status)
      && application.desiredBrawlerKey === 'shelly');
    if (reserved) throw new Error('BRAWLER_RESERVADO');
    store.applications.push({ id: applicationId, status: 'PENDING', desiredBrawlerKey: 'shelly' });
  }, makeStore);

  const results = await Promise.allSettled([attempt(first, 'app-a'), attempt(second, 'app-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(db.data.get('applications').size, 1);
  assert.equal(revisionOf(db), 1);
});

test('fechar recrutamento ao mesmo tempo que chega candidatura impede a gravação', async () => {
  const db = new FakeFirestore();
  const adminStore = await loadStoreFromFirestore(db, makeStore);
  const publicStore = await loadStoreFromFirestore(db, makeStore);

  const closeRecruitment = mutateStoreInFirestore(db, adminStore, () => {
    adminStore.settings.recruitmentOpen = false;
  }, makeStore);
  const submitApplication = mutateStoreInFirestore(db, publicStore, () => {
    if (!publicStore.settings.recruitmentOpen) throw new Error('RECRUTAMENTO_FECHADO');
    publicStore.applications.push({ id: 'app-race', status: 'PENDING' });
  }, makeStore);

  const results = await Promise.allSettled([closeRecruitment, submitApplication]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(String(results[1].reason), /RECRUTAMENTO_FECHADO/);
  assert.equal(db.data.get('applications').size, 0);
  assert.equal(db.data.get('settings').get('main').recruitmentOpen, false);
});

test('falha da função reverte alterações locais e não grava dados', async () => {
  const db = new FakeFirestore();
  const store = await loadStoreFromFirestore(db, makeStore);
  await assert.rejects(() => mutateStoreInFirestore(db, store, () => {
    store.members.push({ id: 'm-falha', displayName: 'Não persistir' });
    throw new Error('falha simulada');
  }, makeStore), /falha simulada/);
  assert.equal(store.members.length, 0);
  assert.equal(db.data.get('members').size, 0);
  assert.equal(revisionOf(db), 0);
});

test('falha no commit Firestore restaura o estado em memória', async () => {
  const db = new FakeFirestore();
  const store = await loadStoreFromFirestore(db, makeStore);
  db.failNextCommit = true;
  await assert.rejects(() => mutateStoreInFirestore(db, store, () => {
    store.members.push({ id: 'm-falha', displayName: 'Não persistir' });
  }, makeStore), /falha simulada de commit/);
  assert.equal(store.members.length, 0);
  assert.equal(db.data.get('members').size, 0);
  assert.equal(revisionOf(db), 0);
});


test('Firebase exige credenciais válidas e falha com mensagem clara', async () => {
  const { createFirestoreDb } = await import('../lib/firebase-admin.mjs');
  await assert.rejects(() => createFirestoreDb({}), /Configure FIREBASE_SERVICE_ACCOUNT_JSON/);
  await assert.rejects(() => createFirestoreDb({ FIREBASE_SERVICE_ACCOUNT_JSON: 'null' }), /objeto JSON de conta de serviço/);
});

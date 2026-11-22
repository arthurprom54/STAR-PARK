import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFirestoreDb } from '../lib/firebase-admin.mjs';
import { STORE_COLLECTIONS } from '../lib/firestore-store.mjs';

const sourceFile = path.resolve(process.argv[2] || 'data/store.json');
const batchSize = 400;

async function main() {
  const raw = await fs.readFile(sourceFile, 'utf8');
  const source = JSON.parse(raw);
  const db = await createFirestoreDb(process.env);

  const targetCollections = [...STORE_COLLECTIONS, 'settings'];
  for (const name of targetCollections) {
    const snapshot = name === 'settings'
      ? await db.collection(name).doc('main').get()
      : await db.collection(name).limit(1).get();
    if (name === 'settings' ? snapshot.exists : !snapshot.empty) {
      throw new Error(`A coleção ${name} já contém dados. A migração foi interrompida para evitar sobrescrita.`);
    }
  }

  const entries = [];
  for (const name of STORE_COLLECTIONS) {
    const records = Array.isArray(source[name]) ? source[name] : [];
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id.trim()) {
        throw new Error(`Foi encontrado um registro sem id válido em ${name}. Nenhum dado foi importado.`);
      }
      entries.push({ collection: name, id: record.id, data: record });
    }
  }
  entries.push({ collection: 'settings', id: 'main', data: source.settings || {} });

  let committed = 0;
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batch = db.batch();
    const chunk = entries.slice(offset, offset + batchSize);
    for (const entry of chunk) {
      batch.set(db.collection(entry.collection).doc(entry.id), entry.data);
    }
    await batch.commit();
    committed += chunk.length;
    console.log(`Importados ${committed}/${entries.length} documentos...`);
  }
  console.log(`Migração concluída: ${entries.length} documentos enviados ao Firestore.`);
  console.log('Mantenha uma cópia segura do JSON original até validar o site publicado.');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`[STAR PARK] Migração interrompida: ${error.message}`);
    process.exitCode = 1;
  });
}

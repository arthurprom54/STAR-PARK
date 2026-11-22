import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFirestoreDb } from '../lib/firebase-admin.mjs';
import { STORE_COLLECTIONS } from '../lib/firestore-store.mjs';

const outputFile = path.resolve(process.argv[2] || 'data/firestore-backup.json');

async function main() {
  const db = await createFirestoreDb(process.env);
  const output = {};
  for (const name of STORE_COLLECTIONS) {
    const snapshot = await db.collection(name).get();
    output[name] = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  }
  const settings = await db.collection('settings').doc('main').get();
  output.settings = settings.exists ? settings.data() : {};
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
  console.log(`Backup JSON salvo em: ${outputFile}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(`[STAR PARK] Backup interrompido: ${error.message}`);
    process.exitCode = 1;
  });
}

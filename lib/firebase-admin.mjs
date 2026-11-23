/** Cria uma conexão Admin SDK usando credenciais guardadas apenas no servidor. */
export async function createFirestoreDb(env = process.env) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  let serviceAccount;

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.');
    }
  } else {
    const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
    const privateKey = String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Configure FIREBASE_SERVICE_ACCOUNT_JSON ou as três variáveis FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY.');
    }
    serviceAccount = { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  }

  if (!serviceAccount || typeof serviceAccount !== 'object' || Array.isArray(serviceAccount)) {
    throw new Error('A credencial Firebase precisa ser um objeto JSON de conta de serviço.');
  }

  const resolvedProjectId = projectId || serviceAccount.project_id || serviceAccount.projectId;
  if (!resolvedProjectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('A credencial Firebase precisa conter project_id, client_email e private_key.');
  }

  const [{ initializeApp, cert, getApps }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
  ]);

  const appName = 'star-park-server';
  const app = getApps().find((entry) => entry.name === appName)
    || initializeApp({ credential: cert({ ...serviceAccount, projectId: resolvedProjectId }), projectId: resolvedProjectId }, appName);

  return getFirestore(app);
}

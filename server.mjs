import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {loadStoreFromFirestore, mutateStoreInFirestore, refreshStoreFromFirestoreIfChanged, syncStoreObject} from './lib/firestore-store.mjs';
import {aggregateBattleStats, extractBattleRecords, normalizePlayerStats} from './lib/brawl-stats.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_VERSION = '5.0.3';
const PORT = Number(process.env.PORT || 4173);
const API_BASE = (process.env.BRAWL_STARS_API_BASE || 'https://bsproxy.royaleapi.dev/v1').replace(/\/+$/, '');
const CATALOG_API_URL = process.env.BRAWL_CATALOG_API_URL || 'https://api.brawlapi.com/v1/brawlers';
const API_TOKEN_RAW = String(process.env.BRAWL_STARS_API_TOKEN || '').trim();
const API_TOKEN = API_TOKEN_RAW.replace(/^Bearer\s+/i, '').replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
const API_TOKEN_VALID = API_TOKEN.length > 0 && !/\s/.test(API_TOKEN);
const SESSION_SECRET = process.env.STAR_PARK_SESSION_SECRET || '';
const OWNER_EMAIL = (process.env.STAR_PARK_OWNER_EMAIL || '').trim().toLowerCase();
const OWNER_PASSWORD = process.env.STAR_PARK_OWNER_PASSWORD || '';
const CATALOG_INTERVAL_RAW = Number(process.env.BRAWLER_SYNC_INTERVAL_HOURS || 6);
const PLAYER_INTERVAL_RAW = Number(process.env.STAR_PARK_PLAYER_SYNC_INTERVAL_SECONDS || 60);
const API_REQUEST_INTERVAL_RAW = Number(process.env.STAR_PARK_API_MIN_REQUEST_INTERVAL_MS || 300);
const CATALOG_SYNC_INTERVAL_HOURS = Number.isFinite(CATALOG_INTERVAL_RAW) ? Math.min(336, Math.max(1, Math.round(CATALOG_INTERVAL_RAW))) : 6;
const PLAYER_SYNC_INTERVAL_SECONDS = Number.isFinite(PLAYER_INTERVAL_RAW) ? Math.min(3600, Math.max(30, Math.round(PLAYER_INTERVAL_RAW))) : 60;
const PLAYER_SYNC_INTERVAL_MS = PLAYER_SYNC_INTERVAL_SECONDS * 1000;
const API_MIN_REQUEST_INTERVAL_MS = Number.isFinite(API_REQUEST_INTERVAL_RAW) ? Math.min(5000, Math.max(100, Math.round(API_REQUEST_INTERVAL_RAW))) : 300;
const DATA_DIR = process.env.STAR_PARK_DATA_DIR || path.join(ROOT, 'data');
const STORAGE_DRIVER = String(process.env.STAR_PARK_STORAGE_DRIVER || 'json').trim().toLowerCase();
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const CACHE_FILE = path.join(DATA_DIR, 'brawlers-cache.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SNAPSHOT_FILE = path.join(PUBLIC_DIR, 'brawlers.json');
const SUPPLEMENT_FILE = path.join(PUBLIC_DIR, 'brawlers-supplement.json');
const scrypt = promisify(crypto.scrypt);
const sessions = new Map();
const requestWindows = new Map();
let storeQueue = Promise.resolve();
let lastStoreRefreshCheckAt=0;
let lastStoreRefreshError=null;
let lastStorePersistenceAt=null;
let lastStorePersistenceError=null;
const STORE_REVISION_CHECK_INTERVAL_MS=2000;
let officialApiQueue = Promise.resolve();
let nextOfficialApiRequestAt = 0;
let firestoreDb = null;
let roster = [];
let rosterSupplements = [];
let rosterSource = 'snapshot';
let lastSuccessfulSync = null;
let lastSyncError = null;
let catalogSyncInProgress = false;
let playerSyncInProgress = false;
let lastPlayerSyncAt = null;
let lastPlayerSyncError = null;
let lastPlayerSyncDurationMs = null;
let apiCooldownUntil = 0;
let apiCooldownStatus = 429;
let apiCooldownMessage = 'Aguardando a liberação do limite de consultas da API oficial.';let lastOfficialApiDiagnostic = null;
let lastOfficialApiSuccessAt = null;
let lastOfficialApiFailureAt = null;
let officialApiFailureCount = 0;
const playerCache = new Map();

const defaultStore = () => ({
  users: [], applications: [], members: [], events: [], announcements: [], audit: [],
  privacyRequests: [], snapshots: [], messageLogs: [], accountRequests: [],
  settings: {recruitmentOpen:process.env.STAR_PARK_RECRUITMENT_OPEN_ON_BOOT==='true',recruitmentClosedMessage:'As inscrições estão temporariamente fechadas.',showNickname:true,showTag:false,showEvolution:true,reservationHours:72,syncIntervalHours:6,syncIntervalSeconds:60},
});
let store = defaultStore();

const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
const nowISO = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const fmtError = (e) => e?.message || 'Não foi possível concluir a solicitação.';
const safeText = (v,max=200) => String(v ?? '').trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max);
const cleanTag = (v) => String(v || '').replace(/^#/,'').replace(/\s+/g,'').toUpperCase();
const tagIsValid = (v) => /^[0289PYLQGRJCUV]{3,15}$/.test(cleanTag(v));
function normalizePhone(value){
  const raw=String(value||'').trim();
  const hasPlus=raw.startsWith('+');
  let digits=raw.replace(/\D/g,'');
  if(!hasPlus){
    if(/^\d{10,11}$/.test(digits))digits=`55${digits}`;
    else if(!/^55\d{10,11}$/.test(digits))return null;
  }
  return /^[1-9]\d{7,14}$/.test(digits)?`+${digits}`:null;
}
const validNumber = (v) => v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const activeStatuses = new Set(['PENDING','IN_REVIEW','NEEDS_INFORMATION','APPROVED','AWAITING_WHATSAPP']);
const allowedAgeRanges = new Set(['12-14','15-17','18-24','25+']);
const roles = new Set(['OWNER','ADMIN','MODERATOR','MEMBER']);
const rolePermissions = {
  OWNER:['*'],
  ADMIN:['applications.read','applications.write','members.read','members.write','events.write','announcements.write','messages.write','users.read','users.write','privacy.read','settings.write','api.sync','audit.read'],
  MODERATOR:['applications.read','applications.write','members.read','events.write','announcements.write','messages.write','audit.read'],
  MEMBER:['member.self'],
};
function hasPermission(user, permission){return Boolean(user && (user.role==='OWNER' || (user.permissions||rolePermissions[user.role]||[]).includes('*') || (user.permissions||rolePermissions[user.role]||[]).includes(permission)));}
function requirePermission(user, permission){if(!user)throw httpError(401,'Faça login para continuar.');if(!hasPermission(user,permission))throw httpError(403,'Sua conta não tem permissão para esta ação.');}
function httpError(status,message){const e=new Error(message);e.status=status;return e;}
function publicUser(user){return {id:user.id,name:user.name,email:user.email,role:user.role,permissions:user.permissions||rolePermissions[user.role]||[],createdAt:user.createdAt};}
function defaultPermissions(role){return rolePermissions[role]||[];}

async function readJSON(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
async function saveStore(){if(firestoreDb)throw new Error('saveStore local não pode ser usado com Firestore.');await fs.mkdir(DATA_DIR,{recursive:true});const temp=`${STORE_FILE}.${process.pid}.tmp`;await fs.writeFile(temp,JSON.stringify(store,null,2),{mode:0o600});await fs.rename(temp,STORE_FILE);}
async function mutate(fn){const run=storeQueue.then(async()=>{if(firestoreDb){try{const result=await mutateStoreInFirestore(firestoreDb,store,fn,defaultStore);lastStorePersistenceAt=nowISO();lastStorePersistenceError=null;return result;}catch(error){lastStorePersistenceError=error.code||fmtError(error);console.error('[STAR PARK] Falha ao persistir no Firestore:',lastStorePersistenceError);throw error;}}const result=await fn();await saveStore();return result;});storeQueue=run.catch(()=>{});return run;}
async function refreshStoreIfNeeded(){if(!firestoreDb)return;const run=storeQueue.then(async()=>{if(Date.now()-lastStoreRefreshCheckAt<STORE_REVISION_CHECK_INTERVAL_MS){if(lastStoreRefreshError)throw lastStoreRefreshError;return;}lastStoreRefreshCheckAt=Date.now();try{const changed=await refreshStoreFromFirestoreIfChanged(firestoreDb,store,defaultStore);lastStoreRefreshError=null;if(changed)console.info('[STAR PARK] Dados atualizados a partir de outra instância. Revisão:',store.__firestoreRevision);}catch(error){lastStoreRefreshError=error;console.error('[STAR PARK] Falha ao verificar a revisão do Firestore:',error.code||fmtError(error));throw error;}});storeQueue=run.catch(()=>{});return run;}
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function syncAllMembers(){
  if(!API_TOKEN_VALID)return {ok:false,reason:'API_NOT_CONFIGURED'};
  if(playerSyncInProgress)return {ok:true,skipped:true,reason:'SYNC_ALREADY_RUNNING'};
  if(Date.now()<apiCooldownUntil)return {ok:false,skipped:true,reason:'API_COOLDOWN',retryAt:new Date(apiCooldownUntil).toISOString()};
  playerSyncInProgress=true;
  const startedAt=Date.now();
  const active=store.members.filter(m=>m.status==='ACTIVE').map(m=>({id:m.id,displayName:m.displayName,playerTag:m.playerTag,gameNickname:m.gameNickname,baselineStatus:m.baselineStatus,currentTrophies:m.currentTrophies,currentTrophiesCapturedAt:m.currentTrophiesCapturedAt}));
  const successful=[],failed=[];
  try{
    for(let index=0;index<active.length;index++){
      const member=active[index];
      try{
        const refresh=await refreshMember(member);
        successful.push({memberId:member.id,refresh});
      }catch(error){
        failed.push({memberId:member.id,displayName:member.displayName,error:fmtError(error),status:Number(error.status)||0});
        if(Number(error.status)===429){
          for(const waiting of active.slice(index+1))failed.push({memberId:waiting.id,displayName:waiting.displayName,error:apiCooldownMessage,status:apiCooldownStatus});
          break;
        }
      }
      // If any official API call triggered a cooldown after the profile succeeded, mark the remaining queue as waiting too.
      if(Date.now()<apiCooldownUntil){
        for(const waiting of active.slice(index+1))failed.push({memberId:waiting.id,displayName:waiting.displayName,error:apiCooldownMessage,status:apiCooldownStatus});
        break;
      }
    }
    await mutate(()=>{
      for(const item of successful){
        const current=store.members.find(m=>m.id===item.memberId&&m.status==='ACTIVE');
        if(!current)continue;
        const previousTrophies=current.currentTrophies;
        const previousTrophiesAt=current.currentTrophiesCapturedAt;
        Object.assign(current,item.refresh.updates);
        if(item.refresh.snapshots?.length)store.snapshots.push(...item.refresh.snapshots);
        const history=Array.isArray(current.trophyHistory)?current.trophyHistory.slice():[];
        if(!history.length&&validNumber(previousTrophies))history.push({trophies:Number(previousTrophies),capturedAt:previousTrophiesAt||null,source:'profile-cache'});
        const nextTrophies=item.refresh.updates.currentTrophies;
        const lastHistory=history.at(-1);
        if(validNumber(nextTrophies)&&(!lastHistory||Number(lastHistory.trophies)!==Number(nextTrophies)))history.push({trophies:Number(nextTrophies),capturedAt:item.refresh.updates.currentTrophiesCapturedAt,source:'brawl-stars-api'});
        current.trophyHistory=history.slice(-180);
        const knownBattles=new Set((current.battleHistory||[]).map(b=>b.id));
        const newBattles=(item.refresh.battleRecords||[]).filter(battle=>!knownBattles.has(battle.id));
        applyBattleRecords(current,newBattles);
      }
      for(const item of failed){
        const current=store.members.find(m=>m.id===item.memberId);
        if(current){current.apiSyncStatus=item.status===429?'RATE_LIMITED':'STALE';current.apiSyncError=item.error;current.lastSyncAttemptAt=nowISO();}
        if(!store.audit.some(a=>a.action==='Falha na sincronização automática'&&a.detail.startsWith(`${item.displayName}:`)&&Date.now()-Date.parse(a.at)<15*60*1000))audit(null,'Falha na sincronização automática',`${item.displayName}: ${item.error}`);
      }
      // Battle details and usage counters live inside each member document to keep Firestore writes bounded.
      store.snapshots=store.snapshots.slice(-50000);
    });
    const partial=successful.filter(item=>item.refresh.updates.apiSyncStatus==='PARTIAL').length;
    lastPlayerSyncAt=nowISO();
    lastPlayerSyncError=failed.length||partial?`${failed.length} falha(s) e ${partial} perfil(is) parcial(is) na última rodada.${failed[0]?.error?` Primeira falha: ${failed[0].error}`:''}`:null;
    lastPlayerSyncDurationMs=Date.now()-startedAt;
    return {ok:failed.length===0&&partial===0,activeMembers:active.length,updated:successful.length,partial,failed:failed.length,durationMs:lastPlayerSyncDurationMs};
  }catch(error){
    lastPlayerSyncError=fmtError(error);lastPlayerSyncDurationMs=Date.now()-startedAt;throw error;
  }finally{playerSyncInProgress=false;}
}
async function expireAbandonedReservations(){const now=Date.now();const expired=store.applications.filter(a=>a.status==='PENDING'&&a.reservationExpiresAt&&Date.parse(a.reservationExpiresAt)<now);if(!expired.length)return;await mutate(()=>{for(const app of expired){app.status='CANCELLED';app.updatedAt=nowISO();app.history.push({status:'CANCELLED',at:nowISO(),by:'Sistema',reason:'Reserva expirada por candidatura sem início de análise.'});audit(null,'Reserva expirada',`${app.displayName} • ${app.desiredBrawlerName}`);}});}
async function initStore(){
  if(process.env.NODE_ENV==='production'&&STORAGE_DRIVER!=='firestore')throw new Error('Em produção, STAR_PARK_STORAGE_DRIVER deve ser firestore. O armazenamento JSON é somente para desenvolvimento.');
  if(STORAGE_DRIVER==='firestore'){ 
    const {createFirestoreDb}=await import('./lib/firebase-admin.mjs');
    firestoreDb=await createFirestoreDb(process.env);
    const loaded=await loadStoreFromFirestore(firestoreDb,defaultStore);
    syncStoreObject(store,loaded);
    const settingsRef=firestoreDb.collection('settings').doc('main');
    await firestoreDb.runTransaction(async(transaction)=>{const settingsSnapshot=await transaction.get(settingsRef);if(!settingsSnapshot.exists)transaction.set(settingsRef,store.settings);});
    console.log('[STAR PARK] Persistência Firestore conectada.');
  }else if(STORAGE_DRIVER==='json'){
    await fs.mkdir(DATA_DIR,{recursive:true});
    const loaded=await readJSON(STORE_FILE,null);
    if(loaded&&typeof loaded==='object')syncStoreObject(store,{...defaultStore(),...loaded,settings:{...defaultStore().settings,...(loaded.settings||{})}});
    else await saveStore();
  }else{
    throw new Error('STAR_PARK_STORAGE_DRIVER inválido. Use json ou firestore.');
  }
  if(OWNER_EMAIL&&OWNER_PASSWORD){
    if(OWNER_PASSWORD.length<14)console.warn('[STAR PARK] OWNER_PASSWORD deve ter pelo menos 14 caracteres. Conta OWNER não foi inicializada.');
    else if(!store.users.some(u=>u.role==='OWNER'&&u.email===OWNER_EMAIL)){
      const salt=crypto.randomBytes(16).toString('hex');
      const hash=await scrypt(OWNER_PASSWORD,salt,64);
      const owner={id:id(),name:'Owner da Star Park',email:OWNER_EMAIL,role:'OWNER',permissions:['*'],salt,passwordHash:hash.toString('hex'),createdAt:nowISO(),disabled:false};
      await mutate(()=>{if(!store.users.some(u=>u.role==='OWNER'&&u.email===OWNER_EMAIL))store.users.push(owner);});
      console.log('[STAR PARK] Conta OWNER inicial criada a partir das variáveis de ambiente.');
    }
  }
}
function stableKey(name){return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function safeAssetUrl(value){
  if(typeof value!=='string')return null;
  try{const u=new URL(value);return u.protocol==='https:'&&['cdn.brawlify.com','cdn-misc.brawlify.com','cdn.brawlhub.gg'].includes(u.hostname)?u.href:null;}catch{return null;}
}
function normalizeRoster(payload){
  let entries=Array.isArray(payload)?payload:(payload?.list||payload?.items||payload?.brawlers||[]);
  if(!Array.isArray(entries)||!entries.length)throw new Error('A fonte do catálogo não retornou uma lista válida.');
  // Ignore time-limited/removed brawlers marked as not released, then merge current official-release supplements.
  entries=entries.filter(item=>item?.released!==false);
  const keyOf=item=>safeText(item?.key||item?.hash?.toLowerCase?.()||stableKey(item?.name||''),90);
  const positions=new Map();
  entries.forEach((item,index)=>{const key=keyOf(item);if(key&&!positions.has(key))positions.set(key,index);});
  for(const extra of rosterSupplements){
    const key=keyOf(extra);
    if(!key)continue;
    if(positions.has(key)){
      const index=positions.get(key);
      // A hand-maintained launch supplement enriches a snapshot entry when the live source is late.
      entries[index]={...entries[index],...Object.fromEntries(Object.entries(extra).filter(([field,value])=>value!==undefined&&value!==null&&value!==''))};
    }else{positions.set(key,entries.length);entries.push(extra);}
  }
  const seenIds=new Set(),seenKeys=new Set();
  return entries.map(item=>{
    const rawId=Number(item?.id),brawlerId=Number.isFinite(rawId)&&rawId>0?rawId:null;
    const name=safeText(item?.name,80),key=keyOf(item);
    if(!name||!key||seenKeys.has(key)||(brawlerId&&seenIds.has(brawlerId)))return null;
    seenKeys.add(key);if(brawlerId)seenIds.add(brawlerId);
    const rarity=item?.rarity?.name||item?.rarity||null;
    const brawlerClass=item?.class?.name||item?.class||null;
    const imageUrl=safeAssetUrl(item?.imageUrl);
    const imageUrl2=safeAssetUrl(item?.imageUrl2);
    const imageUrl3=safeAssetUrl(item?.imageUrl3);
    const releaseNumber=Number.isFinite(Number(item?.releaseNumber))?Number(item.releaseNumber):(brawlerId?brawlerId-16000000:null);
    const imageId=brawlerId||(releaseNumber!=null?16000000+releaseNumber:null);
    const modelImageUrl=imageId?`https://cdn.brawlify.com/brawlers/model/${imageId}.png`:null;
    return {
      id:brawlerId,key,name,releaseNumber,sortOrder:brawlerId??(releaseNumber!=null?16000000+releaseNumber:99999999),
      rarity,rarityColor:/^#[0-9a-fA-F]{6}$/.test(item?.rarity?.color||'')?item.rarity.color:null,
      class:brawlerClass,description:safeText(item?.description,1200),
      imageUrl,imageUrl2,imageUrl3,modelImageUrl,
      starPowers:Array.isArray(item?.starPowers)?item.starPowers.map(x=>({name:safeText(x?.name,90),description:safeText(x?.description,300),imageUrl:safeAssetUrl(x?.imageUrl)})).filter(x=>x.name):[],
      gadgets:Array.isArray(item?.gadgets)?item.gadgets.map(x=>({name:safeText(x?.name,90),description:safeText(x?.description,300),imageUrl:safeAssetUrl(x?.imageUrl)})).filter(x=>x.name):[],
      released:item?.released!==false,
      source:item?.source||((item?.imageUrl||item?.imageUrl2||item?.imageUrl3)?'brawlapi-catalog':'local-snapshot')
    };
  }).filter(Boolean).sort((a,b)=>(a.sortOrder??99999999)-(b.sortOrder??99999999)||a.name.localeCompare(b.name));
}
/* STAR_PARK_API_RESILIENCE_V1 */
async function officialFetch(endpoint, options = {}) {
  const {bypassCooldown = false} = options;
  if (!API_TOKEN) throw httpError(503, 'A chave BRAWL_STARS_API_TOKEN nao foi configurada no servidor.');
  if (!API_TOKEN_VALID) {
    const message = 'A chave BRAWL_STARS_API_TOKEN contem espacos ou quebras de linha no meio do valor. Cole somente a chave, sem Bearer, aspas ou espacos internos.';
    const error = httpError(500, message);
    error.code = 'API_TOKEN_MALFORMED';
    error.diagnostic = {stage: 'configuration', code: error.code, message, at: nowISO()};
    lastOfficialApiDiagnostic = error.diagnostic;
    lastOfficialApiFailureAt = nowISO();
    officialApiFailureCount++;
    apiCooldownStatus = 500;
    apiCooldownMessage = message;
    apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + 300000);
    throw error;
  }

  let targetUrl;
  try {
    const base = new URL(API_BASE);
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('A URL base precisa usar HTTPS e nao pode conter credenciais.');
    const path = String(endpoint || '');
    if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) throw new Error('Caminho de endpoint invalido.');
    const basePath = base.pathname.replace(/\/+$/, '');
    targetUrl = new URL(basePath + path, base.origin);
    if (targetUrl.origin !== base.origin) throw new Error('O endpoint tentou sair do host configurado.');
  } catch (cause) {
    const error = httpError(500, 'Configuracao da URL da API invalida: ' + (cause?.message || 'URL invalida.'));
    error.code = 'API_BASE_INVALID';
    error.diagnostic = {stage: 'configuration', code: error.code, message: error.message, at: nowISO()};
    lastOfficialApiDiagnostic = error.diagnostic;
    lastOfficialApiFailureAt = nowISO();
    officialApiFailureCount++;
    apiCooldownStatus = 500;
    apiCooldownMessage = error.message;
    apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + 300000);
    throw error;
  }

  const request = officialApiQueue.then(async () => {
    if (!bypassCooldown && Date.now() < apiCooldownUntil) {
      const error = httpError(apiCooldownStatus || 429, apiCooldownMessage || 'A API esta em pausa de protecao.');
      error.code = 'API_COOLDOWN';
      error.diagnostic = lastOfficialApiDiagnostic;
      throw error;
    }

    const retryableStatuses = new Set([408, 425, 500, 502, 503, 504]);
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!bypassCooldown && Date.now() < apiCooldownUntil) {
        const error = httpError(apiCooldownStatus || 429, apiCooldownMessage || 'A API esta em pausa de protecao.');
        error.code = 'API_COOLDOWN';
        error.diagnostic = lastOfficialApiDiagnostic;
        throw error;
      }

      const wait = Math.max(0, nextOfficialApiRequestAt - Date.now());
      if (wait) await sleep(wait);
      nextOfficialApiRequestAt = Date.now() + API_MIN_REQUEST_INTERVAL_MS;

      let response;
      try {
        response = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + API_TOKEN,
            Accept: 'application/json',
            'User-Agent': 'StarPark/5.0.2 API-Resilience'
          },
          signal: AbortSignal.timeout(15000),
          cache: 'no-store'
        });
      } catch (cause) {
        const networkMessage = cause?.name === 'TimeoutError' || cause?.name === 'AbortError'
          ? 'A API excedeu o tempo limite de 15 segundos.'
          : 'Falha de rede ao conectar com a API: ' + String(cause?.message || cause || 'erro desconhecido').slice(0, 300);
        if (attempt < maxRetries) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        const diagnostic = {
          stage: 'network', code: cause?.code || cause?.name || 'NETWORK_ERROR',
          endpoint: targetUrl.pathname + targetUrl.search, message: networkMessage,
          attempts: attempt + 1, at: nowISO()
        };
        lastOfficialApiDiagnostic = diagnostic;
        lastOfficialApiFailureAt = nowISO();
        officialApiFailureCount++;
        apiCooldownStatus = 503;
        apiCooldownMessage = networkMessage;
        apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + 30000);
        const error = httpError(503, networkMessage + ' O sistema tentou novamente ' + (attempt + 1) + ' vez(es).');
        error.code = diagnostic.code;
        error.diagnostic = diagnostic;
        throw error;
      }

      const rawBody = await response.text().catch(() => '');
      let payload = null;
      let validJson = false;
      try { payload = rawBody ? JSON.parse(rawBody) : null; validJson = true; } catch {}

      if (response.ok) {
        if (!validJson) {
          const diagnostic = {
            stage: 'response', code: 'INVALID_JSON', status: response.status,
            endpoint: targetUrl.pathname + targetUrl.search,
            contentType: response.headers.get('content-type'),
            responseBody: rawBody.replaceAll(API_TOKEN, '[SEGREDO_OCULTO]').slice(0, 1800),
            at: nowISO()
          };
          lastOfficialApiDiagnostic = diagnostic;
          lastOfficialApiFailureAt = nowISO();
          officialApiFailureCount++;
          apiCooldownStatus = 502;
          apiCooldownMessage = 'A API enviou uma resposta que nao e JSON valido.';
          apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + 30000);
          const error = httpError(502, 'A API respondeu com sucesso HTTP, mas enviou um corpo que nao e JSON valido.');
          error.code = 'INVALID_JSON'; error.diagnostic = diagnostic;
          throw error;
        }
        lastOfficialApiSuccessAt = nowISO();
        officialApiFailureCount = 0;
        apiCooldownUntil = 0;
        apiCooldownStatus = 429;
        apiCooldownMessage = 'Aguardando a liberacao do limite de consultas da API oficial.';
        return payload;
      }

      const upstreamMessage = typeof payload?.message === 'string' ? payload.message.slice(0, 300)
        : typeof payload?.error === 'string' ? payload.error.slice(0, 300) : '';
      const upstreamReason = typeof payload?.reason === 'string' ? payload.reason.slice(0, 120)
        : typeof payload?.code === 'string' ? payload.code.slice(0, 120) : '';
      const redactedBody = rawBody.replaceAll(API_TOKEN, '[SEGREDO_OCULTO]').slice(0, 1800);
      const diagnostic = {
        stage: 'upstream', status: response.status, statusText: response.statusText,
        endpoint: targetUrl.pathname + targetUrl.search,
        reason: upstreamReason || null, message: upstreamMessage || null,
        headers: {
          contentType: response.headers.get('content-type'),
          server: response.headers.get('server'),
          cfRay: response.headers.get('cf-ray'),
          requestId: response.headers.get('x-request-id') || response.headers.get('x-correlation-id'),
          retryAfter: response.headers.get('retry-after'),
          date: response.headers.get('date')
        },
        responseBody: redactedBody || null, attempts: attempt + 1, at: nowISO()
      };

      if (retryableStatuses.has(response.status) && attempt < maxRetries) {
        await sleep(500 * (attempt + 1));
        continue;
      }

      const messages = {
        400: 'A API rejeitou os parametros enviados.',
        401: 'A API recusou a chave de autenticacao (HTTP 401).',
        403: /invalid authorization/i.test(upstreamMessage)
          ? 'A API/proxy recusou a autorizacao (HTTP 403: Invalid authorization). Isso nao e erro da tag do jogador. Verifique se a chave foi copiada sem espacos internos e se o IP de saida permitido corresponde ao servico que faz a chamada.'
          : 'A API negou o acesso (HTTP 403). Verifique a chave, o escopo e o IP permitido.',
        404: 'Jogador ou recurso nao encontrado (HTTP 404).',
        429: 'A API atingiu o limite de consultas (HTTP 429).',
        500: 'A API apresentou erro interno (HTTP 500).',
        502: 'O gateway/proxy recebeu uma resposta invalida (HTTP 502).',
        503: 'A API esta temporariamente indisponivel (HTTP 503).',
        504: 'O gateway/proxy excedeu o tempo limite (HTTP 504).'
      };
      const baseMessage = messages[response.status] || ('A API respondeu com HTTP ' + response.status + '.');
      const detail = [upstreamReason, upstreamMessage].filter(Boolean).join(' / ');
      const message = baseMessage + (detail ? ' Detalhe informado pelo servidor: ' + detail : '');
      lastOfficialApiDiagnostic = diagnostic;
      lastOfficialApiFailureAt = nowISO();
      officialApiFailureCount++;

      if ([401, 403, 429, 500, 502, 503, 504].includes(response.status)) {
        const retryHeader = response.headers.get('retry-after');
        const retryMs = retryHeader
          ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now()))
          : 0;
        const fallbackMs = response.status === 429 ? 60000 : [401, 403].includes(response.status) ? 300000 : 30000;
        const cooldownMs = Math.max(30000, Math.min(retryMs || fallbackMs, 900000));
        apiCooldownStatus = response.status;
        apiCooldownMessage = message;
        apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + cooldownMs);
        diagnostic.cooldownUntil = new Date(apiCooldownUntil).toISOString();
      }

      const error = httpError(response.status, message);
      error.code = upstreamReason || ('HTTP_' + response.status);
      error.diagnostic = diagnostic;
      throw error;
    }
    throw httpError(503, 'A API nao respondeu apos as tentativas de recuperacao.');
  });
  officialApiQueue = request.catch(() => {});
  return request;
}
async function fetchAllBrawlers(){const all=[];const seenCursors=new Set();let after=null;for(let page=0;page<20;page++){const query=new URLSearchParams({limit:'200'});if(after)query.set('after',after);const payload=await officialFetch(`/brawlers?${query.toString()}`);const items=Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.list)?payload.list:Array.isArray(payload?.brawlers)?payload.brawlers:Array.isArray(payload)?payload:[];if(!items.length){if(page===0)throw new Error('A API não retornou Brawlers.');break;}all.push(...items);const next=payload?.paging?.cursors?.after||payload?.paging?.after||null;if(!next){if(items.length>=200)throw new Error('A API retornou uma página cheia sem cursor. Não é possível certificar que o catálogo está completo.');break;}if(seenCursors.has(next))throw new Error('Cursor de paginação repetido ao carregar o catálogo.');seenCursors.add(next);after=next;if(page===19)throw new Error('O catálogo excedeu o limite de páginas de segurança.');}return all;}
async function syncBrawlers(){
  if(catalogSyncInProgress)return {ok:true,alreadyRunning:true,count:roster.length};
  catalogSyncInProgress=true;
  try{
    const response=await fetch(CATALOG_API_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok)throw new Error(`A fonte do catálogo respondeu com HTTP ${response.status}.`);
    const payload=await response.json();
    const next=normalizeRoster(payload);
    // Do not replace a complete catalogue with a suspiciously short response.
    if(next.length<50)throw new Error('A resposta do catálogo veio incompleta; a versão anterior foi preservada.');
    const savedAt=nowISO();
    await fs.mkdir(DATA_DIR,{recursive:true});
    await fs.writeFile(CACHE_FILE,JSON.stringify({savedAt,source:'brawlapi-catalog',items:next},null,2),{mode:0o600});
    roster=next;rosterSource='brawlapi-catalog';lastSuccessfulSync=savedAt;lastSyncError=null;
    return {ok:true,count:roster.length,savedAt,source:rosterSource};
  }catch(e){lastSyncError=fmtError(e);throw e;}
  finally{catalogSyncInProgress=false;}
}
async function initRoster(){
  rosterSupplements=await readJSON(SUPPLEMENT_FILE,[]);if(!Array.isArray(rosterSupplements))rosterSupplements=[];
  const cache=await readJSON(CACHE_FILE,null),snapshot=await readJSON(SNAPSHOT_FILE,[]);
  if(Array.isArray(cache?.items)&&cache.items.length){roster=normalizeRoster(cache.items);rosterSource=cache.source==='brawlapi-catalog'?'cached-brawlapi-catalog':'cached-catalog';lastSuccessfulSync=cache.savedAt||null;}
  else{roster=normalizeRoster(snapshot);rosterSource='local-fallback';}
  if(process.env.STAR_PARK_DISABLE_CATALOG_SYNC!=='1'){
    syncBrawlers().catch(e=>console.warn(`[STAR PARK] Catálogo visual não foi atualizado; mantendo cache/fallback: ${fmtError(e)}`));
    const timer=setInterval(()=>syncBrawlers().catch(e=>console.warn(`[STAR PARK] Atualização do catálogo falhou; mantendo última versão: ${fmtError(e)}`)),CATALOG_SYNC_INTERVAL_HOURS*3600000);timer.unref();
  }
}
function rosterEntry(value){return roster.find(b=>String(b.id)===String(value)||b.key===String(value)||b.name.toLowerCase()===String(value).toLowerCase());}
function memberForBrawler(key){return store.members.find(m=>m.status==='ACTIVE'&&m.representedBrawlerKey===key);}
function applicationForBrawler(key){return store.applications.find(a=>activeStatuses.has(a.status)&&a.desiredBrawlerKey===key);}
function brawlerState(key){return memberForBrawler(key)?'UNAVAILABLE':applicationForBrawler(key)?'RESERVED':'AVAILABLE';}
function audit(actor,action,detail){store.audit.unshift({id:id(),actorId:actor?.id||null,actorName:actor?.name||'Sistema',role:actor?.role||'SYSTEM',action,detail:safeText(detail,300),at:nowISO()});store.audit=store.audit.slice(0,2000);}
function parseCookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))];}));}
function setCookie(res,name,value,{httpOnly=true,maxAge=43200}={}){const secure=process.env.NODE_ENV==='production'?' Secure;':'';res.setHeader('Set-Cookie',[...(res.getHeader('Set-Cookie')||[]),`${name}=${encodeURIComponent(value)}; Path=/; SameSite=Strict; Max-Age=${maxAge};${httpOnly?' HttpOnly;':''}${secure}`]);}
function clearCookie(res,name){const secure=process.env.NODE_ENV==='production'?' Secure;':'';res.setHeader('Set-Cookie',[...(res.getHeader('Set-Cookie')||[]),`${name}=; Path=/; SameSite=Strict; Max-Age=0;${secure}`]);}
function sessionSignature(sessionId){return crypto.createHmac('sha256',SESSION_SECRET).update(sessionId).digest('hex');}
function getSession(req){const cookies=parseCookies(req);const token=String(cookies.sp_session||'');const [sessionId,signature]=token.split('.');if(!sessionId||!signature||!SESSION_SECRET)return null;const expected=sessionSignature(sessionId);if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;const s=sessions.get(sessionId);if(!s||s.expiresAt<Date.now()){if(sessionId)sessions.delete(sessionId);return null;}return s;}
function currentUser(req){const session=getSession(req);return session?store.users.find(u=>u.id===session.userId&&!u.disabled)||null:null;}
function checkCsrf(req){const s=getSession(req);const cookies=parseCookies(req);if(!s||!cookies.sp_csrf||req.headers['x-csrf-token']!==cookies.sp_csrf||cookies.sp_csrf!==s.csrf)throw httpError(403,'Verificação de segurança inválida. Atualize a página e tente novamente.');}
function rateLimit(req,bucket,limit,windowMs){const key=`${bucket}:${req.socket.remoteAddress||'unknown'}`;const now=Date.now();const hits=(requestWindows.get(key)||[]).filter(t=>now-t<windowMs);if(hits.length>=limit)throw httpError(429,'Muitas tentativas. Aguarde um pouco e tente novamente.');hits.push(now);requestWindows.set(key,hits);}
async function bodyJSON(req,max=40000){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>max)throw httpError(413,'O envio excede o tamanho permitido.');}try{return raw?JSON.parse(raw):{};}catch{throw httpError(400,'Formato de dados inválido.');}}
function sendJSON(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(JSON.stringify(data));}
async function serveStatic(req,res,url){let requested;try{requested=decodeURIComponent(url.pathname);}catch{return sendJSON(res,400,{error:'Caminho inválido.'});}if(requested==='/')requested='/index.html';const allowed=new Set(['/index.html','/styles.css','/app.js','/brawlers.json','/brawlers-supplement.json','/assets/hero-crew.svg']);if(!allowed.has(requested))return sendJSON(res,404,{error:'Arquivo não encontrado.'});const file=path.resolve(PUBLIC_DIR,`.${requested}`);if(!file.startsWith(PUBLIC_DIR+path.sep))return sendJSON(res,403,{error:'Acesso negado.'});try{const body=await fs.readFile(file);res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(),microphone=(),geolocation=()','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https://api.brawlapi.com; img-src 'self' data: https://cdn.brawlify.com https://cdn-misc.brawlify.com https://cdn.brawlhub.gg; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"});res.end(body);}catch{sendJSON(res,404,{error:'Arquivo não encontrado.'});}}
async function fetchPlayer(tag,forceFresh=false){
  const normalized=cleanTag(tag);
  if(!tagIsValid(normalized))throw httpError(400,'Tag inválida. Confira os caracteres e tente novamente.');
  const cached=playerCache.get(normalized);
  if(!forceFresh&&cached&&Date.now()-cached.at<300000)return {...cached.data,cached:true};
  const encoded=encodeURIComponent(`#${normalized}`);
  const [playerResult,battleResult]=await Promise.allSettled([
    officialFetch(`/players/${encoded}`),
    officialFetch(`/players/${encoded}/battlelog`),
  ]);
  if(playerResult.status==='rejected')throw playerResult.reason;
  const battlelog=battleResult.status==='fulfilled'?(Array.isArray(battleResult.value?.items)?battleResult.value.items:[]):[];
  const result={player:playerResult.value,battlelog,battlelogAvailable:battleResult.status==='fulfilled',battlelogError:battleResult.status==='rejected'?fmtError(battleResult.reason):null,fetchedAt:nowISO()};
  playerCache.set(normalized,{at:Date.now(),data:result});
  if(playerCache.size>1000){const oldest=[...playerCache.entries()].sort((a,b)=>a[1].at-b[1].at).slice(0,200);for(const [key] of oldest)playerCache.delete(key);}
  return {...result,cached:false};
}
function battleBrawlerName(item,tag){
  const battle=item?.battle||{};
  const candidates=[...(Array.isArray(battle.players)?battle.players:[]),...(Array.isArray(battle.teams)?battle.teams.flat():[])];
  const self=candidates.find(p=>cleanTag(p?.tag)===cleanTag(tag));
  return self?.brawler?.name||(candidates.length===0?battle.brawler?.name:null)||null;
}
function incrementCountMap(target,source){for(const [name,count] of Object.entries(source||{})){if(name)target[name]=(Number(target[name])||0)+(Number(count)||0);}}
function applyBattleRecords(member,records){
  if(!records.length)return;
  const existing=member.battleUsage||{totalObserved:0,wins:0,losses:0,draws:0,brawlers:{},modes:{}};
  const delta=aggregateBattleStats(records);
  existing.totalObserved=(Number(existing.totalObserved)||0)+delta.totalObserved;
  existing.wins=(Number(existing.wins)||0)+delta.wins;existing.losses=(Number(existing.losses)||0)+delta.losses;existing.draws=(Number(existing.draws)||0)+delta.draws;
  existing.brawlers=existing.brawlers||{};existing.modes=existing.modes||{};
  for(const row of delta.brawlers)existing.brawlers[row.name]=(Number(existing.brawlers[row.name])||0)+row.count;
  for(const row of delta.modes)existing.modes[row.name]=(Number(existing.modes[row.name])||0)+row.count;
  member.battleUsage=existing;
  const byId=new Map((member.battleHistory||[]).map(b=>[b.id,b]));
  for(const battle of records)byId.set(battle.id,battle);
  member.battleHistory=[...byId.values()].sort((a,b)=>String(a.battleTime||a.observedAt).localeCompare(String(b.battleTime||b.observedAt))).slice(-100);
}
function aggregateHouseBattleStats(members){
  const brawlers={},modes={};let totalObserved=0,wins=0,losses=0,draws=0;
  for(const member of members){
    const usage=member.battleUsage;
    if(usage){totalObserved+=Number(usage.totalObserved)||0;wins+=Number(usage.wins)||0;losses+=Number(usage.losses)||0;draws+=Number(usage.draws)||0;incrementCountMap(brawlers,usage.brawlers);incrementCountMap(modes,usage.modes);}
    else if(Array.isArray(member.recentBattles)&&member.recentBattles.length){for(const battle of member.recentBattles)if(battle.brawlerName){brawlers[battle.brawlerName]=(brawlers[battle.brawlerName]||0)+1;totalObserved++;}}
  }
  const sort=(obj,key)=>Object.entries(obj).map(([name,count])=>({name,[key]:count})).sort((a,b)=>b[key]-a[key]||a.name.localeCompare(b.name));
  return {totalObserved,wins,losses,draws,brawlers:sort(brawlers,'count'),modes:sort(modes,'count')};
}
function getBrawlerUsage(){return aggregateHouseBattleStats(store.members.filter(m=>m.status==='ACTIVE')).brawlers;}
function getBrawlerTrophyTotals(){const counts=new Map();for(const m of store.members.filter(x=>x.status==='ACTIVE'))for(const b of (m.brawlers||[])){if(validNumber(b.trophies))counts.set(b.name,(counts.get(b.name)||0)+Number(b.trophies));}return [...counts].map(([name,trophies])=>({name,trophies})).sort((a,b)=>b.trophies-a.trophies||a.name.localeCompare(b.name));}
function publicMember(m){const settings=m.publicProfileSettings||{};return {id:m.id,displayName:m.displayName,gameNickname:store.settings.showNickname&&settings.showNickname!==false?m.gameNickname:null,playerTag:store.settings.showTag&&settings.showTag?m.playerTag:null,representedBrawlerName:m.representedBrawlerName,currentTrophies:m.currentTrophies,baselineTrophies:store.settings.showEvolution&&settings.showEvolution!==false?m.baselineTrophies:null,baselineStatus:m.baselineStatus,joinedAt:m.joinedAt,lastSyncedAt:m.currentTrophiesCapturedAt,apiSyncStatus:m.apiSyncStatus||'PENDING',avatar:m.avatar||null};}
function sumStat(members,key){const values=members.map(m=>m.playerStats?.[key]);return members.length&&values.every(validNumber)?values.reduce((sum,n)=>sum+Number(n),0):null;}
function publicSummary(){
  const members=store.members.filter(m=>m.status==='ACTIVE');
  const valid=members.filter(m=>validNumber(m.currentTrophies));
  const total=valid.reduce((sum,m)=>sum+Number(m.currentTrophies),0);
  const completeTrophyCoverage=members.length>0&&valid.length===members.length;
  const usage=getBrawlerUsage();
  const brawlerProfileCoverage=members.filter(m=>validNumber(m.playerStats?.brawlerCount)).length;
  const trophyTotals=members.length>0&&brawlerProfileCoverage===members.length?getBrawlerTrophyTotals():[];
  const battleStats=aggregateHouseBattleStats(members);
  const occupied=roster.filter(b=>brawlerState(b.key)==='UNAVAILABLE').length;
  const reserved=roster.filter(b=>brawlerState(b.key)==='RESERVED').length;
  const statsMembers=members.filter(m=>m.playerStats&&typeof m.playerStats==='object');
  const experienceValues=members.map(m=>m.playerStats?.experienceLevel).filter(validNumber);
  const brawlerCountValues=members.map(m=>m.playerStats?.brawlerCount);
  const victoryFields=['victories3v3','victoriesSolo','victoriesDuo'];
  const officialVictoryProfiles=members.filter(m=>victoryFields.every(key=>validNumber(m.playerStats?.[key]))).length;
  const clubCounts=new Map();for(const m of members){const name=m.playerStats?.club?.name;if(name)clubCounts.set(name,(clubCounts.get(name)||0)+1);}
  const clubs=[...clubCounts].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  return {
    activeMembers:members.length,totalTrophies:completeTrophyCoverage?total:null,validTrophyProfiles:valid.length,
    averageTrophies:valid.length?Math.round(total/valid.length):null,
    highestProfileTrophies:completeTrophyCoverage?Math.max(...valid.map(m=>Number(m.playerStats?.highestTrophies??m.currentTrophies))):null,
    brawlerProfileCoverage,
    total3v3Victories:sumStat(members,'victories3v3'),totalSoloVictories:sumStat(members,'victoriesSolo'),totalDuoVictories:sumStat(members,'victoriesDuo'),
    totalOfficialVictories:members.length&&officialVictoryProfiles===members.length?members.reduce((sum,m)=>sum+victoryFields.reduce((n,key)=>n+Number(m.playerStats[key]),0),0):null,
    officialVictoryProfiles,
    averageExperienceLevel:experienceValues.length===members.length&&members.length?Math.round(experienceValues.reduce((sum,n)=>sum+Number(n),0)/members.length):null,
    totalBrawlersOwned:members.length&&brawlerCountValues.every(validNumber)?brawlerCountValues.reduce((sum,n)=>sum+Number(n),0):null,
    profileStatsCoverage:statsMembers.length,
    profileStatsTotal:members.length,brawlerCount:roster.length,representedBrawlers:occupied,reservedBrawlers:reserved,availableBrawlers:roster.length-occupied-reserved,
    mostUsedBrawler:usage[0]||null,mostTrophyBrawler:trophyTotals[0]||null,usage,trophyTotals,
    battleStats:{...battleStats,modes:battleStats.modes},clubs,
    topPlayers:valid.sort((a,b)=>b.currentTrophies-a.currentTrophies).slice(0,5).map(publicMember),
    updatedAt:valid.reduce((max,m)=>!max||String(m.currentTrophiesCapturedAt)>max?m.currentTrophiesCapturedAt:max,null),
    playerSync:{intervalSeconds:PLAYER_SYNC_INTERVAL_SECONDS,minRequestIntervalMs:API_MIN_REQUEST_INTERVAL_MS,lastSyncAt:lastPlayerSyncAt,lastError:lastPlayerSyncError,inProgress:playerSyncInProgress,durationMs:lastPlayerSyncDurationMs,apiCooldownUntil:apiCooldownUntil?new Date(apiCooldownUntil).toISOString():null},
  };
}
async function captureBaseline(member){
  try{
    const api=await fetchPlayer(member.playerTag,true);
    const baselineTrophies=validNumber(api.player.trophies)?Number(api.player.trophies):null;
    const updates={baselineTrophies,baselineCapturedAt:api.fetchedAt,baselineStatus:baselineTrophies===null?'PENDING_CAPTURE':'CAPTURED',currentTrophies:baselineTrophies,currentTrophiesCapturedAt:api.fetchedAt,trophyHistory:baselineTrophies===null?[]:[{trophies:baselineTrophies,capturedAt:api.fetchedAt,source:'baseline'}],playerStats:normalizePlayerStats(api.player),brawlers:Array.isArray(api.player.brawlers)?api.player.brawlers.map(b=>({id:b.id??null,name:b.name,trophies:validNumber(b.trophies)?Number(b.trophies):null,highestTrophies:validNumber(b.highestTrophies)?Number(b.highestTrophies):null,power:validNumber(b.power)?Number(b.power):null,rank:validNumber(b.rank)?Number(b.rank):null})):[],apiSyncStatus:api.battlelogAvailable?'OK':'PARTIAL',apiSyncError:api.battlelogError||null,recentBattles:(api.battlelog||[]).map(x=>({brawlerName:battleBrawlerName(x,member.playerTag)})).filter(x=>x.brawlerName)};
    const battleRecords=extractBattleRecords(api.battlelog,member.playerTag,member.id);
    return {updates,battleRecords,snapshots:baselineTrophies===null?[]:[{id:id(),memberId:member.id,trophies:baselineTrophies,capturedAt:api.fetchedAt,source:'brawl-stars-api',syncStatus:updates.baselineStatus}]};
  }catch{return {updates:{baselineTrophies:null,baselineCapturedAt:null,baselineStatus:'PENDING_CAPTURE',currentTrophies:null,currentTrophiesCapturedAt:null,apiSyncStatus:'PENDING'},battleRecords:[],snapshots:[]};}
}
async function refreshMember(member){
  const api=await fetchPlayer(member.playerTag,true);
  const p=api.player;
  const currentTrophies=validNumber(p.trophies)?Number(p.trophies):null;
  const battleRecords=extractBattleRecords(api.battlelog,member.playerTag,member.id);
  const updates={gameNickname:p.name||member.gameNickname,currentTrophies,currentTrophiesCapturedAt:api.fetchedAt,playerStats:normalizePlayerStats(p),apiSyncStatus:api.battlelogAvailable?'OK':'PARTIAL',apiSyncError:api.battlelogError||null,lastSyncAttemptAt:api.fetchedAt,lastBattleLogSyncAt:api.battlelogAvailable?api.fetchedAt:(member.lastBattleLogSyncAt||null),brawlers:Array.isArray(p.brawlers)?p.brawlers.map(b=>({id:b.id??null,name:b.name,trophies:validNumber(b.trophies)?Number(b.trophies):null,highestTrophies:validNumber(b.highestTrophies)?Number(b.highestTrophies):null,power:validNumber(b.power)?Number(b.power):null,rank:validNumber(b.rank)?Number(b.rank):null})):[],recentBattles:(api.battlelog||[]).map(x=>({brawlerName:battleBrawlerName(x,member.playerTag)})).filter(x=>x.brawlerName)};
  const snapshots=[];
  if(member.baselineStatus==='PENDING_CAPTURE'){
    updates.baselineTrophies=currentTrophies;
    updates.baselineCapturedAt=api.fetchedAt;
    updates.trophyHistory=currentTrophies===null?[]:[{trophies:currentTrophies,capturedAt:api.fetchedAt,source:'baseline'}];
    updates.baselineStatus=currentTrophies===null?'PENDING_CAPTURE':'CAPTURED';
    if(currentTrophies!==null)snapshots.push({id:id(),memberId:member.id,trophies:currentTrophies,capturedAt:api.fetchedAt,source:'brawl-stars-api',syncStatus:'CAPTURED'});
  }
  return {updates,snapshots,battleRecords};
}

await initStore();
await initRoster();
const expiryTimer=setInterval(()=>expireAbandonedReservations().catch(e=>console.error('[STAR PARK] Falha ao expirar reservas:',fmtError(e))),10*60*1000);expiryTimer.unref();
if(API_TOKEN_VALID){const firstPlayerSync=setTimeout(()=>syncAllMembers().catch(e=>console.error('[STAR PARK] Sincronização inicial falhou:',fmtError(e))),5000);firstPlayerSync.unref();const playerSyncTimer=setInterval(()=>syncAllMembers().catch(e=>console.error('[STAR PARK] Sincronização dos membros falhou:',fmtError(e))),PLAYER_SYNC_INTERVAL_MS);playerSyncTimer.unref();}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  try{
    if(firestoreDb&&url.pathname.startsWith('/api/')&&url.pathname!=='/api/health')await refreshStoreIfNeeded();
    if(req.method==='GET'&&url.pathname==='/api/health')return sendJSON(res,200,{ok:true,appVersion:APP_VERSION,apiConfigured:API_TOKEN_VALID,brawlerCount:roster.length,catalogSource:rosterSource,catalogCount:roster.length,catalogLastSuccessfulSync:lastSuccessfulSync,catalogLastSyncError:lastSyncError,catalogAutomaticSyncHours:process.env.STAR_PARK_DISABLE_CATALOG_SYNC==='1'?null:CATALOG_SYNC_INTERVAL_HOURS,playerSync:{intervalSeconds:PLAYER_SYNC_INTERVAL_SECONDS,minRequestIntervalMs:API_MIN_REQUEST_INTERVAL_MS,lastSyncAt:lastPlayerSyncAt,lastError:lastPlayerSyncError,inProgress:playerSyncInProgress,durationMs:lastPlayerSyncDurationMs,activeMembers:store.members.filter(m=>m.status==='ACTIVE').length,updatedMembers:store.members.filter(m=>m.status==='ACTIVE'&&m.apiSyncStatus==='OK').length,partialMembers:store.members.filter(m=>m.status==='ACTIVE'&&m.apiSyncStatus==='PARTIAL').length,staleMembers:store.members.filter(m=>m.status==='ACTIVE'&&['STALE','RATE_LIMITED'].includes(m.apiSyncStatus)).length,apiCooldownUntil:apiCooldownUntil?new Date(apiCooldownUntil).toISOString():null},ownerConfigured:Boolean(OWNER_EMAIL&&OWNER_PASSWORD&&SESSION_SECRET),storageDriver:STORAGE_DRIVER,storage:{configured:STORAGE_DRIVER==='firestore'?Boolean(firestoreDb):true,revision:store.__firestoreRevision??null,lastWriteAt:lastStorePersistenceAt,lastWriteHadError:Boolean(lastStorePersistenceError)}});
    if(req.method==='GET'&&url.pathname==='/api/brawlers')return sendJSON(res,200,{items:roster.map(b=>({...b,status:brawlerState(b.key),representative:memberForBrawler(b.key)?.displayName||null})),count:roster.length,source:rosterSource,lastSuccessfulSync,apiConfigured:API_TOKEN_VALID,catalogApiUrl:'https://api.brawlapi.com/v1/brawlers',lastSyncError});
    if(req.method==='GET'&&url.pathname==='/api/public/summary')return sendJSON(res,200,publicSummary());
    if(req.method==='GET'&&url.pathname==='/api/public/members')return sendJSON(res,200,{items:store.members.filter(m=>m.status==='ACTIVE'&&m.publicProfileSettings?.public!==false).map(publicMember)});
    if(req.method==='GET'&&url.pathname==='/api/public/events')return sendJSON(res,200,{items:store.events.filter(e=>e.status==='PUBLISHED').sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(({registrations,...e})=>({...e,registrationsCount:registrations?.length||0}))});
    if(req.method==='GET'&&url.pathname==='/api/public/announcements')return sendJSON(res,200,{items:store.announcements.filter(a=>a.status==='PUBLISHED'&&a.visibility==='PUBLIC').sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.createdAt.localeCompare(a.createdAt))});
    if(req.method==='GET'&&url.pathname==='/api/public/settings')return sendJSON(res,200,{recruitmentOpen:store.settings.recruitmentOpen,recruitmentClosedMessage:store.settings.recruitmentClosedMessage});
    if(req.method==='POST'&&url.pathname==='/api/applications'){
      const body=await bodyJSON(req,12000);if(!store.settings.recruitmentOpen)throw httpError(403,store.settings.recruitmentClosedMessage||'O recrutamento está fechado.');
      const displayName=safeText(body.displayName,40),gameNickname=safeText(body.gameNickname,40),tag=cleanTag(body.playerTag),ageRange=safeText(body.ageRange,8),phone=normalizePhone(body.phone),phoneType=body.phoneType==='guardian'?'guardian':'self',brawler=rosterEntry(body.desiredBrawlerId),motivation=safeText(body.motivation,500);
      if(body.privacyAcknowledged!==true)throw httpError(400,'É necessário confirmar a leitura do aviso de privacidade.');if(!displayName||!gameNickname||!tag||!ageRange||!brawler)throw httpError(400,'Preencha todos os campos obrigatórios.');if(!tagIsValid(tag))throw httpError(400,'Tag inválida. Confira os caracteres permitidos.');if(!allowedAgeRanges.has(ageRange))throw httpError(400,'Faixa etária inválida.');if(!phone)throw httpError(400,'Telefone inválido. Digite um número brasileiro com DDD, por exemplo (11) 91234-5678, ou informe o código do país.');
      if(store.applications.some(a=>cleanTag(a.playerTag)===tag&&activeStatuses.has(a.status))||store.members.some(m=>cleanTag(m.playerTag)===tag&&m.status==='ACTIVE'))throw httpError(409,'Já existe uma candidatura ativa ou vínculo cadastrado para esta tag.');
      if(brawlerState(brawler.key)!=='AVAILABLE')throw httpError(409,'Este Brawler acabou de ser reservado ou representado. Escolha outro.');
      let apiLookupStatus='PENDING',trophiesAtApplication=null,applicationTrophiesCapturedAt=null,verifiedNickname=gameNickname;
      try{const api=await fetchPlayer(tag);apiLookupStatus='OK';trophiesAtApplication=validNumber(api.player.trophies)?Number(api.player.trophies):null;applicationTrophiesCapturedAt=api.fetchedAt;verifiedNickname=api.player.name||gameNickname;}catch(e){apiLookupStatus='UNAVAILABLE';}
      const application={id:id(),displayName,gameNickname:verifiedNickname,playerTag:tag,ageRange,phone,phoneType,desiredBrawlerId:brawler.id,desiredBrawlerKey:brawler.key,desiredBrawlerName:brawler.name,motivation,status:'PENDING',apiLookupStatus,trophiesAtApplication,applicationTrophiesCapturedAt,submittedAt:nowISO(),createdAt:nowISO(),updatedAt:nowISO(),privateNotes:[],history:[{status:'PENDING',at:nowISO(),by:'Sistema'}],reservationExpiresAt:new Date(Date.now()+store.settings.reservationHours*3600000).toISOString()};
      await mutate(()=>{if(!store.settings.recruitmentOpen)throw httpError(403,store.settings.recruitmentClosedMessage||'O recrutamento está fechado.');if(brawlerState(brawler.key)!=='AVAILABLE')throw httpError(409,'Este Brawler foi reservado por outra candidatura. Escolha outro.');if(store.applications.some(a=>cleanTag(a.playerTag)===tag&&activeStatuses.has(a.status))||store.members.some(m=>cleanTag(m.playerTag)===tag&&m.status==='ACTIVE'))throw httpError(409,'Já existe uma candidatura ativa ou vínculo cadastrado para esta tag.');store.applications.unshift(application);audit(null,'Candidatura recebida',`${displayName} • ${tag} • ${brawler.name}`);});return sendJSON(res,201,{ok:true,applicationId:application.id,status:application.status,apiLookupStatus,message:'Candidatura recebida. A administração fará a análise.'});
    }
    if(req.method==='POST'&&url.pathname==='/api/login'){
      rateLimit(req,'login',12,15*60*1000);const body=await bodyJSON(req,5000);const email=safeText(body.email,180).toLowerCase();const password=String(body.password||'');const user=store.users.find(u=>u.email===email&&!u.disabled);if(!user||!user.passwordHash)throw httpError(401,'E-mail ou senha incorretos.');const hash=await scrypt(password,user.salt,64);if(!crypto.timingSafeEqual(hash,Buffer.from(user.passwordHash,'hex')))throw httpError(401,'E-mail ou senha incorretos.');if(!SESSION_SECRET)throw httpError(503,'O login ainda não foi ativado. Configure STAR_PARK_SESSION_SECRET no servidor.');const sessionId=crypto.randomBytes(32).toString('hex');const csrf=crypto.randomBytes(24).toString('hex');sessions.set(sessionId,{userId:user.id,csrf,expiresAt:Date.now()+12*60*60*1000});setCookie(res,'sp_session',`${sessionId}.${sessionSignature(sessionId)}`,{httpOnly:true});setCookie(res,'sp_csrf',csrf,{httpOnly:false});return sendJSON(res,200,{ok:true,user:publicUser(user)});
    }
    if(req.method==='POST'&&url.pathname==='/api/member/account-requests'){
      rateLimit(req,'member-account-request',3,60*60*1000);
      const body=await bodyJSON(req,6000);
      const email=safeText(body.email,180).toLowerCase();
      const tag=cleanTag(body.playerTag);
      const password=String(body.password||'');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw httpError(400,'Informe um e-mail válido.');
      if(!tagIsValid(tag))throw httpError(400,'Tag de jogador inválida. Confira a tag no Brawl Stars.');
      if(password.length<12||password.length>128)throw httpError(400,'A senha precisa ter entre 12 e 128 caracteres.');
      const member=store.members.find(m=>cleanTag(m.playerTag)===tag&&m.status==='ACTIVE');
      if(!member)throw httpError(409,'Não encontramos um membro ativo com essa tag. A administração precisa cadastrar e ativar sua entrada na House primeiro.');
      if(store.users.some(u=>u.email===email))throw httpError(409,'Este e-mail já possui uma conta. Tente entrar ou fale com a administração.');
      if(store.users.some(u=>u.role==='MEMBER'&&u.memberId===member.id))throw httpError(409,'Este membro já possui uma conta vinculada. Fale com a administração para recuperar o acesso.');
      if(store.accountRequests.some(r=>r.status==='PENDING'&&(r.email===email||r.memberId===member.id)))throw httpError(409,'Já existe uma solicitação de acesso aguardando análise para este e-mail ou membro.');
      const salt=crypto.randomBytes(16).toString('hex');
      const passwordHash=(await scrypt(password,salt,64)).toString('hex');
      const requestRecord={id:id(),memberId:member.id,displayName:member.displayName,playerTag:tag,email,salt,passwordHash,status:'PENDING',createdAt:nowISO(),reviewedAt:null,reviewedBy:null};
      await mutate(()=>{
        const currentMember=store.members.find(m=>m.id===member.id&&m.status==='ACTIVE'&&cleanTag(m.playerTag)===tag);
        if(!currentMember)throw httpError(409,'O vínculo do jogador mudou. Peça à administração para confirmar seu cadastro.');
        if(store.users.some(u=>u.email===email)||store.users.some(u=>u.role==='MEMBER'&&u.memberId===currentMember.id)||store.accountRequests.some(r=>r.status==='PENDING'&&(r.email===email||r.memberId===currentMember.id)))throw httpError(409,'Já existe uma conta ou solicitação para este e-mail ou membro.');
        requestRecord.displayName=currentMember.displayName;
        store.accountRequests.unshift(requestRecord);
        audit(null,'Solicitação de conta de membro recebida',`${currentMember.displayName} • ${tag} • ${email}`);
      });
      return sendJSON(res,202,{ok:true,status:'PENDING',message:'Solicitação recebida. A administração precisa confirmar seu vínculo com a House antes de liberar o acesso.'});
    }
    if(req.method==='GET'&&url.pathname==='/api/session'){const user=currentUser(req);const session=getSession(req);return sendJSON(res,200,{authenticated:Boolean(user),user:user?publicUser(user):null,csrf:session?.csrf||null});}
    if(req.method==='POST'&&url.pathname==='/api/logout'){checkCsrf(req);const cookies=parseCookies(req);sessions.delete(String(cookies.sp_session||'').split('.')[0]);clearCookie(res,'sp_session');clearCookie(res,'sp_csrf');return sendJSON(res,200,{ok:true});}
    const user=currentUser(req);
    if(req.method==='GET'&&url.pathname==='/api/admin/api-diagnostics'){
      requirePermission(user,'api.sync');
      const checkedAt=nowISO();
      let safeBase='URL invalida';
      try{const parsedBase=new URL(API_BASE);safeBase=parsedBase.origin+parsedBase.pathname;}catch{}
      try{
        const payload=await officialFetch('/brawlers?limit=1',{bypassCooldown:true});
        const items=Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.list)?payload.list:Array.isArray(payload?.brawlers)?payload.brawlers:Array.isArray(payload)?payload:[];
        return sendJSON(res,200,{ok:true,checkedAt,base:safeBase,status:200,returnedItems:items.length,lastSuccessAt:lastOfficialApiSuccessAt,lastFailureAt:lastOfficialApiFailureAt,consecutiveFailures:officialApiFailureCount});
      }catch(error){
        return sendJSON(res,502,{ok:false,checkedAt,base:safeBase,configured:API_TOKEN_VALID,error:fmtError(error),diagnostic:error.diagnostic||lastOfficialApiDiagnostic,cooldownUntil:apiCooldownUntil?new Date(apiCooldownUntil).toISOString():null});
      }
    }

    if(req.method==='GET'&&url.pathname==='/api/member/me'){requirePermission(user,'member.self');const member=store.members.find(m=>m.id===user.memberId&&m.status==='ACTIVE');if(!member)throw httpError(404,'Perfil de membro não encontrado.');const battles=member.battleHistory||[];return sendJSON(res,200,{member:{...publicMember(member),gameNickname:member.gameNickname,playerTag:member.playerTag,baselineTrophies:member.baselineTrophies,baselineCapturedAt:member.baselineCapturedAt,baselineStatus:member.baselineStatus,apiSyncStatus:member.apiSyncStatus,apiSyncError:member.apiSyncError||null,playerStats:member.playerStats||null,brawlers:member.brawlers||[],trophyHistory:(member.trophyHistory||[]).slice(-60),battleStats:member.battleUsage?{...member.battleUsage,brawlers:Object.entries(member.battleUsage.brawlers||{}).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),modes:Object.entries(member.battleUsage.modes||{}).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count)}:aggregateBattleStats(battles),recentBattleHistory:battles.slice().sort((a,b)=>String(b.battleTime||b.observedAt).localeCompare(String(a.battleTime||a.observedAt))).slice(0,12),publicProfileSettings:member.publicProfileSettings||{}},events:store.events.filter(e=>e.status==='PUBLISHED').map(({registrations,...e})=>({...e,registrationsCount:registrations?.length||0})),announcements:store.announcements.filter(a=>a.status==='PUBLISHED'&&a.visibility!=='PUBLIC')});}
    if(req.method==='POST'&&url.pathname==='/api/member/profile'){checkCsrf(req);requirePermission(user,'member.self');const body=await bodyJSON(req);const member=store.members.find(m=>m.id===user.memberId&&m.status==='ACTIVE');if(!member)throw httpError(404,'Perfil de membro não encontrado.');const displayName=safeText(body.displayName,40),gameNickname=safeText(body.gameNickname,40);if(!displayName||!gameNickname)throw httpError(400,'Nome de exibição e nickname são obrigatórios.');await mutate(()=>{member.displayName=displayName;member.gameNickname=gameNickname;member.publicProfileSettings={...(member.publicProfileSettings||{}),public:body.public===true,showNickname:body.showNickname===true,showTag:body.showTag===true,showEvolution:body.showEvolution===true};audit(user,'Perfil pessoal atualizado',member.displayName);});return sendJSON(res,200,{ok:true});}
    if(req.method==='POST'&&url.pathname==='/api/member/privacy-request'){checkCsrf(req);requirePermission(user,'member.self');const body=await bodyJSON(req);const request={id:id(),userId:user.id,memberId:user.memberId,type:safeText(body.type,20),details:safeText(body.details,1000),status:'OPEN',createdAt:nowISO()};await mutate(()=>{store.privacyRequests.unshift(request);audit(user,'Solicitação de privacidade criada',request.type);});return sendJSON(res,201,{ok:true});}
    if(req.method==='POST'&&url.pathname==='/api/member/event-registration'){checkCsrf(req);requirePermission(user,'member.self');const body=await bodyJSON(req);const event=store.events.find(e=>e.id===body.eventId&&e.status==='PUBLISHED');if(!event)throw httpError(404,'Evento não encontrado.');await mutate(()=>{event.registrations=event.registrations||[];if(event.registrations.includes(user.memberId))return;if(event.limit&&event.registrations.length>=event.limit)throw httpError(409,'As vagas deste evento foram preenchidas.');event.registrations.push(user.memberId);audit(user,'Inscrição em evento',event.title);});return sendJSON(res,200,{ok:true});}
    if(url.pathname.startsWith('/api/admin/')){
      if(req.method==='GET'&&url.pathname==='/api/admin/overview'){requirePermission(user,'applications.read');const pending=store.applications.filter(a=>activeStatuses.has(a.status)).length;const members=store.members.filter(m=>m.status==='ACTIVE');return sendJSON(res,200,{pendingApplications:pending,activeMembers:members.length,reservedBrawlers:roster.filter(b=>brawlerState(b.key)==='RESERVED').length,baselinePending:members.filter(m=>m.baselineStatus==='PENDING_CAPTURE').length,apiFailures:members.filter(m=>m.apiSyncStatus!=='OK').length,upcomingEvents:store.events.filter(e=>e.status==='PUBLISHED'&&e.date>=new Date().toISOString().slice(0,10)).length,recentAudit:store.audit.slice(0,8)});}
      if(req.method==='GET'&&url.pathname==='/api/admin/applications'){requirePermission(user,'applications.read');const items=store.applications.map(a=>{const copy={...a};if(!hasPermission(user,'applications.phone'))delete copy.phone;return copy;});return sendJSON(res,200,{items});}
      if(req.method==='GET'&&url.pathname==='/api/admin/members'){requirePermission(user,'members.read');return sendJSON(res,200,{items:store.members});}
      if(req.method==='GET'&&url.pathname==='/api/admin/events'){requirePermission(user,'events.write');return sendJSON(res,200,{items:store.events});}
      if(req.method==='GET'&&url.pathname==='/api/admin/announcements'){requirePermission(user,'announcements.write');return sendJSON(res,200,{items:store.announcements});}
      if(req.method==='GET'&&url.pathname==='/api/admin/audit'){requirePermission(user,'audit.read');return sendJSON(res,200,{items:store.audit.slice(0,300)});}
      if(req.method==='GET'&&url.pathname==='/api/admin/users'){requirePermission(user,'users.read');return sendJSON(res,200,{items:store.users.map(publicUser)});}
      if(req.method==='GET'&&url.pathname==='/api/admin/account-requests'){
        requirePermission(user,'users.read');
        const items=store.accountRequests.slice().sort((a,b)=>(a.status==='PENDING'?-1:1)-(b.status==='PENDING'?-1:1)||String(b.createdAt).localeCompare(String(a.createdAt))).map(({salt,passwordHash,...r})=>r);
        return sendJSON(res,200,{items});
      }
      const approveAccount=url.pathname.match(/^\/api\/admin\/account-requests\/([^/]+)\/approve$/);
      if(req.method==='POST'&&approveAccount){
        checkCsrf(req);requirePermission(user,'users.write');
        let created=null;
        await mutate(()=>{
          const current=store.accountRequests.find(r=>r.id===approveAccount[1]);
          if(!current||current.status!=='PENDING'||!current.passwordHash||!current.salt)throw httpError(409,'A solicitação não está mais pendente ou expirou.');
          const member=store.members.find(m=>m.id===current.memberId&&m.status==='ACTIVE'&&cleanTag(m.playerTag)===cleanTag(current.playerTag));
          if(!member)throw httpError(409,'O vínculo do jogador não está mais ativo. Revalide o cadastro do membro antes de aprovar.');
          if(store.users.some(u=>u.email===current.email))throw httpError(409,'Este e-mail já foi utilizado por outra conta.');
          if(store.users.some(u=>u.role==='MEMBER'&&u.memberId===member.id))throw httpError(409,'Este membro já possui uma conta vinculada.');
          created={id:id(),name:member.displayName,email:current.email,role:'MEMBER',memberId:member.id,permissions:defaultPermissions('MEMBER'),salt:current.salt,passwordHash:current.passwordHash,createdAt:nowISO(),disabled:false};
          store.users.push(created);current.status='APPROVED';current.reviewedAt=nowISO();current.reviewedBy=user.id;current.salt=null;current.passwordHash=null;
          audit(user,'Conta de membro aprovada',`${member.displayName} • ${current.email}`);
        });
        return sendJSON(res,200,{ok:true,user:publicUser(created)});
      }
      const rejectAccount=url.pathname.match(/^\/api\/admin\/account-requests\/([^/]+)\/reject$/);
      if(req.method==='POST'&&rejectAccount){
        checkCsrf(req);requirePermission(user,'users.write');
        const body=await bodyJSON(req,2000);const reason=safeText(body.reason,250);
        const requestRecord=store.accountRequests.find(r=>r.id===rejectAccount[1]);
        if(!requestRecord||requestRecord.status!=='PENDING')throw httpError(404,'Solicitação pendente não encontrada.');
        await mutate(()=>{const current=store.accountRequests.find(r=>r.id===rejectAccount[1]);if(!current||current.status!=='PENDING')throw httpError(409,'A solicitação já foi analisada.');current.status='REJECTED';current.reviewedAt=nowISO();current.reviewedBy=user.id;current.reviewReason=reason;current.salt=null;current.passwordHash=null;audit(user,'Solicitação de conta rejeitada',`${current.displayName} • ${current.email} • ${reason}`);});
        return sendJSON(res,200,{ok:true});
      }

      if(req.method==='GET'&&url.pathname==='/api/admin/privacy'){requirePermission(user,'privacy.read');return sendJSON(res,200,{items:store.privacyRequests});}
      if(req.method==='GET'&&url.pathname==='/api/admin/settings'){requirePermission(user,'settings.write');return sendJSON(res,200,{settings:store.settings});}
      if(req.method==='POST'&&url.pathname==='/api/admin/members'){
        checkCsrf(req);requirePermission(user,'members.write');
        const body=await bodyJSON(req,10000);
        const displayName=safeText(body.displayName,40),gameNickname=safeText(body.gameNickname,40),tag=cleanTag(body.playerTag),brawler=rosterEntry(body.brawlerId);
        if(!displayName||!gameNickname||!tag||!brawler)throw httpError(400,'Preencha nome, nickname, tag e Brawler.');
        if(!tagIsValid(tag))throw httpError(400,'Tag inválida.');
        if(body.whatsappConfirmed!==true)throw httpError(400,'Confirme a entrada manual no WhatsApp antes de ativar.');
        if(store.members.some(m=>cleanTag(m.playerTag)===tag&&m.status==='ACTIVE'))throw httpError(409,'Esta tag já está cadastrada como membro ativo.');
        if(brawlerState(brawler.key)!=='AVAILABLE')throw httpError(409,'Este Brawler já está reservado ou representado.');
        let api=null;try{api=await fetchPlayer(tag,true);}catch{}
        const memberId=id();
        const battleRecords=api?extractBattleRecords(api.battlelog,tag,memberId):[];
        const member={id:memberId,displayName,gameNickname:api?.player?.name||gameNickname,playerTag:tag,representedBrawlerId:brawler.id,representedBrawlerKey:brawler.key,representedBrawlerName:brawler.name,status:'ACTIVE',joinedAt:nowISO(),createdAt:nowISO(),publicProfileSettings:{public:true,showNickname:true,showTag:false,showEvolution:true},currentTrophies:api&&validNumber(api.player.trophies)?Number(api.player.trophies):null,currentTrophiesCapturedAt:api?.fetchedAt||null,baselineTrophies:api&&validNumber(api.player.trophies)?Number(api.player.trophies):null,baselineCapturedAt:api?.fetchedAt||null,baselineStatus:api&&validNumber(api.player.trophies)?'CAPTURED':'PENDING_CAPTURE',apiSyncStatus:api?(api.battlelogAvailable?'OK':'PARTIAL'):'PENDING',apiSyncError:api?.battlelogError||null,playerStats:api?normalizePlayerStats(api.player):null,brawlers:api&&Array.isArray(api.player.brawlers)?api.player.brawlers.map(b=>({id:b.id??null,name:b.name,trophies:Number(b.trophies)||0,highestTrophies:validNumber(b.highestTrophies)?Number(b.highestTrophies):null,power:Number(b.power)||null,rank:Number(b.rank)||null})):[],recentBattles:api?(api.battlelog||[]).map(x=>({brawlerName:battleBrawlerName(x,tag)})).filter(x=>x.brawlerName):[],applicationId:null};
        await mutate(()=>{
          if(brawlerState(brawler.key)!=='AVAILABLE')throw httpError(409,'Este Brawler foi reservado ou representado durante o cadastro.');
          if(store.members.some(m=>cleanTag(m.playerTag)===tag&&m.status==='ACTIVE'))throw httpError(409,'Esta tag foi cadastrada por outra operação.');
          member.battleHistory=[];member.battleUsage={totalObserved:0,wins:0,losses:0,draws:0,brawlers:{},modes:{}};applyBattleRecords(member,battleRecords);store.members.unshift(member);
          if(member.baselineTrophies!==null)store.snapshots.push({id:id(),memberId:member.id,trophies:member.baselineTrophies,capturedAt:member.baselineCapturedAt,source:'brawl-stars-api',syncStatus:'CAPTURED'});
          audit(user,'Membro cadastrado',`${displayName} • ${tag} • ${brawler.name}`);
        });
        return sendJSON(res,201,{ok:true,member:{id:member.id,displayName:member.displayName,baselineStatus:member.baselineStatus}});
      }
      const transition=url.pathname.match(/^\/api\/admin\/applications\/([^/]+)\/transition$/);if(req.method==='POST'&&transition){checkCsrf(req);requirePermission(user,'applications.write');const body=await bodyJSON(req);const target=safeText(body.status,30);const app=store.applications.find(a=>a.id===transition[1]);if(!app)throw httpError(404,'Candidatura não encontrada.');const allowed={PENDING:['IN_REVIEW','CANCELLED'],IN_REVIEW:['NEEDS_INFORMATION','APPROVED','REJECTED','CANCELLED'],NEEDS_INFORMATION:['IN_REVIEW','REJECTED','CANCELLED'],APPROVED:['AWAITING_WHATSAPP','REJECTED','CANCELLED'],AWAITING_WHATSAPP:['REJECTED','CANCELLED']};if(!allowed[app.status]?.includes(target))throw httpError(409,`Transição não permitida: ${app.status} → ${target}.`);const originalStatus=app.status;await mutate(()=>{if(app.status!==originalStatus||!allowed[app.status]?.includes(target))throw httpError(409,'A candidatura foi atualizada por outra ação. Recarregue a lista.');app.status=target;app.updatedAt=nowISO();app.history.push({status:target,at:nowISO(),by:user.name,reason:safeText(body.reason,250)});if(['REJECTED','CANCELLED'].includes(target))app.reservationExpiresAt=null;audit(user,`Candidatura: ${target}`,`${app.displayName} • ${app.playerTag}`);});return sendJSON(res,200,{ok:true,status:target});}
      const activate=url.pathname.match(/^\/api\/admin\/applications\/([^/]+)\/confirm-whatsapp$/);
      if(req.method==='POST'&&activate){
        checkCsrf(req);requirePermission(user,'applications.write');
        const body=await bodyJSON(req);
        const app=store.applications.find(a=>a.id===activate[1]);
        if(!app)throw httpError(404,'Candidatura não encontrada.');
        if(app.status!=='AWAITING_WHATSAPP')throw httpError(409,'A candidatura precisa estar aguardando confirmação do WhatsApp.');
        const brawler=rosterEntry(app.desiredBrawlerId??app.desiredBrawlerKey);
        if(!brawler||brawlerState(brawler.key)!=='RESERVED')throw httpError(409,'A reserva do Brawler não está mais válida.');
        const member={id:id(),applicationId:app.id,displayName:app.displayName,gameNickname:app.gameNickname,playerTag:app.playerTag,representedBrawlerId:brawler.id,representedBrawlerKey:brawler.key,representedBrawlerName:brawler.name,status:'ACTIVE',joinedAt:nowISO(),createdAt:nowISO(),publicProfileSettings:{public:true,showNickname:true,showTag:false,showEvolution:true},currentTrophies:null,currentTrophiesCapturedAt:null,baselineTrophies:null,baselineCapturedAt:null,baselineStatus:'PENDING_CAPTURE',apiSyncStatus:'PENDING',playerStats:null,brawlers:[],recentBattles:[]};
        const baseline=await captureBaseline(member);Object.assign(member,baseline.updates);
        await mutate(()=>{
          if(app.status!=='AWAITING_WHATSAPP'||brawlerState(brawler.key)!=='RESERVED')throw httpError(409,'A candidatura ou a reserva mudou durante a ativação. Recarregue a lista.');
          app.status='ACTIVE';app.updatedAt=nowISO();app.history.push({status:'ACTIVE',at:nowISO(),by:user.name,reason:'Entrada no WhatsApp confirmada manualmente.'});app.reservationExpiresAt=null;
          member.battleHistory=[];member.battleUsage={totalObserved:0,wins:0,losses:0,draws:0,brawlers:{},modes:{}};applyBattleRecords(member,baseline.battleRecords||[]);store.members.unshift(member);store.snapshots.push(...baseline.snapshots);
          audit(user,'Membro ativado após WhatsApp',`${member.displayName} • ${member.playerTag}`);
        });
        return sendJSON(res,200,{ok:true,memberId:member.id,baselineStatus:member.baselineStatus});
      }
      const memberStatus=url.pathname.match(/^\/api\/admin\/members\/([^/]+)\/status$/);if(req.method==='POST'&&memberStatus){checkCsrf(req);requirePermission(user,'members.write');const body=await bodyJSON(req);const target=safeText(body.status,20);if(!['ACTIVE','SUSPENDED','LEFT'].includes(target))throw httpError(400,'Status de membro inválido.');const member=store.members.find(m=>m.id===memberStatus[1]);if(!member)throw httpError(404,'Membro não encontrado.');await mutate(()=>{if(target==='ACTIVE'&&brawlerState(member.representedBrawlerKey)!=='AVAILABLE'&&member.status!=='ACTIVE')throw httpError(409,'O Brawler deste membro foi reservado ou representado por outra pessoa.');const previous=member.status;member.status=target;member.statusUpdatedAt=nowISO();member.statusReason=safeText(body.reason,250);audit(user,`Status de membro: ${target}`,`${member.displayName} • ${previous} → ${target} • ${member.statusReason}`);});return sendJSON(res,200,{ok:true,status:target});}
      const baselineCorrection=url.pathname.match(/^\/api\/admin\/members\/([^/]+)\/baseline-correction$/);if(req.method==='POST'&&baselineCorrection){checkCsrf(req);requirePermission(user,'baseline.correct');const body=await bodyJSON(req);const value=Number(body.value),reason=safeText(body.reason,300);if(!Number.isInteger(value)||value<0||value>100000||reason.length<10)throw httpError(400,'Informe um baseline inteiro válido e uma justificativa com pelo menos 10 caracteres.');const member=store.members.find(m=>m.id===baselineCorrection[1]);if(!member)throw httpError(404,'Membro não encontrado.');await mutate(()=>{const previous=member.baselineTrophies;member.baselineTrophies=value;member.baselineStatus='CAPTURED';member.baselineCorrectedAt=nowISO();member.baselineCorrectionReason=reason;audit(user,'Correção excepcional de baseline',`${member.displayName}: ${previous??'pendente'} → ${value}. Motivo: ${reason}`);});return sendJSON(res,200,{ok:true});}
      const syncMember=url.pathname.match(/^\/api\/admin\/members\/([^/]+)\/sync$/);if(req.method==='POST'&&syncMember){checkCsrf(req);requirePermission(user,'members.write');const m=store.members.find(x=>x.id===syncMember[1]&&x.status==='ACTIVE');if(!m)throw httpError(404,'Membro não encontrado.');const refresh=await refreshMember({id:m.id,displayName:m.displayName,playerTag:m.playerTag,gameNickname:m.gameNickname,baselineStatus:m.baselineStatus,currentTrophies:m.currentTrophies,currentTrophiesCapturedAt:m.currentTrophiesCapturedAt,trophyHistory:m.trophyHistory});await mutate(()=>{const current=store.members.find(x=>x.id===syncMember[1]&&x.status==='ACTIVE');if(!current)throw httpError(404,'Membro não encontrado.');const previous=current.currentTrophies;const previousAt=current.currentTrophiesCapturedAt;Object.assign(current,refresh.updates);const history=Array.isArray(current.trophyHistory)?current.trophyHistory.slice():[];if(!history.length&&validNumber(previous))history.push({trophies:Number(previous),capturedAt:previousAt||null,source:'profile-cache'});const next=refresh.updates.currentTrophies;if(validNumber(next)&&(!history.length||Number(history.at(-1).trophies)!==Number(next)))history.push({trophies:Number(next),capturedAt:refresh.updates.currentTrophiesCapturedAt,source:'brawl-stars-api'});current.trophyHistory=history.slice(-180);store.snapshots.push(...refresh.snapshots);const known=new Set((current.battleHistory||[]).map(b=>b.id));applyBattleRecords(current,(refresh.battleRecords||[]).filter(b=>!known.has(b.id)));store.snapshots=store.snapshots.slice(-50000);audit(user,'Sincronização de jogador',`${current.displayName} • ${current.playerTag}`);});const updated=store.members.find(x=>x.id===syncMember[1]);return sendJSON(res,200,{ok:true,currentTrophies:updated?.currentTrophies??null,baselineStatus:updated?.baselineStatus||'PENDING_CAPTURE',apiSyncStatus:updated?.apiSyncStatus||'PENDING'});}
      if(req.method==='POST'&&url.pathname==='/api/admin/events'){checkCsrf(req);requirePermission(user,'events.write');const body=await bodyJSON(req);const title=safeText(body.title,80),date=safeText(body.date,10);if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw httpError(400,'Informe título e data válida.');const event={id:id(),title,date,time:safeText(body.time,5),type:safeText(body.type,30),limit:body.limit?Math.max(1,Math.min(500,Number(body.limit))):null,description:safeText(body.description,1200),status:body.status==='DRAFT'?'DRAFT':'PUBLISHED',registrations:[],createdAt:nowISO(),createdBy:user.id};await mutate(()=>{store.events.unshift(event);audit(user,'Evento criado',title);});return sendJSON(res,201,{ok:true});}
      const updateEvent=url.pathname.match(/^\/api\/admin\/events\/([^/]+)$/);if(req.method==='PUT'&&updateEvent){checkCsrf(req);requirePermission(user,'events.write');const body=await bodyJSON(req);const event=store.events.find(e=>e.id===updateEvent[1]);if(!event)throw httpError(404,'Evento não encontrado.');const title=safeText(body.title,80),date=safeText(body.date,10);if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw httpError(400,'Informe título e data válida.');await mutate(()=>{event.title=title;event.date=date;event.time=safeText(body.time,5);event.type=safeText(body.type,30);event.limit=body.limit?Math.max(1,Math.min(500,Number(body.limit))):null;event.description=safeText(body.description,1200);event.status=body.status==='DRAFT'?'DRAFT':'PUBLISHED';event.updatedAt=nowISO();audit(user,'Evento atualizado',title);});return sendJSON(res,200,{ok:true});}
      const deleteEvent=url.pathname.match(/^\/api\/admin\/events\/([^/]+)$/);if(req.method==='DELETE'&&deleteEvent){checkCsrf(req);requirePermission(user,'events.write');await mutate(()=>{const e=store.events.find(x=>x.id===deleteEvent[1]);store.events=store.events.filter(x=>x.id!==deleteEvent[1]);audit(user,'Evento removido',e?.title||deleteEvent[1]);});return sendJSON(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/admin/announcements'){checkCsrf(req);requirePermission(user,'announcements.write');const body=await bodyJSON(req);const title=safeText(body.title,100),content=safeText(body.content,3000);if(!title||!content)throw httpError(400,'Título e conteúdo são obrigatórios.');const announcement={id:id(),title,content,category:safeText(body.category,30),visibility:body.visibility==='MEMBERS'?'MEMBERS':'PUBLIC',pinned:body.pinned===true,status:'PUBLISHED',createdAt:nowISO(),createdBy:user.id,author:user.name};await mutate(()=>{store.announcements.unshift(announcement);audit(user,'Comunicado publicado',title);});return sendJSON(res,201,{ok:true});}
      const updateAnnouncement=url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);if(req.method==='PUT'&&updateAnnouncement){checkCsrf(req);requirePermission(user,'announcements.write');const body=await bodyJSON(req);const a=store.announcements.find(x=>x.id===updateAnnouncement[1]);if(!a)throw httpError(404,'Comunicado não encontrado.');const title=safeText(body.title,100),content=safeText(body.content,3000);if(!title||!content)throw httpError(400,'Título e conteúdo são obrigatórios.');await mutate(()=>{a.title=title;a.content=content;a.category=safeText(body.category,30);a.visibility=body.visibility==='MEMBERS'?'MEMBERS':'PUBLIC';a.pinned=body.pinned===true;a.status='PUBLISHED';a.updatedAt=nowISO();audit(user,'Comunicado atualizado',title);});return sendJSON(res,200,{ok:true});}
      const archiveAnnouncement=url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)\/archive$/);if(req.method==='POST'&&archiveAnnouncement){checkCsrf(req);requirePermission(user,'announcements.write');const a=store.announcements.find(x=>x.id===archiveAnnouncement[1]);if(!a)throw httpError(404,'Comunicado não encontrado.');await mutate(()=>{a.status='ARCHIVED';a.archivedAt=nowISO();audit(user,'Comunicado arquivado',a.title);});return sendJSON(res,200,{ok:true});}
      const deleteAnnouncement=url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);if(req.method==='DELETE'&&deleteAnnouncement){checkCsrf(req);requirePermission(user,'announcements.write');await mutate(()=>{const a=store.announcements.find(x=>x.id===deleteAnnouncement[1]);store.announcements=store.announcements.filter(x=>x.id!==deleteAnnouncement[1]);audit(user,'Comunicado removido',a?.title||deleteAnnouncement[1]);});return sendJSON(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/admin/users'){checkCsrf(req);if(user?.role!=='OWNER')throw httpError(403,'Somente o OWNER pode criar contas e convites.');const body=await bodyJSON(req);const name=safeText(body.name,60),email=safeText(body.email,180).toLowerCase(),password=String(body.password||''),role=safeText(body.role,20);if(!name||!email.includes('@')||password.length<12||!roles.has(role)||role==='OWNER')throw httpError(400,'Dados inválidos. Senha mínima de 12 caracteres; OWNER não pode ser criado por este formulário.');if(store.users.some(u=>u.email===email))throw httpError(409,'Já existe uma conta com este e-mail.');const salt=crypto.randomBytes(16).toString('hex');const passwordHash=(await scrypt(password,salt,64)).toString('hex');if(role!=='MEMBER'&&user.role!=='OWNER')throw httpError(403,'Somente o OWNER pode criar contas administrativas.');const memberId=safeText(body.memberId,80)||null;if(role==='MEMBER'&&(!memberId||!store.members.some(m=>m.id===memberId&&m.status==='ACTIVE')))throw httpError(400,'Associe a conta a um membro ativo.');const created={id:id(),name,email,role,memberId,permissions:defaultPermissions(role),salt,passwordHash,createdAt:nowISO(),disabled:false};await mutate(()=>{if(store.users.some(u=>u.email===email))throw httpError(409,'Já existe uma conta com este e-mail.');store.users.push(created);audit(user,'Conta criada',`${email} • ${role}`);});return sendJSON(res,201,{ok:true,user:publicUser(created)});}
      if(req.method==='POST'&&url.pathname==='/api/admin/settings'){checkCsrf(req);requirePermission(user,'settings.write');const body=await bodyJSON(req);await mutate(()=>{store.settings={...store.settings,recruitmentOpen:body.recruitmentOpen===true,showNickname:body.showNickname===true,showTag:body.showTag===true,showEvolution:body.showEvolution===true,reservationHours:Math.max(1,Math.min(336,Number(body.reservationHours)||72))};audit(user,'Configurações atualizadas','Preferências da House');});return sendJSON(res,200,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/admin/messages/log'){checkCsrf(req);requirePermission(user,'messages.write');const body=await bodyJSON(req);const state=safeText(body.state,40);if(!['PREPARED','CHAT_OPENED','SENT_CONFIRMED_MANUALLY','CONTACT_CONFIRMED'].includes(state))throw httpError(400,'Estado de comunicação inválido.');const recipientType=body.recipientType==='member'?'member':'application';const recipientId=safeText(body.recipientId,80);const log={id:id(),recipientType,recipientId,state,template:safeText(body.template,40),createdAt:nowISO(),createdBy:user.id};await mutate(()=>{store.messageLogs.unshift(log);audit(user,`WhatsApp: ${state}`,`${recipientType} • ${recipientId}`);});return sendJSON(res,201,{ok:true});}
      if(req.method==='POST'&&url.pathname==='/api/admin/sync-players'){
        checkCsrf(req);requirePermission(user,'api.sync');
        if(!API_TOKEN_VALID)throw httpError(503,'Configure BRAWL_STARS_API_TOKEN no Render antes de sincronizar jogadores.');
        if(playerSyncInProgress)throw httpError(409,'Já existe uma sincronização de jogadores em andamento.');
        if(Date.now()<apiCooldownUntil)throw httpError(429,'A API oficial está em pausa de segurança. Tente novamente após o horário informado no painel.');
        syncAllMembers().then(result=>console.log('[STAR PARK] Sincronização manual finalizada:',result)).catch(error=>console.error('[STAR PARK] Sincronização manual falhou:',fmtError(error)));
        await mutate(()=>audit(user,'Sincronização manual de todos os jogadores','Solicitada pelo painel de integração.'));
        return sendJSON(res,202,{ok:true,queued:true,intervalSeconds:PLAYER_SYNC_INTERVAL_SECONDS,message:'Sincronização iniciada no servidor. Acompanhe o resultado nesta tela.'});
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/sync-brawlers'){checkCsrf(req);requirePermission(user,'api.sync');const result=await syncBrawlers();await mutate(()=>audit(user,'Catálogo visual sincronizado',`${result.count} Brawlers`));return sendJSON(res,200,result);}
      if(req.method==='POST'&&url.pathname==='/api/admin/privacy/resolve'){checkCsrf(req);requirePermission(user,'privacy.read');const body=await bodyJSON(req);const r=store.privacyRequests.find(x=>x.id===body.id);if(!r)throw httpError(404,'Solicitação não encontrada.');await mutate(()=>{r.status='REVIEWED';r.reviewedAt=nowISO();r.reviewedBy=user.id;audit(user,'Solicitação de privacidade analisada',r.type);});return sendJSON(res,200,{ok:true});}
      return sendJSON(res,404,{error:'Rota administrativa inexistente.'});
    }
    const playerMatch=url.pathname.match(/^\/api\/player\/([^/]+)$/);if(req.method==='GET'&&playerMatch){rateLimit(req,'player',30,5*60*1000);const result=await fetchPlayer(playerMatch[1],url.searchParams.get('fresh')==='1');return sendJSON(res,200,result);}
    if(url.pathname.startsWith('/api/'))return sendJSON(res,404,{error:'Rota de API inexistente.'});
    return serveStatic(req,res,url);
  }catch(error){const status=Number(error.status)||500;return sendJSON(res,status,{error:fmtError(error)});}
});
server.listen(PORT,'0.0.0.0',()=>{console.log(`STAR PARK pronta na porta ${PORT}`);console.log(`Catálogo: ${roster.length} Brawlers (${rosterSource}).`);if(!API_TOKEN_VALID)console.log('API Brawl Stars desativada: configure BRAWL_STARS_API_TOKEN no .env.');if(!SESSION_SECRET||!OWNER_EMAIL||!OWNER_PASSWORD)console.log('Login administrativo desativado: configure STAR_PARK_OWNER_EMAIL, STAR_PARK_OWNER_PASSWORD e STAR_PARK_SESSION_SECRET.');});

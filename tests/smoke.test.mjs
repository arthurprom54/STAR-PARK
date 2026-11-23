import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let child,base,tempData;
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function waitForServer(){for(let i=0;i<60;i++){try{const r=await fetch(`${base}/api/health`);if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Servidor de teste não iniciou.');}
before(async()=>{const port=await freePort();base=`http://127.0.0.1:${port}`;tempData=await fs.mkdtemp(path.join(os.tmpdir(),'starpark-test-'));child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,PORT:String(port),STAR_PARK_DATA_DIR:tempData,BRAWL_STARS_API_TOKEN:'',STAR_PARK_OWNER_EMAIL:'',STAR_PARK_OWNER_PASSWORD:'',STAR_PARK_SESSION_SECRET:'',STAR_PARK_DISABLE_CATALOG_SYNC:'1',STAR_PARK_RECRUITMENT_OPEN_ON_BOOT:'true'},stdio:'ignore'});await waitForServer();});
after(async()=>{if(child&&!child.killed)child.kill('SIGTERM');if(tempData)await fs.rm(tempData,{recursive:true,force:true});});

test('servidor inicia com catálogo inicial e API explicitamente desativada',async()=>{const r=await fetch(`${base}/api/health`);const h=await r.json();assert.equal(h.ok,true);assert.equal(h.apiConfigured,false);assert.equal(h.appVersion,'5.0.2');assert.equal(h.playerSync.intervalSeconds,60);assert.equal(h.playerSync.minRequestIntervalMs,300);assert.ok(h.brawlerCount>0);});

test('catálogo público inclui o snapshot e os três lançamentos de novembro de 2026 sem duplicatas',async()=>{const r=await fetch(`${base}/api/brawlers`);assert.equal(r.status,200);const data=await r.json();assert.ok(data.items.length>=111);assert.equal(new Set(data.items.map(x=>x.key)).size,data.items.length);assert.ok(data.items.every(x=>x.name&&x.key));for(const name of ['Thunder Frogs','Rey','Ruby'])assert.ok(data.items.some(x=>x.name===name),`Faltou ${name}`);assert.ok(!data.items.some(x=>x.name==='Buzz Lightyear'));assert.ok(data.items.filter(x=>['Thunder Frogs','Rey','Ruby'].includes(x.name)).every(x=>x.imageUrl2));assert.ok(data.items.filter(x=>!['Thunder Frogs','Rey','Ruby'].includes(x.name)).every(x=>x.modelImageUrl&&x.modelImageUrl.includes('/brawlers/model/')));});

test('candidatura rejeita faixa etária inválida sem criar reserva',async()=>{const r=await fetch(`${base}/api/applications`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Teste',gameNickname:'Teste',playerTag:'PYLQG',ageRange:'10-11',phone:'+5511999999999',phoneType:'self',desiredBrawlerId:'shelly',privacyAcknowledged:true})});assert.equal(r.status,400);});

test('candidatura não bloqueia após tentativas inválidas e aceita telefone brasileiro sem código do país',async()=>{
 for(let i=0;i<7;i++){
  const invalid=await fetch(`${base}/api/applications`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Teste',gameNickname:'Teste',playerTag:`PYLQ${i}G`,ageRange:'10-11',phone:'11912345678',phoneType:'self',desiredBrawlerId:'colt',privacyAcknowledged:true})});
  assert.equal(invalid.status,400);
 }
 const valid=await fetch(`${base}/api/applications`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Telefone Brasil',gameNickname:'Telefone Brasil',playerTag:'JY2P9',ageRange:'18-24',phone:'(11) 91234-5678',phoneType:'self',desiredBrawlerId:'colt',privacyAcknowledged:true})});
 assert.equal(valid.status,201);
});

test('reserva de Brawler é atômica sob duas candidaturas simultâneas',async()=>{const make=(tag,name,phone)=>fetch(`${base}/api/applications`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:name,gameNickname:name,playerTag:tag,ageRange:'18-24',phone,phoneType:'self',desiredBrawlerId:'shelly',privacyAcknowledged:true})});const results=await Promise.all([make('PYLQG','Jogador A','+5511999999991'),make('QRGPL','Jogador B','+5511999999992')]);const statuses=results.map(r=>r.status).sort();assert.deepEqual(statuses,[201,409]);const roster=await (await fetch(`${base}/api/brawlers`)).json();assert.equal(roster.items.find(b=>b.key==='shelly').status,'RESERVED');});

test('métricas não inventam troféus quando não há membros ativos',async()=>{const r=await fetch(`${base}/api/public/summary`);const s=await r.json();assert.equal(s.activeMembers,0);assert.equal(s.totalTrophies,null);assert.equal(s.mostUsedBrawler,null);assert.equal(s.totalOfficialVictories,null);assert.equal(s.totalBrawlersOwned,null);assert.equal(s.profileStatsCoverage,0);});

test('dados de candidaturas não são públicos e exigem autenticação',async()=>{const r=await fetch(`${base}/api/admin/applications`);assert.equal(r.status,401);});

test('arte original da identidade visual é servido pelo próprio site',async()=>{const r=await fetch(`${base}/assets/hero-crew.svg`);assert.equal(r.status,200);assert.match(await r.text(),/<svg[^>]+viewBox/);});


test('acessos são separados da navegação pública e exibem escolha de portal',async()=>{
 const html=await fs.readFile(path.join(ROOT,'public','index.html'),'utf8');
 const app=await fs.readFile(path.join(ROOT,'public','app.js'),'utf8');
 assert.match(html,/id=\"page-access\"/);
 assert.match(html,/id=\"topAccessButton\"/);
 assert.match(html,/id=\"memberLoginForm\"/);
 assert.match(html,/id=\"memberAccountRequestForm\"/);
 assert.match(html,/id=\"adminLoginForm\"/);
 assert.doesNotMatch(html,/class=\"workspace-switch\"/);
 assert.match(app,/expectedRole==='MEMBER'/);
 assert.match(app,/expectedRole==='ADMIN'/);
});


test('folha de estilos corresponde à estrutura atual e mantém o layout mobile',async()=>{
 const css=await fs.readFile(path.join(ROOT,'public','styles.css'),'utf8');
 for(const selector of ['.app-shell','.main-area','.topbar','.hero-panel','.hero-copy','.hero-scene','.section-heading','.metric-grid','.two-col','.game-panel','.brand-lockup','.top-access-btn','.access-choice-grid']) assert.ok(css.includes(selector),`Seletor ausente: ${selector}`);
 assert.match(css,/@media\s*\(max-width:\s*600px\)/);
 assert.match(css,/\.hero-panel\s*\{/);
});

test('arquivos internos do servidor, configuração e documentação não são servidos ao navegador',async()=>{
 for(const file of ['/server.mjs','/package.json','/firestore.rules','/.env.example','/docs/publicar.md','/lib/firestore-store.mjs','/scripts/migrate-json-to-firestore.mjs','/tests/smoke.test.mjs']){
  const r=await fetch(`${base}${file}`);
  assert.equal(r.status,404,`${file} não deve ser público`);
 }
 const html=await fetch(`${base}/`);
 assert.equal(html.status,200);
});

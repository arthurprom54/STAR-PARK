'use strict';
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const fmt=v=>v==null?'—':new Intl.NumberFormat('pt-BR').format(v);
const dateTime=v=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
const dateLabel=v=>v?new Date(`${v}T12:00:00`).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}):'—';
const initials=v=>String(v||'SP').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let roster=[],summary={},members=[],events=[],announcements=[],auth={user:null,csrf:null},admin={applications:[],members:[],events:[],announcements:[],users:[],accountRequests:[],audit:[],privacy:[]};
let currentArea='public',currentPage='home',currentRank='trophies',toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200);}
async function api(url,options={}){const method=(options.method||'GET').toUpperCase();const headers={...(options.headers||{})};if(options.body&&!headers['Content-Type'])headers['Content-Type']='application/json';if(!['GET','HEAD'].includes(method)&&auth.csrf)headers['X-CSRF-Token']=auth.csrf;const response=await fetch(url,{...options,headers,credentials:'same-origin',cache:'no-store'});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||`Erro ${response.status}`);return payload;}
function setFeedback(selector,message,isError=false){const el=$(selector);if(!el)return;el.textContent=message;el.classList.toggle('error',isError);}
function setPage(name){
 const isMemberPage=name.startsWith('member-')&&name!=='member-gate';
 const isAdminPage=name.startsWith('admin-')&&name!=='admin-gate';
 if(isMemberPage&&auth.user?.role!=='MEMBER')name='member-gate';
 if(isAdminPage&&(!auth.user||auth.user.role==='MEMBER'))name='admin-gate';
 const page=$(`#page-${name}`);if(!page)return;currentPage=name;
 $$('.page').forEach(p=>p.classList.toggle('active',p===page));
 $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===name));
 const active=$(`.nav-item[data-page="${name}"]`);
 $('#crumb').textContent=active?.textContent.trim().toUpperCase()||name.toUpperCase();
 $('#sidebar').classList.remove('open');$('#mobileScrim').classList.remove('show');
 window.scrollTo({top:0,behavior:'smooth'});
}
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setPage(b.dataset.page)));
document.addEventListener('click',e=>{const go=e.target.closest('[data-go]');if(go)setPage(go.dataset.go);const action=e.target.closest('[data-action]');if(action?.dataset.action==='logout')logout();});
$('#menuToggle').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#mobileScrim').classList.add('show');});$('#mobileScrim').addEventListener('click',()=>{$('#sidebar').classList.remove('open');$('#mobileScrim').classList.remove('show');});
function roleName(role){return ({OWNER:'Proprietário',ADMIN:'Administrador',MODERATOR:'Administrador',MEMBER:'Membro'}[role]||'Visitante');}
function setIdentity(){
 const u=auth.user;$('#sideIdentity').textContent=u?.name||'Visitante';$('#sideRole').textContent=u?roleName(u.role):'Acesso público';$('#topIdentity').textContent=u?initials(u.name):'SP';
 $('#topAccessButton').textContent=u?'MEU ESPAÇO':'ENTRAR';$('#topLogoutButton').hidden=!u;
 $('#sidebarSectionLabel').textContent=u?(u.role==='MEMBER'?'ESPAÇO DO MEMBRO':'CENTRAL ADMINISTRATIVA'):'EXPLORAR A STAR PARK';
}
function applyNavigation(){const area=!auth.user?'public':auth.user.role==='MEMBER'?'member':'admin';currentArea=area;$$('.area-nav').forEach(n=>n.classList.toggle('active',n.id===`${area}Nav`));}
async function loadSession(){try{const s=await api('/api/session');auth.user=s.user;auth.csrf=s.csrf;}catch{auth={user:null,csrf:null};}setIdentity();applyNavigation();}
$('#topAccessButton').addEventListener('click',()=>{if(!auth.user){setPage('access');return;}if(auth.user.role==='MEMBER'){setPage('member-home');loadMemberPortal();}else{setPage('admin-home');loadAdminData();}});
async function login(form,feedback,expectedRole){
 const values=Object.fromEntries(new FormData(form));
 try{
  const r=await api('/api/login',{method:'POST',body:JSON.stringify(values)});
  auth.user=r.user;const s=await api('/api/session');auth.csrf=s.csrf;
  if(expectedRole==='MEMBER'&&r.user.role!=='MEMBER')throw new Error('Esta conta não é de membro. Use o acesso administrativo.');
  if(expectedRole==='ADMIN'&&r.user.role==='MEMBER')throw new Error('Esta conta é de membro. Use o portal dos membros.');
  setIdentity();applyNavigation();form.reset();
  if(auth.user.role==='MEMBER'){setPage('member-home');await loadMemberPortal();}else{setPage('admin-home');await loadAdminData();}
  toast('Acesso autorizado.');
 }catch(e){if(auth.user){try{await api('/api/logout',{method:'POST',body:'{}'});}catch{}auth={user:null,csrf:null};setIdentity();applyNavigation();}setFeedback(feedback,e.message,true);}
}
$('#memberLoginForm').addEventListener('submit',e=>{e.preventDefault();login(e.currentTarget,'#memberLoginFeedback','MEMBER');});
$('#adminLoginForm').addEventListener('submit',e=>{e.preventDefault();login(e.currentTarget,'#adminLoginFeedback','ADMIN');});
$('#memberAccountRequestForm').addEventListener('submit',async e=>{
 e.preventDefault();const form=e.currentTarget;const body=Object.fromEntries(new FormData(form));
 if(body.password!==body.confirmPassword){setFeedback('#memberAccountRequestFeedback','As senhas não coincidem.',true);return;}
 delete body.confirmPassword;
 const button=form.querySelector('button[type="submit"]');button.disabled=true;
 try{const result=await api('/api/member/account-requests',{method:'POST',body:JSON.stringify(body)});form.reset();setFeedback('#memberAccountRequestFeedback',result.message||'Solicitação enviada. Aguarde a aprovação da administração.');toast('Pedido de acesso enviado.');}
 catch(error){setFeedback('#memberAccountRequestFeedback',error.message,true);}
 finally{button.disabled=false;}
});

async function logout(){try{await api('/api/logout',{method:'POST',body:'{}'});}catch{}auth={user:null,csrf:null};setIdentity();applyNavigation();setPage('home');toast('Sessão encerrada.');}
function slugKey(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function safeImageUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['cdn.brawlify.com','cdn-misc.brawlify.com','cdn.brawlhub.gg'].includes(u.hostname)?u.href:null;}catch{return null;}}
function mapGameBrawler(item,stateMap=new Map()){
 const key=slugKey(item.hash||item.name),state=stateMap.get(key)||{};
 const id=Number(item.id)||null;
 return {id,key,name:item.name,releaseNumber:Number(item.releaseNumber)||(id?id-16000000:null),sortOrder:id??(Number(item.releaseNumber)?16000000+Number(item.releaseNumber):99999999),rarity:item.rarity?.name||item.rarity||null,rarityColor:item.rarity?.color||null,class:item.class?.name||null,description:item.description||'',imageUrl:safeImageUrl(item.imageUrl),imageUrl2:safeImageUrl(item.imageUrl2),imageUrl3:safeImageUrl(item.imageUrl3),modelImageUrl:id?`https://cdn.brawlify.com/brawlers/model/${id}.png`:null,starPowers:Array.isArray(item.starPowers)?item.starPowers:[],gadgets:Array.isArray(item.gadgets)?item.gadgets:[],released:item.released!==false,status:state.status||'AVAILABLE',representative:state.representative||null};
}
async function fetchLiveBrawlerCatalog(serverItems=[]){
 const response=await fetch('https://api.brawlapi.com/v1/brawlers',{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error(`Catálogo público respondeu com HTTP ${response.status}.`);
 const payload=await response.json(),items=Array.isArray(payload?.list)?payload.list:[];
 if(items.length<50)throw new Error('A fonte externa retornou um catálogo incompleto.');
 const supplementResponse=await fetch('./brawlers-supplement.json',{cache:'no-store'}).catch(()=>null);
 const supplements=supplementResponse?.ok?await supplementResponse.json().catch(()=>[]):[];
 const merged=[...items.filter(item=>item?.released!==false),...(Array.isArray(supplements)?supplements:[])];
 const stateMap=new Map(serverItems.map(item=>[item.key||slugKey(item.name),item]));
 const seen=new Set();return merged.map(item=>mapGameBrawler(item,stateMap)).filter(item=>item.name&&item.key&&!seen.has(item.key)&&seen.add(item.key)).sort((x,y)=>(x.sortOrder??99999999)-(y.sortOrder??99999999)||x.name.localeCompare(y.name,'pt-BR'));
}
async function loadBrawlerCatalog(serverResult){
 const serverItems=serverResult?.items||[];
 // Render the local/server snapshot immediately. It includes stable Brawlify model URLs,
 // so the gallery does not depend on a successful third-party API request to show art.
 if(serverItems.length){
   roster=serverItems.map(item=>({...item,modelImageUrl:item.modelImageUrl||(item.id?`https://cdn.brawlify.com/brawlers/model/${item.id}.png`:null)}));
   updateCatalogMeta(serverResult);
 }
 // Always try the public catalogue to enrich rarity, class, powers and newly released
 // characters. A snapshot with only a handful of image URLs must never suppress this fetch.
 try{
   const live=await fetchLiveBrawlerCatalog(serverItems);
   if(live.length<Math.max(100,serverItems.length-10))throw new Error('A fonte pública não confirmou uma lista completa; a lista local foi preservada.');
   roster=live;
   updateCatalogMeta({count:roster.length,source:'brawlapi-live',lastSuccessfulSync:new Date().toISOString(),apiConfigured:serverResult?.apiConfigured===true});
 }catch(error){
   if(serverItems.length){
     roster=serverItems.map(item=>({...item,modelImageUrl:item.modelImageUrl||(item.id?`https://cdn.brawlify.com/brawlers/model/${item.id}.png`:null)}));
     updateCatalogMeta({...serverResult,source:serverResult?.source||'local-fallback',lastSyncError:error.message});
   }else{
     try{
       const fallback=await fetch('./brawlers.json',{cache:'no-store'});
       if(!fallback.ok)throw error;
       const local=await fallback.json();
       roster=Array.isArray(local)?local.map(item=>({...item,id:item.id||16000000+(item.releaseNumber||0),modelImageUrl:item.modelImageUrl||`https://cdn.brawlify.com/brawlers/model/${16000000+(item.releaseNumber||0)}.png`,imageUrl:null,imageUrl2:null,status:'AVAILABLE'})):[];
       const supplements=await fetch('./brawlers-supplement.json',{cache:'no-store'}).then(r=>r.ok?r.json():[]).catch(()=>[]);
       roster=[...roster,...(Array.isArray(supplements)?supplements.map(item=>mapGameBrawler(item)):[])];
       updateCatalogMeta({count:roster.length,source:'local-fallback',lastSyncError:error.message});
     }catch{roster=[];updateCatalogMeta({count:0,source:'unavailable',lastSyncError:error.message});}
   }
 }
}
async function loadPublic(){
 const results=await Promise.allSettled([api('/api/brawlers'),api('/api/public/summary'),api('/api/public/members'),api('/api/public/events'),api('/api/public/announcements'),api('/api/public/settings')]);
 const catalogResult=results[0].status==='fulfilled'?results[0].value:null;
 await loadBrawlerCatalog(catalogResult);
 renderBrawlers();populateBrawlerSelects();renderHeroBrawlerCast();
 if(results[1].status==='fulfilled')summary=results[1].value;else summary={};
 if(results[2].status==='fulfilled')members=results[2].value.items||[];else members=[];
 if(results[3].status==='fulfilled')events=results[3].value.items||[];else events=[];
 if(results[4].status==='fulfilled')announcements=results[4].value.items||[];else announcements=[];
 if(results[5].status==='fulfilled')updateRecruitSettings(results[5].value);
 renderHome();renderDirectory();renderRankings();renderStatistics();renderEvents();renderAnnouncements();updateHeader();
}
function updateHeader(){const pill=$('#apiPill');api('/api/health').then(h=>{pill.classList.toggle('offline',!h.apiConfigured);pill.querySelector('span').textContent=h.apiConfigured?'API de jogadores conectada':'API de jogadores pendente';pill.title='O catálogo de Brawlers funciona independentemente da chave privada da API de jogadores.';}).catch(()=>{pill.classList.add('offline');pill.querySelector('span').textContent='Servidor indisponível';});}
function renderHome(){
 const brawlerCount=roster.length||summary.brawlerCount||0;
 const represented=summary.representedBrawlers||0;
 const reserved=summary.reservedBrawlers||0;
 const available=summary.availableBrawlers??Math.max(0,brawlerCount-represented-reserved);
 $('#statMembers').textContent=fmt(summary.activeMembers||0);
 $('#statTrophies').textContent=summary.totalTrophies==null?'—':fmt(summary.totalTrophies);
 $('#statRepresented').textContent=`${fmt(represented)}/${fmt(brawlerCount)}`;
 $('#statMostUsed').textContent=summary.mostUsedBrawler?.name||'—';
 $('#brawlerTotal').textContent=fmt(brawlerCount);
 $('#representedPercent').textContent=`${brawlerCount?Math.round((represented/brawlerCount)*100):0}%`;
 $('#availableCount').textContent=`${fmt(available)} disponíveis`;
 $('#reservedCount').textContent=`${fmt(reserved)} reservados`;
 $('#activeBrawlerCount').textContent=`${fmt(represented)} representados`;
 const pct=brawlerCount?Math.max(0,Math.min(100,(represented/brawlerCount)*100)):0;
 $('#brawlerDonut').style.background=`conic-gradient(#9d82ef ${pct*3.6}deg,#e8eef3 ${pct*3.6}deg)`;
 $('#updatedAt').innerHTML=summary.updatedAt?`<i></i> Troféus atualizados ${esc(dateTime(summary.updatedAt))}`:'<i></i> Aguardando primeira sincronização';
 const top=summary.topPlayers||[];
 $('#homeTopPlayers').innerHTML=top.length?`<div class="home-rank-list">${top.slice(0,5).map((m,i)=>{
   const b=roster.find(x=>x.name===m.representedBrawlerName);
   return `<article class="home-rank-row"><span class="home-rank-place">${['🥇','🥈','🥉'][i]||String(i+1).padStart(2,'0')}</span><span class="home-rank-avatar">${b?brawlerImageMarkup(b):esc(initials(m.displayName))}</span><span class="home-rank-meta"><b>${esc(m.displayName)}</b><small>${esc(m.representedBrawlerName||'Sem Brawler informado')}</small></span><strong>${fmt(m.currentTrophies)} <small>🏆</small></strong></article>`;
 }).join('')}</div>`:'<div class="empty-box"><span>♛</span><b>O pódio está esperando por vocês.</b><p>Quando os primeiros membros forem cadastrados e sincronizados, o ranking aparece aqui.</p></div>';
 $('#homeNews').innerHTML=announcements.slice(0,2).map(newsMarkup).join('')||'<div class="empty-box small-empty"><span>▤</span><b>Nenhum comunicado publicado.</b><p>Os avisos da House aparecerão aqui.</p></div>';
 $('#homeEvents').innerHTML=events.slice(0,2).map(eventMarkup).join('')||'<div class="empty-box small-empty"><span>◷</span><b>A agenda está livre.</b><p>Os próximos desafios aparecerão aqui.</p></div>';
}
function renderDirectory(){
 const term=($('#directorySearch')?.value||'').trim().toLocaleLowerCase('pt-BR');
 const sort=$('#directorySort')?.value||'trophies';
 const list=members.filter(m=>`${m.displayName||''} ${m.gameNickname||''} ${m.representedBrawlerName||''} ${m.playerTag||''}`.toLocaleLowerCase('pt-BR').includes(term));
 list.sort((a,b)=>sort==='name'?String(a.displayName||'').localeCompare(String(b.displayName||''),'pt-BR'):sort==='joined'?String(b.joinedAt||'').localeCompare(String(a.joinedAt||'')):(b.currentTrophies??-1)-(a.currentTrophies??-1));
 $('#directoryCount').textContent=fmt(members.length);
 $('#directoryGrid').innerHTML=list.length?list.map(m=>{
   const b=roster.find(x=>x.name===m.representedBrawlerName);
   const [a1,a2]=brawlerColor(b?.id||m.displayName?.length||1);
   const evolution=m.currentTrophies!=null&&m.baselineTrophies!=null?m.currentTrophies-m.baselineTrophies:null;
   return `<article class="player-card"><div class="player-card-art" style="--card-a:${a1};--card-b:${a2}">${b?brawlerImageMarkup(b,'player-card-character'):`<span class="player-card-unknown">${esc(initials(m.displayName))}</span>`}<span class="player-card-flag">STAR PARK MEMBER</span></div><div class="player-card-body"><div class="player-card-name">${esc(m.displayName)}</div><div class="player-card-nickname">${esc(m.gameNickname||'Jogador da House')}</div><div class="player-card-brawler">${esc(m.representedBrawlerName||'Brawler não informado')}</div><div class="player-card-stats"><span><small>TROFÉUS</small><b>${fmt(m.currentTrophies)}</b></span><span><small>EVOLUÇÃO</small><b>${evolution==null?'—':`${evolution>0?'+':''}${fmt(evolution)}`}</b></span></div><div class="player-card-foot"><span>${m.playerTag?`#${esc(m.playerTag)}`:'Tag privada'}</span><span>DESDE ${esc(dateLabel(String(m.joinedAt||'').slice(0,10)))}</span></div></div></article>`;
 }).join(''):`<div class="empty-box" style="grid-column:1/-1"><span>♟</span><b>${term?'Nenhum jogador encontrado.':'Nenhum membro público por enquanto.'}</b><p>${term?'Tente outro nome ou Brawler.':'Os jogadores aparecem após a ativação administrativa e autorização do perfil.'}</p></div>`;
}
$('#directorySearch').addEventListener('input',renderDirectory);
$('#directorySort').addEventListener('change',renderDirectory);
function updateRecruitSettings(settings){
 const isOpen=settings?.recruitmentOpen!==false;
 const message=settings?.recruitmentClosedMessage||'As inscrições estão temporariamente fechadas.';
 const status=$('#recruitStatus');
 status.classList.toggle('is-closed',!isOpen);
 status.classList.toggle('is-open',isOpen);
 status.innerHTML=`<i></i><span><b>${isOpen?'RECRUTAMENTO ABERTO':'RECRUTAMENTO FECHADO'}</b><small>${esc(isOpen?'Envie sua candidatura para análise da administração.':message)}</small></span>`;
 const form=$('#applicationForm');
 [...form.elements].forEach(control=>{if(control.name!=='privacyAcknowledged')control.disabled=!isOpen;});
 $('#submitApplication').disabled=!isOpen;
 $('#applicationFeedback').textContent=isOpen?'':message;
}

function updateCatalogMeta(meta){
 $('#navBrawlerCount').textContent=meta.count??roster.length;$('#catalogCount').textContent=meta.count??roster.length;$('#brawlerTotal').textContent=meta.count??roster.length;
 const source=meta.source||'local-fallback';
 $('#catalogSource').textContent=source==='brawlapi-live'?'Catálogo atual do jogo • BrawlAPI':source==='brawlapi-catalog'?'Catálogo sincronizado • BrawlAPI':source==='cached-brawlapi-catalog'?'Último catálogo sincronizado • BrawlAPI':source==='unavailable'?'Catálogo indisponível':'Catálogo local de contingência';
 $('#catalogSynced').textContent=meta.lastSuccessfulSync?`Última atualização: ${dateTime(meta.lastSuccessfulSync)}${meta.apiConfigured?' • API de jogadores configurada':' • consulta de jogadores independente deste catálogo'}`:meta.lastSyncError?`Não foi possível atualizar agora. ${meta.lastSyncError}`:'A lista ao vivo será carregada quando houver conexão. A API de jogadores é configurada separadamente.';
 fillCatalogFilterOptions();
}
function fillCatalogFilterOptions(){
 const rarity=$('#brawlerRarityFilter'),klass=$('#brawlerClassFilter');if(!rarity||!klass)return;
 const oldR=rarity.value,oldC=klass.value;
 const rarities=[...new Set(roster.map(b=>b.rarity).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'pt-BR'));
 const classes=[...new Set(roster.map(b=>b.class).filter(Boolean))].sort((x,y)=>x.localeCompare(y,'pt-BR'));
 rarity.innerHTML='<option value="all">Todas as raridades</option>'+rarities.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
 klass.innerHTML='<option value="all">Todas as classes</option>'+classes.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
 if(rarities.includes(oldR))rarity.value=oldR;if(classes.includes(oldC))klass.value=oldC;
}
function brawlerColor(id){const colors=[['#7ed8ff','#246ac2'],['#ffcc5c','#e76a3b'],['#c29bff','#7041b6'],['#7be3b2','#249b7d'],['#ff91ad','#b83e75'],['#ffe47b','#e89a34'],['#a4e0eb','#3b7ab0']];return colors[(Number(id)||0)%colors.length];}
function brawlerStateLabel(state){return state==='RESERVED'?'RESERVADO':state==='UNAVAILABLE'?'REPRESENTADO':'DISPONÍVEL';}
function brawlerImageMarkup(b,extraClass=''){
 const hubPortrait=b.key?`https://cdn.brawlhub.gg/assets/brawler-portraits/${slugKey(b.key)}.webp`:null;
 const candidates=[b.modelImageUrl,b.imageUrl2,b.imageUrl,b.imageUrl3,hubPortrait].map(safeImageUrl).filter(Boolean);
 const unique=[...new Set(candidates)];
 if(!unique.length)return `<span class="brawler-character-fallback standalone">${esc(initials(b.name))}</span>`;
 return `<img class="brawler-character ${extraClass}" src="${esc(unique[0])}"${unique.length>1?` data-fallbacks="${esc(JSON.stringify(unique.slice(1)))}"`:''} alt="${esc(b.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="brawler-character-fallback" aria-hidden="true">${esc(initials(b.name))}</span>`;
}
function brawlerCard(b){
 const [c1,c2]=brawlerColor(b.id||b.releaseNumber||b.name.length),state=b.status||'AVAILABLE',rarityColor=/^#[0-9a-fA-F]{6}$/.test(b.rarityColor||'')?b.rarityColor:'#f6bd4e';
 return `<article class="brawler-card-v2" style="--card-a:${c1};--card-b:${c2};--rarity-color:${rarityColor}"><button class="brawler-card-hit" type="button" data-brawler-detail="${esc(b.key)}" aria-label="Ver detalhes de ${esc(b.name)}"><span class="brawler-card-top"><span class="brawler-rarity-chip">${esc(b.rarity||'BRAWLER')}</span><span class="brawler-card-number">${b.id?`#${b.id}`:'★'}</span></span><span class="brawler-card-art">${brawlerImageMarkup(b)}<i class="brawler-art-glow"></i></span><span class="brawler-card-bottom"><span class="brawler-card-name">${esc(b.name)}</span><span class="brawler-card-class">${esc(b.class||'Classe não informada')}</span><span class="brawler-card-state state-${state.toLowerCase()}"><i></i>${brawlerStateLabel(state)}</span></span><span class="brawler-open-label">VER PERSONAGEM ↗</span></button></article>`;
}
function renderBrawlers(){
 const term=($('#brawlerSearch')?.value||'').trim().toLocaleLowerCase('pt-BR'),stateFilter=$('#brawlerStateFilter')?.value||'all',rarity=$('#brawlerRarityFilter')?.value||'all',klass=$('#brawlerClassFilter')?.value||'all',sort=$('#brawlerSort')?.value||'id';
 let list=roster.filter(b=>`${b.name} ${b.id||''} ${b.class||''} ${b.rarity||''}`.toLocaleLowerCase('pt-BR').includes(term)&&(stateFilter==='all'||(b.status||'AVAILABLE')===stateFilter)&&(rarity==='all'||b.rarity===rarity)&&(klass==='all'||b.class===klass));
 list.sort((x,y)=>sort==='name'?x.name.localeCompare(y.name,'pt-BR'):(x.sortOrder??x.id??(16000000+(x.releaseNumber||999999)))-(y.sortOrder??y.id??(16000000+(y.releaseNumber||999999))));
 $('#brawlerGrid').innerHTML=list.length?list.map(brawlerCard).join(''):'<div class="empty-box" style="grid-column:1/-1"><span>⌕</span><b>Nenhum personagem encontrado.</b><p>Limpe algum filtro ou tente outro nome.</p></div>';
 $('#catalogShown').textContent=`${list.length} de ${roster.length} personagens`;
}
$('#brawlerSearch').addEventListener('input',renderBrawlers);$('#brawlerStateFilter').addEventListener('change',renderBrawlers);$('#brawlerSort').addEventListener('change',renderBrawlers);$('#brawlerRarityFilter').addEventListener('change',renderBrawlers);$('#brawlerClassFilter').addEventListener('change',renderBrawlers);
function renderHeroBrawlerCast(){
 const host=$('#heroBrawlerCast');if(!host||!roster.length)return;
 const preferred=['Shelly','Colt','Spike'];const chosen=preferred.map(n=>roster.find(b=>b.name.toLowerCase()===n.toLowerCase())).filter(Boolean);
 const list=(chosen.length>=3?chosen:roster.slice(0,3));
 host.innerHTML=list.slice(0,3).map((b,i)=>`<span class="hero-brawler hero-brawler-${i+1}">${brawlerImageMarkup(b)}</span>`).join('');
 if(list.length)host.closest('.hero-scene')?.classList.add('has-live-brawlers');
}
function openBrawlerDetail(key){
 const b=roster.find(x=>x.key===key);if(!b)return;
 const modal=$('#brawlerModal'),host=$('#brawlerDetailBody');const [c1,c2]=brawlerColor(b.id||b.releaseNumber||1),rarityColor=/^#[0-9a-fA-F]{6}$/.test(b.rarityColor||'')?b.rarityColor:'#f6bd4e';
 const powerUps=(arr,title)=>arr?.length?`<section class="brawler-detail-section"><h3>${title}</h3><div class="brawler-ability-grid">${arr.map(x=>`<article class="brawler-ability">${x.imageUrl?`<img src="${esc(safeImageUrl(x.imageUrl)||'')}" alt="" loading="lazy">`:''}<span><b>${esc(x.name)}</b><small>${esc(x.description||'Descrição não informada.')}</small></span></article>`).join('')}</div></section>`:'';
 host.innerHTML=`<div class="brawler-detail-layout" style="--card-a:${c1};--card-b:${c2};--rarity-color:${rarityColor}"><div class="brawler-detail-art">${brawlerImageMarkup(b,'brawler-detail-character')}<span class="brawler-rarity-chip">${esc(b.rarity||'BRAWLER')}</span></div><div class="brawler-detail-copy"><span class="kicker">ENCICLOPÉDIA DA ARENA ${b.id?`• #${b.id}`:''}</span><h2 id="brawlerModalTitle">${esc(b.name)}</h2><div class="brawler-detail-badges"><span>${esc(b.class||'Classe não informada')}</span><span class="brawler-card-state state-${(b.status||'AVAILABLE').toLowerCase()}"><i></i>${brawlerStateLabel(b.status||'AVAILABLE')}</span></div><p>${esc(b.description||'Descrição deste personagem ainda não está disponível no catálogo.')}</p>${b.representative?`<div class="brawler-representative">Representante da House: <b>${esc(b.representative)}</b></div>`:''}</div></div>${powerUps(b.starPowers,'PODERES DE ESTRELA')}${powerUps(b.gadgets,'ACESSÓRIOS')}<p class="brawler-source-note">Dados do catálogo do jogo. A disponibilidade para representação é controlada pela administração STAR PARK.</p>`;
 modal.hidden=false;document.body.classList.add('modal-open');$('#brawlerModalClose').focus();
}
function closeBrawlerDetail(){const modal=$('#brawlerModal');if(modal){modal.hidden=true;document.body.classList.remove('modal-open');}}
$('#brawlerModalClose').addEventListener('click',closeBrawlerDetail);$('#brawlerModal').addEventListener('click',e=>{if(e.target===$('#brawlerModal'))closeBrawlerDetail();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeBrawlerDetail();});
document.addEventListener('click',e=>{const card=e.target.closest('[data-brawler-detail]');if(card)openBrawlerDetail(card.dataset.brawlerDetail);});
document.addEventListener('error',e=>{const img=e.target;if(!(img instanceof HTMLImageElement)||!img.classList.contains('brawler-character'))return;let candidates=[];try{candidates=JSON.parse(img.dataset.fallbacks||'[]');}catch{}if(candidates.length){img.src=candidates.shift();img.dataset.fallbacks=JSON.stringify(candidates);}else{img.classList.add('image-unavailable');img.removeAttribute('src');}},true);
function applyBrawlerCatalogFilters(){renderBrawlers();}
$('#publicCatalogRefresh').addEventListener('click',async()=>{const b=$('#publicCatalogRefresh');b.disabled=true;const old=b.textContent;b.textContent='ATUALIZANDO…';try{const server=await api('/api/brawlers').catch(()=>null);roster=[];await loadBrawlerCatalog(server);renderBrawlers();populateBrawlerSelects();renderHeroBrawlerCast();toast(`Catálogo carregado: ${roster.length} personagens.`);}catch(e){toast(e.message);}finally{b.disabled=false;b.textContent=old;}});
function populateBrawlerSelects(){const opts=roster.slice().sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')).map(b=>`<option value="${esc(b.key)}" ${b.status!=='AVAILABLE'?'disabled':''}>${esc(b.name)}${b.status==='RESERVED'?' — reservado':b.status==='UNAVAILABLE'?' — representado':''}</option>`).join('');['#recruitBrawler','#adminBrawlerSelect'].forEach(sel=>{const el=$(sel);if(el){const old=el.value;el.innerHTML='<option value="">Selecione um Brawler</option>'+opts;if(old)el.value=old;}});}

function renderRankings(){const list=summary;let rows=[],title='',method='';if(currentRank==='trophies'){title='Ranking de troféus';method='Troféus atuais consultados na API oficial. Dados ausentes não são tratados como zero.';rows=(list.topPlayers||[]).slice();}else if(currentRank==='evolution'){title='Evolução desde a entrada';method='Fórmula: troféus atuais menos baseline capturado na ativação. Membros sem baseline válido não entram.';rows=members.filter(m=>m.currentTrophies!=null&&m.baselineTrophies!=null).map(m=>({...m,score:m.currentTrophies-m.baselineTrophies})).sort((a,b)=>b.score-a.score);}else{title='Brawlers mais utilizados';method='Ocorrências observadas nos battlelogs recentes consultados. Não representa o histórico completo.';rows=(list.usage||[]).map(x=>({...x,score:x.count}));}$('#rankTitle').textContent=title;$('#rankMethod').textContent=method;$('#rankKicker').textContent=currentRank==='usage'?'PARTIDAS OBSERVADAS':currentRank==='evolution'?'PROGRESSO INDIVIDUAL':'PONTUAÇÃO ATUAL';$('#rankCount').textContent=rows.length;if(!rows.length){$('#rankingContent').innerHTML='<div class="empty-box"><span>♛</span><b>Sem dados suficientes para este ranking.</b><p>Sincronize jogadores ativos para começar a calcular os resultados.</p></div>';return;}$('#rankingContent').innerHTML=`<table class="data-table"><thead><tr><th>POSIÇÃO</th><th>${currentRank==='usage'?'BRAWLER':'JOGADOR'}</th><th>${currentRank==='usage'?'TIPO':'REPRESENTAÇÃO'}</th><th>${currentRank==='usage'?'OCORRÊNCIAS':currentRank==='evolution'?'EVOLUÇÃO':'TROFÉUS'}</th></tr></thead><tbody>${rows.map((m,i)=>`<tr><td><span class="rank-position">${['🥇','🥈','🥉'][i]||String(i+1).padStart(2,'0')}</span></td><td><div class="player-cell"><span class="player-avatar">${esc(initials(m.displayName||m.name))}</span><span class="player-meta"><strong>${esc(m.displayName||m.name)}</strong><small>${esc(m.gameNickname||'')}</small></span></div></td><td>${esc(currentRank==='usage'?'Uso observado':m.representedBrawlerName||'—')}</td><td><b>${currentRank==='usage'?`${fmt(m.count)} partidas`:currentRank==='evolution'?`${m.score>=0?'+':''}${fmt(m.score)}`:fmt(m.currentTrophies)}</b></td></tr>`).join('')}</tbody></table>`;}
$$('.rank-tab').forEach(b=>b.addEventListener('click',()=>{$$('.rank-tab').forEach(x=>x.classList.toggle('active',x===b));currentRank=b.dataset.rank;renderRankings();}));
function renderBars(selector,rows,key){const el=$(selector);if(!el)return;if(!rows?.length){el.innerHTML='<div class="empty-box small-empty"><b>Sem dados agregados ainda.</b><p>Os gráficos aparecem quando houver perfis sincronizados.</p></div>';return;}const top=rows.slice(0,7),max=Math.max(...top.map(x=>x[key]||0),1);el.innerHTML=top.map(x=>`<div class="bar-row"><span>${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,(x[key]/max)*100)}%"></div></div><strong>${fmt(x[key])}</strong></div>`).join('');}
function renderStatistics(){const battle=summary.battleStats||{};const active=Number(summary.activeMembers)||0;const covered=Number(summary.profileStatsCoverage)||0;const winsCovered=Number(summary.officialVictoryProfiles)||0;$('#analyticsCoverageNote').textContent=`Perfis com dados oficiais: ${covered}/${active}. Contadores de vitórias completos: ${winsCovered}/${active}. Dados que ainda não chegaram da API são exibidos como indisponíveis, não como zero.`;$('#analyticsTotal').textContent=summary.totalTrophies==null?'—':fmt(summary.totalTrophies);$('#analyticsUsed').textContent=summary.mostUsedBrawler?.name||'—';$('#analyticsUsedDetail').textContent=summary.mostUsedBrawler?`${fmt(summary.mostUsedBrawler.count)} partidas observadas`:'Nenhuma partida capturada';$('#analyticsTrophyBrawler').textContent=summary.mostTrophyBrawler?.name||'—';$('#analyticsWins').textContent=fmt(summary.totalOfficialVictories);$('#analytics3v3').textContent=fmt(summary.total3v3Victories);$('#analyticsSoloDuo').textContent=`${fmt(summary.totalSoloVictories)} / ${fmt(summary.totalDuoVictories)}`;$('#analyticsAverage').textContent=fmt(summary.averageTrophies);$('#analyticsBrawlers').textContent=fmt(summary.totalBrawlersOwned);$('#analyticsBattles').textContent=fmt(battle.totalObserved??0);$('#analyticsHighest').textContent=fmt(summary.highestProfileTrophies);$('#analyticsXpLevel').textContent=fmt(summary.averageExperienceLevel);$('#analyticsObservedWins').textContent=fmt(battle.wins);$('#analyticsObservedLosses').textContent=fmt(battle.losses);$('#analyticsObservedDraws').textContent=fmt(battle.draws);$('#analyticsProfileCoverage').textContent=`${covered}/${active}`;renderBars('#trophyBrawlerChart',summary.trophyTotals||[],'trophies');renderBars('#usageChart',summary.usage||[],'count');renderBars('#modeChart',battle.modes||[],'count');}
function eventMarkup(e){return `<article class="event-card"><div class="event-date"><strong>${esc(String(e.date||'').slice(8,10)||'—')}</strong><small>${esc(dateLabel(e.date).split(' ')[1]||'')}</small></div><div class="event-main"><b>${esc(e.title)}</b><small>${esc(e.type||'Evento')} · ${esc(e.time||'Horário a definir')}</small><p>${esc(e.description||'Sem descrição adicional.')}</p><span class="event-status">${e.limit?`${e.registrations?.length||0}/${e.limit} participantes`:'Inscrições abertas'}</span></div></article>`;}
function renderEvents(){$('#publicEventList').innerHTML=events.length?events.map(eventMarkup).join(''):'<div class="empty-box"><span>◷</span><b>Nenhum evento publicado.</b><p>Quando a administração criar uma atividade, ela aparecerá aqui.</p></div>';}
function newsMarkup(a){return `<article class="news-card"><span class="news-icon">${a.category==='Notícia'?'✦':'▤'}</span><div class="news-main"><b>${esc(a.title)}</b><small>${esc(a.category||'Comunicado')} · ${dateTime(a.createdAt)} ${a.author?`· ${esc(a.author)}`:''}</small><p>${esc(a.content)}</p></div>${a.pinned?'<span class="news-pin">FIXADO</span>':''}</article>`;}
function renderAnnouncements(){$('#publicNewsList').innerHTML=announcements.length?announcements.map(newsMarkup).join(''):'<div class="empty-box"><span>▤</span><b>O mural está silencioso.</b><p>Os comunicados oficiais aparecerão aqui.</p></div>';}
function formatPhoneField(value){
 const raw=String(value||'').trim(),hasPlus=raw.startsWith('+');let digits=raw.replace(/\D/g,'');
 let country='';
 if(hasPlus){if(digits.startsWith('55')){country='55';digits=digits.slice(2);}else return `+${digits}`;}
 else if(digits.length>11&&digits.startsWith('55')){country='55';digits=digits.slice(2);}
 if(!digits)return country?'+55':'';
 const ddd=digits.slice(0,2),rest=digits.slice(2,11);
 let formatted=`(${ddd}`;
 if(digits.length>=2)formatted+=')';
 if(rest.length){const split=rest.length>8?5:4;formatted+=` ${rest.slice(0,split)}`;if(rest.length>split)formatted+=`-${rest.slice(split,split+4)}`;}
 return `${country?'+55 ':''}${formatted}`;
}
const phoneField=$('#applicationForm [name="phone"]');
phoneField?.addEventListener('input',()=>{const formatted=formatPhoneField(phoneField.value);phoneField.value=formatted;});
phoneField?.addEventListener('blur',()=>{phoneField.value=formatPhoneField(phoneField.value);});
$('#applicationForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;if(!form.reportValidity())return;const body=Object.fromEntries(new FormData(form));body.privacyAcknowledged=form.elements.privacyAcknowledged.checked;body.wantsMemberAccount=form.elements.wantsMemberAccount?.checked===true;const btn=$('#submitApplication');btn.disabled=true;setFeedback('#applicationFeedback','Enviando sua candidatura com segurança…');try{const r=await api('/api/applications',{method:'POST',body:JSON.stringify(body)});form.reset();setFeedback('#applicationFeedback',`Candidatura recebida! Protocolo ${r.applicationId.slice(0,8).toUpperCase()}. A equipe fará a análise.`);toast('Candidatura enviada.');await loadPublic();}catch(err){setFeedback('#applicationFeedback',err.message,true);}finally{btn.disabled=false;}});
function updateRecruitFormState(){api('/api/public/settings').then(updateRecruitSettings).catch(()=>{});}

/* STAR_PARK_MEMBER_BRAWLER_CARDS_V1 */
let memberBrawlersCache = [];

function memberBrawlerCardMarkup(b) {
  const catalog = roster.find(x => slugKey(x.name) === slugKey(b.name));
  const image = catalog ? brawlerImageMarkup(catalog, 'member-brawler-character') :
    '<span class="member-brawler-fallback">' + esc(initials(b.name)) + '</span>';
  const rank = b.rank == null ? '—' : String(b.rank);
  const trophies = b.trophies == null ? '—' : fmt(b.trophies);
  const power = b.power == null ? '—' : String(b.power);
  const highest = b.highestTrophies == null ? '—' : fmt(b.highestTrophies);
  const rarity = catalog?.rarity || 'BRAWLER';
  const [c1,c2] = brawlerColor(catalog?.id || b.name?.length || 1);
  const progression = Number.isFinite(Number(b.trophies)) && Number.isFinite(Number(b.highestTrophies)) &&
    Number(b.highestTrophies) > 0
    ? Math.max(0, Math.min(100, Math.round(Number(b.trophies) / Number(b.highestTrophies) * 100)))
    : null;
  const equipment = [
    Array.isArray(b.gadgets) ? b.gadgets.length : null,
    Array.isArray(b.starPowers) ? b.starPowers.length : null,
    Array.isArray(b.gears) ? b.gears.length : null
  ].filter(x => x !== null).reduce((sum,x) => sum + x, 0);
  return `<article class="member-brawler-card" style="--member-card-a:${c1};--member-card-b:${c2}">
    <div class="member-brawler-art">${image}<span class="member-brawler-rarity">${esc(rarity)}</span></div>
    <div class="member-brawler-info">
      <div class="member-brawler-title"><b>${esc(b.name || 'Brawler')}</b><span>RANK ${esc(rank)}</span></div>
      <div class="member-brawler-stats">
        <span><small>TROFÉUS</small><strong>${trophies}</strong></span>
        <span><small>PODER</small><strong>${esc(power)}</strong></span>
        <span><small>RECORDE</small><strong>${highest}</strong></span>
      </div>
      ${progression === null ? '' : `<div class="member-brawler-progress"><span style="width:${progression}%"></span></div><small class="member-brawler-progress-label">${progression}% do recorde pessoal</small>`}
      <div class="member-brawler-foot"><span>${equipment ? `✦ ${equipment} melhoria(s) informada(s)` : 'Coleção oficial'}</span><span>${catalog?.class ? esc(catalog.class) : 'Brawl Stars'}</span></div>
    </div>
  </article>`;
}

function memberBrawlerCardsMarkup(items) {
  memberBrawlersCache = Array.isArray(items) ? items.slice() : [];
  return `<section class="game-panel member-brawler-collection">
    <div class="panel-head"><div><span class="kicker">COLEÇÃO DO JOGADOR</span><h3>Meus Brawlers</h3></div><span class="count-bubble">${fmt(memberBrawlersCache.length)}</span></div>
    <div class="member-brawler-toolbar">
      <label class="search-control"><span>⌕</span><input id="memberBrawlerSearch" type="search" placeholder="Buscar Brawler..." aria-label="Buscar Brawler na coleção"></label>
      <select id="memberBrawlerSort" aria-label="Ordenar coleção">
        <option value="trophies">Mais troféus</option>
        <option value="rank">Maior rank</option>
        <option value="power">Maior poder</option>
        <option value="name">Nome A–Z</option>
      </select>
    </div>
    <div id="memberBrawlerGrid" class="member-brawler-grid">
      ${memberBrawlersCache.length ? memberBrawlersCache.slice().sort((a,b)=>(Number(b.trophies)||0)-(Number(a.trophies)||0)).map(memberBrawlerCardMarkup).join('') : '<div class="empty-box">Aguarde a primeira consulta oficial do perfil.</div>'}
    </div>
    <p class="footnote">Troféus, poder, rank e recordes são exibidos conforme os campos realmente retornados pelo perfil oficial. Campos ausentes permanecem como indisponíveis.</p>
  </section>`;
}

function renderMemberBrawlerCards() {
  const host = document.querySelector('#memberBrawlerGrid');
  if (!host) return;
  const term = (document.querySelector('#memberBrawlerSearch')?.value || '').trim().toLocaleLowerCase('pt-BR');
  const sort = document.querySelector('#memberBrawlerSort')?.value || 'trophies';
  const list = memberBrawlersCache.filter(b => String(b.name || '').toLocaleLowerCase('pt-BR').includes(term));
  list.sort((a,b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
    const field = sort === 'rank' ? 'rank' : sort === 'power' ? 'power' : 'trophies';
    return (Number(b[field]) || -1) - (Number(a[field]) || -1);
  });
  host.innerHTML = list.length
    ? list.map(memberBrawlerCardMarkup).join('')
    : '<div class="empty-box" style="grid-column:1/-1">Nenhum Brawler encontrado com esse filtro.</div>';
}

document.addEventListener('input', event => {
  if (event.target?.id === 'memberBrawlerSearch') renderMemberBrawlerCards();
});
document.addEventListener('change', event => {
  if (event.target?.id === 'memberBrawlerSort') renderMemberBrawlerCards();
});

async function loadMemberPortal(){
 if(!auth.user||auth.user.role!=='MEMBER')return;
 try{
  const r=await api('/api/member/me');const m=r.member;const stats=m.playerStats||{};const battle=m.battleStats||{};
  $('#memberWelcome').textContent=m.displayName;
  const evolution=m.currentTrophies!=null&&m.baselineTrophies!=null?m.currentTrophies-m.baselineTrophies:null;
  $('#memberDashboard').innerHTML=`
   <article class="member-card"><small>TROFÉUS ATUAIS</small><b>${fmt(m.currentTrophies)}</b><p>Última sincronização: ${dateTime(m.lastSyncedAt)}</p></article>
   <article class="member-card"><small>MARCO INICIAL</small><b>${m.baselineTrophies==null?'Pendente':fmt(m.baselineTrophies)}</b><p>${m.baselineCapturedAt?`Capturado em ${dateTime(m.baselineCapturedAt)}`:'Aguardando consulta oficial.'}</p></article>
   <article class="member-card"><small>EVOLUÇÃO</small><b>${evolution==null?'—':`${evolution>=0?'+':''}${fmt(evolution)}`}</b><p>Diferença desde sua entrada na House.</p></article>
   <article class="member-card"><small>RECORDE DE TROFÉUS</small><b>${fmt(stats.highestTrophies)}</b><p>Maior marca informada pela API oficial.</p></article>
   <article class="member-card"><small>VITÓRIAS 3X3</small><b>${fmt(stats.victories3v3)}</b><p>Contador oficial do perfil.</p></article>
   <article class="member-card"><small>VITÓRIAS SOLO / DUO</small><b>${fmt(stats.victoriesSolo!=null&&stats.victoriesDuo!=null?Number(stats.victoriesSolo)+Number(stats.victoriesDuo):null)}</b><p>Solo: ${fmt(stats.victoriesSolo)} · Duo: ${fmt(stats.victoriesDuo)}</p></article>
   <article class="member-card"><small>NÍVEL DE EXPERIÊNCIA</small><b>${fmt(stats.experienceLevel)}</b><p>${fmt(stats.experiencePoints)} pontos de experiência.</p></article>
   <article class="member-card"><small>BRAWLERS DESBLOQUEADOS</small><b>${fmt(stats.brawlerCount)}</b><p>Personagens no perfil oficial.</p></article>
   <article class="member-card"><small>MAIOR TROFÉU EM UM BRAWLER</small><b>${fmt(stats.maxBrawlerTrophies)}</b><p>${esc(stats.maxBrawlerName||'Sem dado de Brawler')}</p></article>
   <article class="member-card"><small>RECORDE ROBO RUMBLE</small><b>${fmt(stats.bestRoboRumbleTime)}</b><p>Melhor tempo registrado pelo perfil.</p></article>
   <article class="member-card"><small>RECORD BIG BRAWLER</small><b>${fmt(stats.bestTimeAsBigBrawler)}</b><p>Melhor registro informado pela API.</p></article>
   <article class="member-card"><small>DESAFIO DE CAMPEONATO</small><b>${stats.championshipQualified==null?'—':stats.championshipQualified?'Classificado':'Não classificado'}</b><p>Estado atual no perfil oficial.</p></article>
   <article class="member-card"><small>PARTIDAS OBSERVADAS</small><b>${fmt(battle.totalObserved||0)}</b><p>Histórico capturado pelo Star Park, sem duplicatas.</p></article>`;
  $('#memberProfileContent').innerHTML=`<div class="player-cell"><span class="player-avatar">${esc(['⭐','🏆','🎮','⚡','🌟','🚀'].includes(m.avatar)?m.avatar:initials(m.displayName))}</span><span class="player-meta"><strong>${esc(m.displayName)}</strong><small>${esc(m.gameNickname||'')}</small></span></div><p><b>Brawler representante:</b> ${esc(m.representedBrawlerName||'—')}</p><p><b>Tag:</b> ${m.playerTag?`#${esc(m.playerTag)}`:'Oculta conforme configuração'}</p><p><b>Clube:</b> ${esc(stats.club?.name||'Sem clube informado')}${stats.club?.tag?` · #${esc(stats.club.tag)}`:''}</p><p><b>Maior troféu individual:</b> ${fmt(stats.maxBrawlerTrophies)} · ${esc(stats.maxBrawlerName||'—')}</p><p><b>Desafio de campeonato:</b> ${stats.championshipQualified==null?'Não informado':stats.championshipQualified?'Classificado':'Não classificado'}</p><p><b>Na House desde:</b> ${dateTime(m.joinedAt)}</p><p><b>Status da sincronização:</b> ${esc(m.apiSyncStatus||'PENDING')}${m.apiSyncError?` · ${esc(m.apiSyncError)}`:''}</p>`;
  const pf=$('#memberProfileForm');pf.elements.displayName.value=m.displayName||'';pf.elements.gameNickname.value=m.gameNickname||'';if(pf.elements.profileTitle)pf.elements.profileTitle.value=m.profileTitle||'';if(pf.elements.bio)pf.elements.bio.value=m.bio||'';if(pf.elements.avatar&&m.avatar&&['⭐','🏆','🎮','⚡','🌟','🚀'].includes(m.avatar))pf.elements.avatar.value=m.avatar;if(pf.elements.profileTheme)pf.elements.profileTheme.value=m.profileTheme||'blue';$('#memberProfileContent').classList.remove('sp-theme-blue','sp-theme-purple','sp-theme-gold','sp-theme-green');$('#memberProfileContent').classList.add(`sp-theme-${m.profileTheme||'blue'}`);pf.elements.public.checked=m.publicProfileSettings?.public!==false;pf.elements.showNickname.checked=m.publicProfileSettings?.showNickname!==false;pf.elements.showTag.checked=m.publicProfileSettings?.showTag===true;pf.elements.showEvolution.checked=m.publicProfileSettings?.showEvolution!==false;
  $('#memberTrophyContent').innerHTML=`
   <article class="metric-card metric-gold"><div class="metric-top"><span>TROFÉUS ATUAIS</span><b>🏆</b></div><strong>${fmt(m.currentTrophies)}</strong><small>API oficial</small></article>
   <article class="metric-card metric-purple"><div class="metric-top"><span>RECORDE</span><b>✦</b></div><strong>${fmt(stats.highestTrophies)}</strong><small>Maior quantidade de troféus</small></article>
   <article class="metric-card metric-blue"><div class="metric-top"><span>EVOLUÇÃO</span><b>⚡</b></div><strong>${evolution==null?'—':`${evolution>=0?'+':''}${fmt(evolution)}`}</strong><small>Desde sua entrada</small></article>
   <article class="metric-card"><div class="metric-top"><span>VITÓRIAS 3X3</span><b>⚔</b></div><strong>${fmt(stats.victories3v3)}</strong><small>API oficial</small></article>
   <article class="metric-card"><div class="metric-top"><span>VITÓRIAS SOLO</span><b>◈</b></div><strong>${fmt(stats.victoriesSolo)}</strong><small>API oficial</small></article>
   <article class="metric-card"><div class="metric-top"><span>VITÓRIAS DUO</span><b>◈</b></div><strong>${fmt(stats.victoriesDuo)}</strong><small>API oficial</small></article>
   <article class="metric-card"><div class="metric-top"><span>NÍVEL</span><b>★</b></div><strong>${fmt(stats.experienceLevel)}</strong><small>${fmt(stats.experiencePoints)} XP</small></article>
   <article class="metric-card"><div class="metric-top"><span>BRAWLERS</span><b>♟</b></div><strong>${fmt(stats.brawlerCount)}</strong><small>Desbloqueados</small></article>
   <article class="metric-card"><div class="metric-top"><span>PARTIDAS OBSERVADAS</span><b>🎮</b></div><strong>${fmt(battle.totalObserved||0)}</strong><small>Desde a coleta do Star Park</small></article>
   ${memberBrawlerCardsMarkup(m.brawlers||[])}
   <div class="game-panel" style="grid-column:1/-1"><div class="panel-head"><div><span class="kicker">BATALHAS CAPTURADAS</span><h3>Últimas partidas observadas</h3></div><span class="count-bubble">${fmt((m.recentBattleHistory||[]).length)}</span></div><div class="admin-list compact-list">${(m.recentBattleHistory||[]).map(b=>`<article class="admin-row"><div class="admin-row-main"><b>${esc(b.brawlerName)} · ${esc(b.mode||'Modo não informado')}</b><small>${esc(b.map||'Mapa não informado')} · ${esc(b.result||'Resultado indisponível')} · ${dateTime(b.battleTime||b.observedAt)}</small></div><span class="status-tag">${b.trophyChange==null?'':`${b.trophyChange>0?'+':''}${b.trophyChange} troféus`}</span></article>`).join('')||'<div class="empty-box">A API ainda não forneceu partidas para registrar.</div>'}</div><p class="footnote">A API oficial disponibiliza um Battle Log recente, não um histórico vitalício. O Star Park guarda apenas partidas que conseguiu observar após a ativação da coleta.</p></div>`;
  const eventsHtml=(r.events||[]).map(e=>`${eventMarkup(e)}${e.isRegistered?`<button class="mini-action danger" data-cancel-event="${esc(e.id)}">CANCELAR INSCRICAO</button>`:`<button class="mini-action primary" data-register-event="${esc(e.id)}">INSCREVER-SE</button>`}`).join('');
  $('#memberEventContent').innerHTML=eventsHtml||'<div class="empty-box">Nenhum evento publicado.</div>';
  $('#memberNewsContent').innerHTML=(r.announcements||[]).map(newsMarkup).join('')||'<div class="empty-box">Nenhum comunicado interno.</div>';
 }catch(e){toast(e.message);setPage('member-gate');}
}
$('#memberProfileForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const body={displayName:f.elements.displayName.value,gameNickname:f.elements.gameNickname.value,profileTitle:f.elements.profileTitle?.value||'',bio:f.elements.bio?.value||'',avatar:f.elements.avatar?.value||'',profileTheme:f.elements.profileTheme?.value||'blue',public:f.elements.public.checked,showNickname:f.elements.showNickname.checked,showTag:f.elements.showTag.checked,showEvolution:f.elements.showEvolution.checked};try{await api('/api/member/profile',{method:'POST',body:JSON.stringify(body)});setFeedback('#memberProfileFeedback','Perfil atualizado.');await loadMemberPortal();await loadPublic();}catch(err){setFeedback('#memberProfileFeedback',err.message,true);}});
$('#privacyRequestForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/member/privacy-request',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});e.currentTarget.reset();setFeedback('#privacyMemberFeedback','Solicitação registrada para análise.');}catch(err){setFeedback('#privacyMemberFeedback',err.message,true);}});
document.addEventListener('click',async e=>{const reg=e.target.closest('[data-register-event]');const cancel=e.target.closest('[data-cancel-event]');if(reg||cancel){try{await api(cancel?'/api/member/event-registration/cancel':'/api/member/event-registration',{method:'POST',body:JSON.stringify({eventId:cancel?cancel.dataset.cancelEvent:reg.dataset.registerEvent})});toast(cancel?'Inscricao cancelada.':'Inscricao registrada.');await loadMemberPortal();}catch(err){toast(err.message);}}});
async function loadAdminData(){if(!auth.user||auth.user.role==='MEMBER')return;const paths=['overview','applications','members','events','announcements','audit','users','account-requests','privacy','settings'];const results=await Promise.allSettled(paths.map(p=>api(`/api/admin/${p}`)));const val=i=>results[i].status==='fulfilled'?results[i].value:{};if(results[0].status==='rejected'){toast(results[0].reason.message);return;}admin={overview:val(0),applications:val(1).items||[],members:val(2).items||[],events:val(3).items||[],announcements:val(4).items||[],audit:val(5).items||[],users:val(6).items||[],accountRequests:val(7).items||[],privacy:val(8).items||[],settings:val(9).settings||{}};renderAdmin();applyRoleVisibility();}
function applyRoleVisibility(){const role=auth.user?.role;const owner=role==='OWNER';const moderator=role==='MODERATOR';$('#adminNav').querySelectorAll('.nav-item').forEach(item=>{const page=item.dataset.page;const ownerOnly=['admin-team'];const adminOnly=['admin-settings','admin-privacy','admin-api','admin-member-accounts'];item.style.display=(ownerOnly.includes(page)&&!owner)||(adminOnly.includes(page)&&moderator)?'none':'';});$('#staffForm').style.display=owner?'':'none';$('#staffList').style.display=owner?'':'none';if(role!=='OWNER'){$('#staffRole').innerHTML='<option value="MEMBER">MEMBER</option>';$('#staffMemberLink').style.display='';}else $('#staffMemberLink').style.display=$('#staffRole').value==='MEMBER'?'':'none';}

function renderAdmin(){const o=admin.overview||{};$('#pendingCount').textContent=o.pendingApplications||0;$('#applicationTotal').textContent=admin.applications.length;$('#adminMemberCount').textContent=admin.members.filter(m=>m.status==='ACTIVE').length;$('#rosterCount').textContent=admin.members.length;$('#adminOverview').innerHTML=`<div class="admin-kpi"><small>CANDIDATURAS EM ABERTO</small><b>${fmt(o.pendingApplications||0)}</b></div><div class="admin-kpi"><small>MEMBROS ATIVOS</small><b>${fmt(o.activeMembers||0)}</b></div><div class="admin-kpi"><small>BRAWLERS RESERVADOS</small><b>${fmt(o.reservedBrawlers||0)}</b></div><div class="admin-kpi"><small>BASELINES PENDENTES</small><b>${fmt(o.baselinePending||0)}</b></div><div class="admin-alert">⚠ ${o.apiFailures?`${o.apiFailures} membro(s) com falha/pendência de sincronização.`:'Sem falhas de sincronização registradas.'} ${o.upcomingEvents||0} evento(s) próximo(s).</div><div class="admin-alert">🔐 Acesso atual: ${esc(roleName(auth.user.role))}. Ações são verificadas no servidor.</div>`;renderApplications();renderAdminMembers();renderAdminBrawlers();renderAdminEvents();renderAdminAnnouncements();renderStaff();renderAccountRequests();renderAudit();renderPrivacy();renderApiStatus();renderSettings();populateMessageRecipients();}
function statusLabel(s){return ({PENDING:'Pendente',IN_REVIEW:'Em análise',NEEDS_INFORMATION:'Aguardando informação',APPROVED:'Aprovada',AWAITING_WHATSAPP:'Aguardando WhatsApp',ACTIVE:'Ativa',REJECTED:'Rejeitada',CANCELLED:'Cancelada'}[s]||s);}
function renderApplications(){const term=($('#applicationSearch')?.value||'').toLowerCase();const filter=$('#applicationStatusFilter')?.value||'all';const list=admin.applications.filter(a=>(filter==='all'||a.status===filter)&&`${a.displayName} ${a.gameNickname} ${a.playerTag}`.toLowerCase().includes(term));$('#applicationList').innerHTML=list.length?list.map(a=>{let actions='';if(a.status==='PENDING')actions='<button class="mini-action primary" data-app-status="IN_REVIEW">INICIAR ANÁLISE</button>';if(a.status==='IN_REVIEW')actions='<button class="mini-action" data-app-status="NEEDS_INFORMATION">PEDIR INFO</button><button class="mini-action primary" data-app-status="APPROVED">APROVAR</button><button class="mini-action danger" data-app-status="REJECTED">REJEITAR</button>';if(a.status==='NEEDS_INFORMATION')actions='<button class="mini-action primary" data-app-status="IN_REVIEW">RETOMAR ANÁLISE</button><button class="mini-action danger" data-app-status="REJECTED">REJEITAR</button>';if(a.status==='APPROVED')actions='<button class="mini-action primary" data-app-status="AWAITING_WHATSAPP">AGUARDAR WHATSAPP</button>';if(a.status==='AWAITING_WHATSAPP')actions='<button class="mini-action primary" data-confirm-whatsapp>CONFIRMAR ENTRADA E ATIVAR</button>';return `<article class="admin-row application-row" data-id="${esc(a.id)}"><span class="player-avatar">${esc(initials(a.displayName))}</span><div class="admin-row-main"><b>${esc(a.displayName)} · ${esc(a.gameNickname)}</b><small>#${esc(a.playerTag)} · ${esc(a.desiredBrawlerName)} · ${esc(a.ageRange)} · ${dateTime(a.submittedAt)}</small><small>API: ${esc(a.apiLookupStatus)} · Troféus na candidatura: ${fmt(a.trophiesAtApplication)}${a.phone?` · Contato: ${esc(a.phone)}`:''}</small><span class="status-tag ${a.status==='ACTIVE'?'good':a.status==='REJECTED'?'warn':''}">${statusLabel(a.status)}</span></div><div class="admin-row-actions">${actions}</div></article>`;}).join(''):'<div class="empty-box"><span>▣</span><b>Nenhuma candidatura nesta lista.</b><p>Novas inscrições públicas serão exibidas aqui.</p></div>';}
$('#applicationSearch').addEventListener('input',renderApplications);$('#applicationStatusFilter').addEventListener('change',renderApplications);
$('#applicationList').addEventListener('click',async e=>{const row=e.target.closest('.application-row');if(!row)return;const btn=e.target.closest('button');if(!btn)return;try{if(btn.hasAttribute('data-confirm-whatsapp')){if(!confirm('Confirma que este candidato entrou manualmente no grupo de WhatsApp? A ativação captura o baseline agora.'))return;await api(`/api/admin/applications/${row.dataset.id}/confirm-whatsapp`,{method:'POST',body:'{}'});}else{const reason=btn.dataset.appStatus==='REJECTED'?prompt('Informe o motivo da rejeição (interno):')||'Decisão administrativa':'Ação administrativa';await api(`/api/admin/applications/${row.dataset.id}/transition`,{method:'POST',body:JSON.stringify({status:btn.dataset.appStatus,reason})});}toast('Candidatura atualizada.');await loadAdminData();await loadPublic();}catch(err){toast(err.message);}});
$('#adminMemberForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const body=Object.fromEntries(new FormData(form));body.whatsappConfirmed=form.elements.whatsappConfirmed.checked;try{const r=await api('/api/admin/members',{method:'POST',body:JSON.stringify(body)});form.reset();setFeedback('#memberCreateFeedback',`Membro cadastrado. Baseline: ${r.member.baselineStatus==='CAPTURED'?'capturado':'pendente de captura'}.`);toast('Membro adicionado à House.');await loadAdminData();await loadPublic();}catch(err){setFeedback('#memberCreateFeedback',err.message,true);}});
function renderAdminMembers(){const list=admin.members;$('#adminMemberList').innerHTML=list.length?list.map(m=>`<article class="admin-row"><span class="player-avatar">${esc(['⭐','🏆','🎮','⚡','🌟','🚀'].includes(m.avatar)?m.avatar:initials(m.displayName))}</span><div class="admin-row-main"><b>${esc(m.displayName)} · ${esc(m.gameNickname)}</b><small>#${esc(m.playerTag)} · ${esc(m.representedBrawlerName)} · ${fmt(m.currentTrophies)} troféus</small><small>Baseline: ${fmt(m.baselineTrophies)} · ${esc(m.baselineStatus)} · ${dateTime(m.currentTrophiesCapturedAt)}</small><span class="status-tag ${m.status==='ACTIVE'?'good':'warn'}">${esc(m.status)}</span></div><div class="admin-row-actions">${m.status==='ACTIVE'?`<button class="mini-action primary" data-sync-member="${esc(m.id)}">SINCRONIZAR</button><button class="mini-action" data-member-status="SUSPENDED" data-id="${esc(m.id)}">SUSPENDER</button><button class="mini-action danger" data-member-status="LEFT" data-id="${esc(m.id)}">ENCERRAR</button>`:m.status==='SUSPENDED'?`<button class="mini-action primary" data-member-status="ACTIVE" data-id="${esc(m.id)}">REATIVAR</button><button class="mini-action danger" data-member-status="LEFT" data-id="${esc(m.id)}">ENCERRAR</button>`:''}${auth.user?.role==='OWNER'?`<button class="mini-action" data-correct-baseline="${esc(m.id)}">CORRIGIR BASELINE</button>`:''}</div></article>`).join(''):'<div class="empty-box"><b>Nenhum membro cadastrado.</b><p>Use o formulário para cadastrar pelo player tag.</p></div>'; }
$('#adminMemberList').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{if(b.hasAttribute('data-sync-member')){await api(`/api/admin/members/${b.dataset.syncMember}/sync`,{method:'POST',body:'{}'});toast('Dados do jogador sincronizados.');}else if(b.hasAttribute('data-member-status')){const reason=prompt('Justificativa para esta alteração:')||'';if(reason.length<5)return toast('Informe uma justificativa com pelo menos 5 caracteres.');await api(`/api/admin/members/${b.dataset.id}/status`,{method:'POST',body:JSON.stringify({status:b.dataset.memberStatus,reason})});toast('Status do membro atualizado.');}else if(b.hasAttribute('data-correct-baseline')){const value=prompt('Novo valor de baseline (troféus):');if(value===null)return;const reason=prompt('Justificativa obrigatória (mínimo 10 caracteres):')||'';await api(`/api/admin/members/${b.dataset.correctBaseline}/baseline-correction`,{method:'POST',body:JSON.stringify({value:Number(value),reason})});toast('Correção registrada na auditoria.');}await loadAdminData();await loadPublic();}catch(err){toast(err.message);}});
function renderAdminBrawlers(){const counts={AVAILABLE:roster.filter(b=>b.status==='AVAILABLE').length,RESERVED:roster.filter(b=>b.status==='RESERVED').length,UNAVAILABLE:roster.filter(b=>b.status==='UNAVAILABLE').length};$('#adminBrawlerSummary').innerHTML=`<article class="metric-card metric-blue"><div class="metric-top"><span>DISPONÍVEIS</span><b>✦</b></div><strong>${counts.AVAILABLE}</strong><small>Prontos para reserva</small></article><article class="metric-card metric-gold"><div class="metric-top"><span>RESERVADOS</span><b>⌛</b></div><strong>${counts.RESERVED}</strong><small>Candidaturas ativas</small></article><article class="metric-card metric-purple"><div class="metric-top"><span>REPRESENTADOS</span><b>♟</b></div><strong>${counts.UNAVAILABLE}</strong><small>Membros ativos</small></article>`;$('#adminBrawlerList').innerHTML=roster.map(b=>`<article class="admin-row"><span class="player-avatar">${esc(initials(b.name))}</span><div class="admin-row-main"><b>${esc(b.name)}</b><small>${b.releaseNumber?`Brawler nº ${b.releaseNumber}`:`API ID ${b.id}`} · ${esc(b.rarity||'Raridade não informada')}</small></div><span class="status-tag ${b.status==='AVAILABLE'?'good':b.status==='RESERVED'?'warn':''}">${b.status==='AVAILABLE'?'Disponível':b.status==='RESERVED'?'Reservado':'Representado'}</span></article>`).join('');}
$('#adminEventForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const body=Object.fromEntries(new FormData(f));const eventId=body.eventId;try{await api(eventId?`/api/admin/events/${eventId}`:'/api/admin/events',{method:eventId?'PUT':'POST',body:JSON.stringify(body)});f.reset();f.querySelector('.kicker').textContent='NOVO EVENTO';f.querySelector('h3').textContent='Criar atividade';f.querySelector('button[type=submit]').textContent='PUBLICAR EVENTO';setFeedback('#eventAdminFeedback',eventId?'Evento atualizado.':'Evento criado.');await loadAdminData();await loadPublic();}catch(err){setFeedback('#eventAdminFeedback',err.message,true);}});
function renderAdminEvents(){$('#adminEventList').innerHTML=admin.events.length?admin.events.map(e=>`<article class="admin-row"><div class="admin-row-main"><b>${esc(e.title)}</b><small>${dateLabel(e.date)} · ${esc(e.type)} · ${esc(e.status)} · ${e.registrations?.length||0} inscritos</small></div><div class="admin-row-actions"><button class="mini-action" data-edit-event="${esc(e.id)}">EDITAR</button><button class="mini-action danger" data-delete-event="${esc(e.id)}">REMOVER</button></div></article>`).join(''):'<div class="empty-box"><b>Nenhum evento criado.</b></div>'; }
$('#adminEventList').addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-event]');if(edit){const item=admin.events.find(x=>x.id===edit.dataset.editEvent);if(!item)return;const f=$('#adminEventForm');f.elements.eventId.value=item.id;f.elements.title.value=item.title;f.elements.type.value=item.type;f.elements.date.value=item.date;f.elements.time.value=item.time||'';f.elements.limit.value=item.limit||'';f.elements.status.value=item.status;f.elements.description.value=item.description||'';f.querySelector('.kicker').textContent='EDITAR EVENTO';f.querySelector('h3').textContent='Atualizar atividade';f.querySelector('button[type=submit]').textContent='SALVAR ALTERAÇÕES';f.scrollIntoView({behavior:'smooth',block:'center'});return;}const b=e.target.closest('[data-delete-event]');if(!b||!confirm('Remover este evento?'))return;try{await api(`/api/admin/events/${b.dataset.deleteEvent}`,{method:'DELETE'});await loadAdminData();await loadPublic();}catch(err){toast(err.message);}});
$('#adminAnnouncementForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const body=Object.fromEntries(new FormData(f));const announcementId=body.announcementId;body.pinned=f.elements.pinned.checked;try{await api(announcementId?`/api/admin/announcements/${announcementId}`:'/api/admin/announcements',{method:announcementId?'PUT':'POST',body:JSON.stringify(body)});f.reset();f.querySelector('.kicker').textContent='NOVO COMUNICADO';f.querySelector('h3').textContent='Publicar notícia';f.querySelector('button[type=submit]').textContent='PUBLICAR COMUNICADO';setFeedback('#announcementAdminFeedback',announcementId?'Comunicado atualizado.':'Comunicado publicado.');await loadAdminData();await loadPublic();}catch(err){setFeedback('#announcementAdminFeedback',err.message,true);}});
function renderAdminAnnouncements(){$('#adminAnnouncementList').innerHTML=admin.announcements.length?admin.announcements.map(a=>`<article class="admin-row"><div class="admin-row-main"><b>${esc(a.title)}</b><small>${esc(a.visibility)} · ${esc(a.category)} · ${dateTime(a.createdAt)} · ${esc(a.status)}</small></div><div class="admin-row-actions">${a.status==='PUBLISHED'?`<button class="mini-action" data-edit-announcement="${esc(a.id)}">EDITAR</button><button class="mini-action" data-archive-announcement="${esc(a.id)}">ARQUIVAR</button>`:''}<button class="mini-action danger" data-delete-announcement="${esc(a.id)}">REMOVER</button></div></article>`).join(''):'<div class="empty-box"><b>Nenhum comunicado criado.</b></div>'; }
$('#adminAnnouncementList').addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-announcement]');if(edit){const item=admin.announcements.find(x=>x.id===edit.dataset.editAnnouncement);if(!item)return;const f=$('#adminAnnouncementForm');f.elements.announcementId.value=item.id;f.elements.title.value=item.title;f.elements.visibility.value=item.visibility;f.elements.category.value=item.category;f.elements.content.value=item.content;f.elements.pinned.checked=item.pinned===true;f.querySelector('.kicker').textContent='EDITAR COMUNICADO';f.querySelector('h3').textContent='Atualizar notícia';f.querySelector('button[type=submit]').textContent='SALVAR ALTERAÇÕES';f.scrollIntoView({behavior:'smooth',block:'center'});return;}const archive=e.target.closest('[data-archive-announcement]');if(archive){if(!confirm('Arquivar este comunicado? Ele deixará de aparecer no mural público.'))return;try{await api(`/api/admin/announcements/${archive.dataset.archiveAnnouncement}/archive`,{method:'POST',body:'{}'});await loadAdminData();await loadPublic();}catch(err){toast(err.message);}return;}const b=e.target.closest('[data-delete-announcement]');if(!b||!confirm('Remover este comunicado permanentemente?'))return;try{await api(`/api/admin/announcements/${b.dataset.deleteAnnouncement}`,{method:'DELETE'});await loadAdminData();await loadPublic();}catch(err){toast(err.message);}});
function renderStaff(){const select=$('#staffMemberSelect');if(select){const old=select.value;select.innerHTML='<option value="">Selecione um membro ativo</option>'+admin.members.filter(m=>m.status==='ACTIVE').map(m=>`<option value="${esc(m.id)}">${esc(m.displayName)} · ${esc(m.playerTag)}</option>`).join('');if(old)select.value=old;}$('#staffList').innerHTML=admin.users.length?admin.users.map(u=>`<article class="admin-row"><span class="player-avatar">${esc(initials(u.name))}</span><div class="admin-row-main"><b>${esc(u.name)}</b><small>${esc(u.email)} · ${esc(roleName(u.role))}</small></div><span class="status-tag">${esc(u.role)}</span></article>`).join(''):'<div class="empty-box"><b>Nenhuma conta adicional.</b></div>';}

function renderAccountRequests(){
 const list=admin.accountRequests||[];const pending=list.filter(r=>r.status==='PENDING');
 $('#pendingAccountCount').textContent=pending.length;$('#accountRequestTotal').textContent=list.length;$('#accountRequestPending').textContent=pending.length;
 $('#accountRequestList').innerHTML=list.length?list.map(r=>`<article class="admin-row"><span class="player-avatar">${esc(initials(r.displayName))}</span><div class="admin-row-main"><b>${esc(r.displayName)} · ${esc(r.email)}</b><small>Tag #${esc(r.playerTag)} · Pedido em ${dateTime(r.createdAt)}</small><span class="status-tag ${r.status==='APPROVED'?'good':r.status==='PENDING'?'warn':''}">${esc(r.status==='PENDING'?'AGUARDANDO':r.status==='APPROVED'?'APROVADA':'REJEITADA')}</span>${r.reviewReason?`<small>Motivo: ${esc(r.reviewReason)}</small>`:''}</div><div class="admin-row-actions">${r.status==='PENDING'?`<button class="mini-action primary" data-approve-account="${esc(r.id)}">APROVAR E LIBERAR</button><button class="mini-action danger" data-reject-account="${esc(r.id)}">REJEITAR</button>`:''}</div></article>`).join(''):'<div class="empty-box"><b>Nenhum pedido de primeiro acesso.</b><p>Quando um membro solicitar conta, o pedido aparecerá aqui para aprovação.</p></div>';
}
$('#accountRequestList').addEventListener('click',async e=>{
 const approve=e.target.closest('[data-approve-account]');const reject=e.target.closest('[data-reject-account]');if(!approve&&!reject)return;
 try{
  if(approve){if(!confirm('Aprovar este pedido e criar a conta de membro vinculada à tag ativa?'))return;await api(`/api/admin/account-requests/${approve.dataset.approveAccount}/approve`,{method:'POST',body:'{}'});toast('Conta aprovada e liberada.');}
  if(reject){const reason=prompt('Motivo da rejeição (opcional):')||'';await api(`/api/admin/account-requests/${reject.dataset.rejectAccount}/reject`,{method:'POST',body:JSON.stringify({reason})});toast('Pedido rejeitado.');}
  await loadAdminData();
 }catch(error){toast(error.message);}
});
$('#staffRole').addEventListener('change',()=>$('#staffMemberLink').style.display=$('#staffRole').value==='MEMBER'?'':'none');$('#staffForm').addEventListener('submit',async e=>{e.preventDefault();try{const body=Object.fromEntries(new FormData(e.currentTarget));await api('/api/admin/users',{method:'POST',body:JSON.stringify(body)});e.currentTarget.reset();setFeedback('#staffFeedback','Conta criada com sucesso.');await loadAdminData();}catch(err){setFeedback('#staffFeedback',err.message,true);}});
function renderAudit(){$('#auditList').innerHTML=admin.audit.length?admin.audit.map(a=>`<article class="admin-row"><span class="news-icon">◈</span><div class="admin-row-main"><b>${esc(a.action)}</b><small>${esc(a.actorName)} · ${esc(a.role)} · ${dateTime(a.at)}</small><small>${esc(a.detail)}</small></div></article>`).join(''):'<div class="empty-box"><b>Nenhuma ação registrada.</b></div>';}
function renderPrivacy(){$('#privacyAdminList').innerHTML=admin.privacy.length?admin.privacy.map(p=>`<article class="admin-row"><div class="admin-row-main"><b>${esc(p.type)} · ${esc(p.status)}</b><small>${dateTime(p.createdAt)} · ${esc(p.details)}</small></div><div class="admin-row-actions">${p.status==='OPEN'?`<button class="mini-action primary" data-resolve-privacy="${esc(p.id)}">MARCAR ANALISADA</button>`:''}</div></article>`).join(''):'<div class="empty-box"><b>Nenhuma solicitação aberta.</b></div>';}
$('#privacyAdminList').addEventListener('click',async e=>{const b=e.target.closest('[data-resolve-privacy]');if(!b)return;try{await api('/api/admin/privacy/resolve',{method:'POST',body:JSON.stringify({id:b.dataset.resolvePrivacy})});await loadAdminData();}catch(err){toast(err.message);}});
function renderApiStatus(){api('/api/health').then(h=>{const p=h.playerSync||{};$('#apiAdminStatus').innerHTML=[['API SUPERCELL (JOGADORES)',h.apiConfigured?'Configurada':'Não configurada'],['ATUALIZAÇÃO DOS JOGADORES',`${p.intervalSeconds||60} segundos`],['ESPAÇAMENTO ENTRE CHAMADAS',`${p.minRequestIntervalMs||300} ms`],['ÚLTIMO CICLO DE JOGADORES',dateTime(p.lastSyncAt)],['PERFIS ATIVOS',fmt(p.activeMembers||0)],['PERFIS ATUALIZADOS',fmt(p.updatedMembers||0)],['PERFIS PARCIAIS',fmt(p.partialMembers||0)],['PERFIS COM FALHA / DESATUALIZADOS',fmt(p.staleMembers||0)],['CATÁLOGO VISUAL',`${h.catalogCount??h.brawlerCount??roster.length} Brawlers`],['FONTE DO CATÁLOGO',h.catalogSource||'—'],['ÚLTIMA ATUALIZAÇÃO DO CATÁLOGO',dateTime(h.catalogLastSuccessfulSync)],['DURAÇÃO DO ÚLTIMO CICLO',p.durationMs==null?'—':`${(p.durationMs/1000).toFixed(1)} s`]].map(x=>`<div class="api-stat"><small>${esc(x[0])}</small><b>${esc(x[1])}</b></div>`).join('');const parts=[];if(!h.apiConfigured)parts.push('Configure BRAWL_STARS_API_TOKEN no Render.');if(p.lastError)parts.push(`Último ciclo: ${p.lastError}`);if(p.apiCooldownUntil)parts.push(`Pausa da API até ${dateTime(p.apiCooldownUntil)}.`);parts.push(`Perfis consultados em ciclo de ${p.intervalSeconds||60} segundos; o servidor distribui as chamadas e pausa ao receber limite 429.`);parts.push(`Catálogo visual independente da chave Supercell: atualização a cada ${h.catalogAutomaticSyncHours||6} horas.`);$('#apiAdminFeedback').textContent=parts.join(' ');}).catch(e=>$('#apiAdminStatus').textContent=e.message);}
function renderSettings(){const f=$('#settingsForm'),s=admin.settings;f.elements.recruitmentOpen.checked=s.recruitmentOpen!==false;f.elements.showNickname.checked=s.showNickname!==false;f.elements.showTag.checked=s.showTag===true;f.elements.showEvolution.checked=s.showEvolution!==false;f.elements.reservationHours.value=s.reservationHours||72;}
$('#settingsForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const body={recruitmentOpen:f.elements.recruitmentOpen.checked,showNickname:f.elements.showNickname.checked,showTag:f.elements.showTag.checked,showEvolution:f.elements.showEvolution.checked,reservationHours:Number(f.elements.reservationHours.value)};try{await api('/api/admin/settings',{method:'POST',body:JSON.stringify(body)});setFeedback('#settingsFeedback','Configurações salvas.');await loadPublic();await loadAdminData();}catch(err){setFeedback('#settingsFeedback',err.message,true);}});
function populateMessageRecipients(){const sel=$('#messageRecipient');const previous=sel.value;const candidates=admin.applications.map(a=>({id:a.id,name:`${a.displayName} · ${a.playerTag}`,phone:a.phone,kind:'application',data:a}));const players=admin.members.map(m=>({id:m.id,name:`${m.displayName} · ${m.playerTag}`,phone:null,kind:'member',data:m}));sel.innerHTML='<option value="">Selecione candidato ou membro</option>'+[...candidates,...players].map(x=>`<option value="${x.kind}:${esc(x.id)}">${esc(x.name)}</option>`).join('');if(previous)sel.value=previous;updateMessagePreview();}
const templates={welcome:'Olá, {nome}! Recebemos sua candidatura para a Star Park. Vamos analisar seus dados e em breve retornaremos. A arena é nossa! ⭐',approved:'Olá, {nome}! Sua candidatura foi aprovada. Seu Brawler representante será {brawler}. O próximo passo é combinar sua entrada no grupo da House.',rejected:'Olá, {nome}. Obrigado pelo interesse na Star Park. Neste momento não seguiremos com a candidatura. Agradecemos seu tempo e desejamos boas partidas!',info:'Olá, {nome}! Para continuar a análise da sua candidatura, precisamos confirmar algumas informações. Pode falar com a administração?',whatsapp:'Olá, {nome}! Sua candidatura foi aprovada. Vamos organizar sua entrada no grupo da Star Park pelo WhatsApp. Seu Brawler será {brawler}.',active:'Olá, {nome}! Sua entrada na Star Park foi confirmada. Bem-vindo(a) à House! A arena é nossa! 🏆',general:'Olá, {nome}! A equipe da Star Park gostaria de falar com você sobre a House.',admin:'Olá, {nome}. Este é um comunicado da administração da Star Park.'};
function selectedRecipient(){const [kind,id]=($('#messageRecipient').value||'').split(':');return kind==='application'?admin.applications.find(x=>x.id===id):kind==='member'?admin.members.find(x=>x.id===id):null;}
function updateMessagePreview(){const recipient=selectedRecipient();const template=$('#messageTemplate').value;let text=templates[template]||'';const values={nome:recipient?.displayName||'jogador',nickname:recipient?.gameNickname||'',tag:recipient?.playerTag||'',brawler:recipient?.desiredBrawlerName||recipient?.representedBrawlerName||'seu Brawler',trofeus:recipient?.currentTrophies==null?'':fmt(recipient.currentTrophies),trofeus_iniciais:recipient?.baselineTrophies==null?'':fmt(recipient.baselineTrophies),status:recipient?.status||''};text=text.replace(/\{(\w+)\}/g,(_,k)=>values[k]??'');$('#messageBody').value=text;$('#messagePreview').textContent=text||'Selecione um destinatário e um modelo para gerar a prévia.';}
$('#messageRecipient').addEventListener('change',updateMessagePreview);$('#messageTemplate').addEventListener('change',updateMessagePreview);$('#messageBody').addEventListener('input',()=>$('#messagePreview').textContent=$('#messageBody').value);
$('#copyMessage').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#messageBody').value);setFeedback('#messageFeedback','Mensagem copiada.');}catch{setFeedback('#messageFeedback','Não foi possível copiar automaticamente. Selecione e copie o texto.',true);}});
$('#openWhatsApp').addEventListener('click',()=>{const recipient=selectedRecipient();if(!recipient){setFeedback('#messageFeedback','Selecione um destinatário.',true);return;}const phone=recipient.phone;if(!phone){setFeedback('#messageFeedback','Telefone indisponível para sua permissão ou não cadastrado. Não é possível abrir o WhatsApp.',true);return;}const url=`https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent($('#messageBody').value)}`;const win=window.open(url,'_blank','noopener,noreferrer');if(win){const [kind,id]=($('#messageRecipient').value||'').split(':');api('/api/admin/messages/log',{method:'POST',body:JSON.stringify({recipientType:kind,recipientId:id,state:'CHAT_OPENED',template:$('#messageTemplate').value})}).catch(()=>{});setFeedback('#messageFeedback','Conversa aberta. O envio deve ser feito manualmente no WhatsApp; abrir o link não marca a mensagem como enviada.');}else setFeedback('#messageFeedback','O navegador bloqueou a nova janela. Permita pop-ups para abrir o WhatsApp.',true);});
$('#recordMessageSent').addEventListener('click',async()=>{const recipient=selectedRecipient();if(!recipient){setFeedback('#messageFeedback','Selecione um destinatário.',true);return;}if(!confirm('Você confirma que enviou esta mensagem manualmente pelo WhatsApp?'))return;const [kind,id]=($('#messageRecipient').value||'').split(':');try{await api('/api/admin/messages/log',{method:'POST',body:JSON.stringify({recipientType:kind,recipientId:id,state:'SENT_CONFIRMED_MANUALLY',template:$('#messageTemplate').value})});setFeedback('#messageFeedback','Envio manual registrado pela administração.');}catch(e){setFeedback('#messageFeedback',e.message,true);}});
$('#adminSyncPlayers').addEventListener('click',async()=>{const b=$('#adminSyncPlayers');b.disabled=true;try{const r=await api('/api/admin/sync-players',{method:'POST',body:'{}'});setFeedback('#apiAdminFeedback',r.message||'Sincronização iniciada. Acompanhe o painel.');toast('Sincronização de jogadores iniciada.');}catch(e){setFeedback('#apiAdminFeedback',e.message,true);}finally{b.disabled=false;renderApiStatus();}});
$('#adminSyncBrawlers').addEventListener('click',async()=>{const b=$('#adminSyncBrawlers');b.disabled=true;try{const r=await api('/api/admin/sync-brawlers',{method:'POST',body:'{}'});setFeedback('#apiAdminFeedback',`Catálogo atualizado: ${r.count} Brawlers.`);await loadPublic();await loadAdminData();}catch(e){setFeedback('#apiAdminFeedback',e.message,true);}finally{b.disabled=false;}});
$('#refreshAll').addEventListener('click',async()=>{await loadPublic();if(auth.user?.role==='MEMBER')await loadMemberPortal();else if(auth.user)await loadAdminData();toast('Dados atualizados.');});
let liveRefreshInProgress=false;
async function refreshLiveData(){
 if(liveRefreshInProgress||document.visibilityState!=='visible')return;
 liveRefreshInProgress=true;
 try{
  const [summaryResult,membersResult]=await Promise.allSettled([api('/api/public/summary'),api('/api/public/members')]);
  if(summaryResult.status==='fulfilled')summary=summaryResult.value;
  if(membersResult.status==='fulfilled')members=membersResult.value.items||[];
  if(summaryResult.status==='fulfilled'||membersResult.status==='fulfilled'){
   renderHome();renderDirectory();renderRankings();renderStatistics();updateHeader();
   if(auth.user?.role==='MEMBER'&&currentPage.startsWith('member-'))await loadMemberPortal();
   if(auth.user&&currentPage==='admin-api')renderApiStatus();
  }
 }catch(error){console.warn('[STAR PARK] Atualização visual automática falhou:',error.message);}
 finally{liveRefreshInProgress=false;}
}
setInterval(()=>refreshLiveData(),60_000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshLiveData();});
async function init(){await loadSession();await loadPublic();if(auth.user?.role==='MEMBER'){applyNavigation();setPage('member-home');await loadMemberPortal();}else if(auth.user){applyNavigation();setPage('admin-home');await loadAdminData();}else{applyNavigation();setPage('home');}updateRecruitFormState();}
init();

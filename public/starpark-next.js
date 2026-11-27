/* STAR PARK NEXT - melhorias incrementais, sem chat interno */
(() => {
  'use strict';
  const WA_URL = 'https://chat.whatsapp.com/L5n55x9ad4e3IFxSx5wE7Z';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt = value => value == null ? '—' : new Intl.NumberFormat('pt-BR').format(value);
  const date = value => value ? new Date(value).toLocaleString('pt-BR', {dateStyle:'short', timeStyle:'short'}) : 'Data indisponivel';
  let previewTimer = null;
  let previewController = null;
  let adminQueueBusy = false;

  function safeApi(path, options) {
    if (typeof api === 'function') return api(path, options || {});
    return fetch(path, {credentials:'same-origin', cache:'no-store', ...(options || {})}).then(async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Erro HTTP ${response.status}`);
      return payload;
    });
  }

  function setupTagPreview() {
    const form = $('#applicationForm');
    const field = form?.elements?.playerTag;
    if (!form || !field || $('#spTagPreview')) return;
    const panel = document.createElement('section');
    panel.id = 'spTagPreview';
    panel.className = 'sp-tag-preview';
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<b>Previa do perfil Brawl Stars</b><p>Digite sua tag para conferir a conta encontrada.</p>';
    field.closest('label')?.insertAdjacentElement('afterend', panel);
    const show = (title, message, kind = '') => {
      panel.className = `sp-tag-preview ${kind}`;
      panel.replaceChildren();
      const heading = document.createElement('b'); heading.textContent = title;
      const body = document.createElement('p'); body.textContent = message;
      panel.append(heading, body);
    };
    field.addEventListener('input', () => {
      clearTimeout(previewTimer);
      if (previewController) previewController.abort();
      const tag = String(field.value || '').replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
      if (!tag) { show('Previa do perfil Brawl Stars', 'Digite sua tag para conferir a conta encontrada.'); return; }
      if (!/^[0289PYLQGRJCUV]{3,15}$/.test(tag)) { show('Tag incompleta ou invalida', 'Confira os caracteres da tag antes de continuar.', 'error'); return; }
      show('Consultando a API oficial...', 'Buscando nome, tag, trofeus e clube.');
      previewTimer = setTimeout(async () => {
        previewController = new AbortController();
        try {
const result = await safeApi(`/api/player/${encodeURIComponent(tag)}`, {signal: previewController.signal});
const player = result.player || {};
if (!player.name) { show('Perfil nao encontrado', 'Confira a tag e tente novamente.', 'error'); return; }
panel.className = 'sp-tag-preview success';
panel.replaceChildren();
const title = document.createElement('b'); title.textContent = 'Confira se este e seu perfil';
const name = document.createElement('strong'); name.textContent = player.name;
const detail = document.createElement('p'); detail.textContent = `#${tag} · ${fmt(player.trophies)} trofeus · Clube: ${player.club?.name || 'Nao informado'}`;
const note = document.createElement('small'); note.textContent = 'Dados retornados pela API. Se nao corresponderem a sua conta, corrija a tag antes de enviar.';
panel.append(title, name, detail, note);
        } catch (error) {
if (error.name === 'AbortError') return;
if (/nao encontrado|não encontrado|HTTP 404/i.test(error.message || '')) { show('Perfil nao encontrado', 'Confira a tag e tente novamente.', 'error'); return; }
show('Nao foi possivel consultar agora', `${error.message || 'A API esta temporariamente indisponivel.'} Voce pode conferir a tag novamente antes do envio.`, 'error');
        }
      }, 650);
    });
  }

  function setupWhatsAppSuccess() {
    const form = $('#applicationForm');
    if (!form || form.dataset.spSuccessHandler) return;
    form.dataset.spSuccessHandler = '1';
    document.addEventListener('starpark:application-submitted', async event => {
      const result = event.detail || {};
      const layout = $('.recruit-layout');
      if (!layout || $('#spApplicationConfirmation')) return;
      const settings = await safeApi('/api/public/settings').catch(() => ({}));
      const rawUrl = result.whatsappCommunityUrl || settings.whatsappCommunityUrl || WA_URL;
      let safeUrl = WA_URL;
      try { const parsed = new URL(rawUrl); if (parsed.protocol === 'https:' && parsed.hostname === 'chat.whatsapp.com') safeUrl = parsed.href; } catch {}
      const box = document.createElement('section');
      box.id = 'spApplicationConfirmation';
      box.className = 'sp-application-confirmation';
      const protocol = String(result.applicationId || '').slice(0, 8).toUpperCase() || 'REGISTRADO';
      box.innerHTML = `<div class="sp-confirm-icon" aria-hidden="true">✓</div><span class="kicker">CANDIDATURA RECEBIDA</span><h2>Seu pedido chegou à Star Park!</h2><p class="sp-confirm-protocol">Protocolo <strong>${esc(protocol)}</strong></p><p>A equipe ainda fará a análise da sua candidatura. Entrar no WhatsApp não significa que a candidatura foi aprovada.</p><p>Entre na comunidade pelo botão abaixo enquanto aguarda a análise. Depois da aprovação, a equipe confirmará sua entrada e você poderá solicitar sua conta de membro pelo fluxo separado.</p>`;
      const link = document.createElement('a');
      link.className = 'sp-whatsapp-cta'; link.href = safeUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = 'ENTRAR NA COMUNIDADE DO WHATSAPP';
      const foot = document.createElement('small'); foot.textContent = 'Guarde seu protocolo para consultar a candidatura com a administração.';
      box.append(link, foot);
      layout.replaceChildren(box);
    });
  }

  function setupMemberQueue() {
    const host = $('#spAwaitingList');
    if (!host) return;
    const render = async () => {
      if (!auth?.user || !window.starParkHasRole?.('ADMIN') || adminQueueBusy) return;
      adminQueueBusy = true;
      try {
        const result = await safeApi('/api/admin/applications');
        const items = (result.items || []).filter(item => item.status === 'AWAITING_WHATSAPP');
        $('#spAwaitingCount').textContent = String(items.length);
        host.innerHTML = items.length ? items.map(item => `<article class="admin-row sp-awaiting-row" data-sp-application="${esc(item.id)}"><div class="admin-row-main"><b>${esc(item.displayName)} · ${esc(item.gameNickname)}</b><small>#${esc(item.playerTag)} · ${esc(item.desiredBrawlerName || 'Brawler nao informado')} · Enviada: ${esc(date(item.submittedAt))}</small><span class="status-tag warn">AGUARDANDO WHATSAPP</span></div><div class="admin-row-actions"><button class="mini-action primary" type="button" data-sp-confirm>CONFIRMAR ENTRADA</button><button class="mini-action danger" type="button" data-sp-reject>REJEITAR</button></div></article>`).join('') : '<div class="empty-box"><b>Nenhuma pessoa aguardando confirmacao.</b><p>Novas candidaturas aparecerao aqui depois do envio.</p></div>';
      } catch (error) {
        host.textContent = error.message || 'Nao foi possivel carregar a fila.';
      } finally { adminQueueBusy = false; }
    };
    host.addEventListener('click', async event => {
      const button = event.target.closest('button');
      const row = event.target.closest('[data-sp-application]');
      if (!button || !row) return;
      button.disabled = true;
      try {
        if (button.hasAttribute('data-sp-confirm')) {
if (!confirm('Voce verificou que a pessoa entrou na comunidade WhatsApp? A confirmacao criara o perfil de membro, sem criar uma conta de login.')) return;
await safeApi(`/api/admin/applications/${row.dataset.spApplication}/confirm-whatsapp`, {method:'POST', body:'{}'});
        } else if (button.hasAttribute('data-sp-reject')) {
const reason = prompt('Motivo interno da rejeicao (opcional):') || 'Decisao administrativa';
await safeApi(`/api/admin/applications/${row.dataset.spApplication}/transition`, {method:'POST', body:JSON.stringify({status:'REJECTED', reason})});
        }
        if (typeof loadAdminData === 'function') await loadAdminData();
        if (typeof loadPublic === 'function') await loadPublic();
        await render();
      } catch (error) { alert(error.message || 'Nao foi possivel concluir a acao.'); }
      finally { button.disabled = false; }
    });
    render();
    setTimeout(render, 2500);
    setInterval(() => { if (document.visibilityState === 'visible') render(); }, 60000);
  }

  function setupMemberExtras() {
    const page = $('#page-member-home');
    const dashboard = $('#memberDashboard');
    if (!page || !dashboard || $('#spMemberExtras')) return;
    const section = document.createElement('section');
    section.id = 'spMemberExtras';
    section.className = 'sp-member-extras';
    section.innerHTML = '<div class="sp-extra-grid"><article class="game-panel"><div class="panel-head"><div><span class="kicker">CENTRAL DE AVISOS</span><h3>Notificacoes</h3></div></div><div id="spMemberNotifications" class="admin-list compact-list">Carregando...</div></article><article class="game-panel"><div class="panel-head"><div><span class="kicker">PROGRESSO</span><h3>Conquistas e medalhas</h3></div></div><div id="spMemberAchievements" class="sp-achievement-list">Carregando...</div></article></div><article class="game-panel"><div class="panel-head"><div><span class="kicker">HISTORICO PESSOAL</span><h3>Linha do tempo</h3></div></div><div id="spMemberTimeline" class="sp-timeline">Carregando...</div></article>';
    dashboard.insertAdjacentElement('afterend', section);
    const refresh = async () => {
      if (!auth?.user || !window.starParkHasRole?.('MEMBER')) return;
      try {
        const result = await safeApi('/api/member/me');
        const notifications = result.notifications || [];
        $('#spMemberNotifications').innerHTML = notifications.length ? notifications.map(item => `<article class="admin-row"><div class="admin-row-main"><b>${esc(item.title)}</b><small>${esc(date(item.at))}</small></div><span class="status-tag">${esc(item.type)}</span></article>`).join('') : '<div class="empty-box">Nenhum aviso novo.</div>';
        const achievements = result.achievements || [];
        $('#spMemberAchievements').innerHTML = achievements.map(item => `<div class="sp-achievement ${item.earned ? 'earned' : ''}"><span>${item.earned ? '★' : '☆'}</span><div><b>${esc(item.title)}</b><small>${esc(item.description)}</small></div><strong>${item.earned ? 'CONQUISTADA' : 'EM PROGRESSO'}</strong></div>`).join('') || '<div class="empty-box">Suas conquistas aparecerao aqui.</div>';
        const timeline = result.timeline || [];
        $('#spMemberTimeline').innerHTML = timeline.length ? timeline.map(item => `<div class="sp-timeline-item"><i></i><div><b>${esc(item.title)}</b><small>${esc(date(item.at))}</small></div></div>`).join('') : '<div class="empty-box">Ainda nao ha atividades suficientes para montar a linha do tempo.</div>';
      } catch (error) {
        $('#spMemberNotifications').textContent = error.message || 'Falha ao carregar notificacoes.';
      }
    };
    refresh();
    setTimeout(refresh, 2500);
    setInterval(() => { if (document.visibilityState === 'visible' && document.querySelector('#page-member-home:not([hidden])')) refresh(); }, 60000);
  }

  function setupGoals() {
    const publicHost = $('#spPublicGoalsList');
    const adminHost = $('#spAdminGoalsList');
    const form = $('#spGoalForm');
    const render = async () => {
      const result = await safeApi('/api/public/goals');
      const items = result.items || [];
      if (publicHost) publicHost.innerHTML = items.length ? items.filter(g => g.status === 'ACTIVE').map(g => `<article class="sp-goal-card"><div><b>${esc(g.title)}</b><p>${esc(g.description || '')}</p></div><strong>${g.current == null ? 'Dados incompletos' : `${fmt(g.current)} / ${fmt(g.target)}`}</strong><div class="sp-progress"><span style="width:${g.progress == null ? 0 : g.progress}%"></span></div><small>${g.progress == null ? 'Aguardando dados reais completos' : `${g.progress}% concluido`}</small></article>`).join('') : '<div class="empty-box">A administracao ainda nao criou metas coletivas.</div>';
      if (adminHost) adminHost.innerHTML = items.map(g => `<article class="admin-row"><div class="admin-row-main"><b>${esc(g.title)}</b><small>${esc(g.metric)} · ${fmt(g.current)} / ${fmt(g.target)} · ${esc(g.status)}</small></div>${g.status === 'ACTIVE' ? `<button type="button" class="mini-action danger" data-sp-close-goal="${esc(g.id)}">ENCERRAR</button>` : ''}</article>`).join('');
    };
    if (form) form.addEventListener('submit', async event => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      body.action = 'create'; body.target = Number(body.target);
      const button = form.querySelector('button[type="submit"]'); button.disabled = true;
      try { await safeApi('/api/admin/goals', {method:'POST', body:JSON.stringify(body)}); form.reset(); $('#spGoalFeedback').textContent='Meta coletiva criada.'; await render(); }
      catch (error) { $('#spGoalFeedback').textContent=error.message || 'Nao foi possivel criar a meta.'; }
      finally { button.disabled=false; }
    });
    if (adminHost) adminHost.addEventListener('click', async event => {
      const button = event.target.closest('[data-sp-close-goal]'); if (!button) return;
      try { await safeApi('/api/admin/goals', {method:'POST', body:JSON.stringify({action:'close', id:button.dataset.spCloseGoal})}); await render(); }
      catch (error) { alert(error.message || 'Nao foi possivel encerrar a meta.'); }
    });
    render().catch(error => { if (publicHost) publicHost.textContent=error.message; });
  }

  function setupMonitor() {
    const status = $('#spSystemHealth');
    const host = $('#spMonitorDetails');
    if (!status || !host) return;
    const refresh = async () => {
      try {
        const h = await safeApi('/api/health');
        const p = h.playerSync || {};
        status.textContent = h.ok ? 'SERVIDOR ONLINE' : 'ATENCAO';
        status.className = `status-tag ${h.ok ? 'good' : 'warn'}`;
        const rows = [['Versao', h.appVersion],['Armazenamento',h.storageDriver],['Persistencia configurada',h.storage?.configured?'Sim':'Nao'],['Revisao Firestore',h.storage?.revision ?? 'N/A'],['API Brawl Stars',h.apiConfigured?'Configurada':'Nao configurada'],['Membros ativos',p.activeMembers ?? 0],['Perfis com sincronizacao parcial',p.partialMembers ?? 0],['Perfis desatualizados',p.staleMembers ?? 0],['Ultimo ciclo',date(p.lastSyncAt)],['Ultimo erro',p.lastError || 'Nenhum erro informado']];
        host.innerHTML = rows.map(([label,value]) => `<div class="sp-monitor-stat"><small>${esc(label)}</small><b>${esc(value)}</b></div>`).join('');
      } catch (error) { status.textContent='FALHA DE CONSULTA'; status.className='status-tag warn'; host.textContent=error.message || 'Monitoramento indisponivel.'; }
    };
    refresh(); setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
  }

  function setupOnboarding() {
    let seen = false;
    try { seen = localStorage.getItem('starpark-onboarding-v1') === '1'; } catch {}
    if (seen) return;
    const overlay = document.createElement('div');
    overlay.className = 'sp-onboarding-backdrop';
    overlay.innerHTML = '<section class="sp-onboarding" role="dialog" aria-modal="true" aria-labelledby="spOnboardingTitle"><span class="kicker">BEM-VINDO A STAR PARK</span><h2 id="spOnboardingTitle">Sua jornada comeca aqui!</h2><p>Explore a comunidade, confira os rankings, acompanhe eventos e, depois de se tornar membro, use a Central do Jogador para acompanhar sua evolucao.</p><ul><li>Recrutamento e confirmacao pelo WhatsApp.</li><li>Dados de jogo consultados pela API, sem inventar estatisticas.</li><li>Comunicados oficiais dentro da plataforma; conversas continuam no WhatsApp.</li></ul><button type="button" class="btn btn-yellow" id="spOnboardingClose">ENTENDI</button></section>';
    document.body.append(overlay);
    $('#spOnboardingClose', overlay).addEventListener('click', () => { try { localStorage.setItem('starpark-onboarding-v1','1'); } catch {} overlay.remove(); });
  }

  function setupWorkspaceSwitch() {
    const chip = $('.house-chip');
    if (!chip) return;
    let host = $('#spWorkspaceSwitch');
    if (!host) { host = document.createElement('div'); host.id = 'spWorkspaceSwitch'; host.className = 'sp-workspace-switch'; chip.insertAdjacentElement('afterend', host); }
    const render = () => {
      const hasMember = Boolean(window.starParkHasRole?.('MEMBER'));
      const hasAdmin = Boolean(window.starParkHasRole?.('ADMIN'));
      const area = window.starParkCurrentArea?.() || 'public';
      const buttons = [{id:'public',label:'PÚBLICO',symbol:'⌂'}];
      if (hasMember) buttons.push({id:'member',label:'MEMBRO',symbol:'♟'});
      if (hasAdmin) buttons.push({id:'admin',label:'ADMIN',symbol:'⚙'});
      host.innerHTML = buttons.map(item => `<button type="button" class="sp-workspace-button ${area===item.id?'active':''}" data-sp-workspace="${item.id}" aria-pressed="${area===item.id}"><span>${item.symbol}</span>${item.label}</button>`).join('');
    };
    host.addEventListener('click', event => { const button = event.target.closest('[data-sp-workspace]'); if (!button) return; window.starParkSelectWorkspace?.(button.dataset.spWorkspace); render(); });
    window.addEventListener('starpark:auth-change', render);
    render();
  }

  function setupAdminAnalytics() {
    const anchor = $('#adminOverview');
    if (!anchor || anchor.dataset.spAnalytics === '1') return;
    anchor.dataset.spAnalytics = '1';
    const panel = document.createElement('section'); panel.id = 'spAdminAnalytics'; panel.className = 'sp-analytics-panel';
    anchor.insertAdjacentElement('afterend', panel);
    const chart = (title, note, rows) => {
      const max = Math.max(1, ...rows.map(row => row.value));
      const content = rows.length ? rows.map(row => `<div class="sp-chart-row"><span>${esc(row.label)}</span><div class="sp-chart-track"><i style="width:${Math.max(0,Math.min(100,row.value/max*100))}%"></i></div><b>${fmt(row.value)}</b></div>`).join('') : '<div class="sp-chart-empty">Ainda não há dados suficientes para este gráfico.</div>';
      return `<article class="sp-chart-card"><h3>${esc(title)}</h3><p>${esc(note)}</p>${content}</article>`;
    };
    const render = () => {
      if (!window.starParkHasRole?.('ADMIN')) { panel.hidden = true; return; }
      panel.hidden = false;
      const data = typeof admin === 'object' && admin ? admin : {};
      const apps = Array.isArray(data.applications) ? data.applications : [];
      const members = (Array.isArray(data.members) ? data.members : []).filter(member => member.status === 'ACTIVE');
      const statuses = ['PENDING','IN_REVIEW','NEEDS_INFORMATION','APPROVED','AWAITING_WHATSAPP','ACTIVE','REJECTED','CANCELLED'];
      const statusLabels = {PENDING:'Novas',IN_REVIEW:'Em análise',NEEDS_INFORMATION:'Com pendência',APPROVED:'Aprovadas',AWAITING_WHATSAPP:'WhatsApp',ACTIVE:'Ativadas',REJECTED:'Rejeitadas',CANCELLED:'Canceladas'};
      const applicationRows = statuses.map(status => ({label:statusLabels[status],value:apps.filter(item=>item.status===status).length})).filter(row=>row.value>0);
      const trophyGroups = [
        {label:'0–4.999',min:0,max:4999,value:0},{label:'5.000–9.999',min:5000,max:9999,value:0},
        {label:'10.000–19.999',min:10000,max:19999,value:0},{label:'20.000–29.999',min:20000,max:29999,value:0},
        {label:'30.000+',min:30000,max:Infinity,value:0}
      ];
      let knownTrophies=0;for(const member of members){const value=Number(member.currentTrophies);if(member.currentTrophies==null||!Number.isFinite(value))continue;knownTrophies++;const group=trophyGroups.find(item=>value>=item.min&&value<=item.max);if(group)group.value++;}
      const syncRows = ['OK','PARTIAL','STALE','RATE_LIMITED','PENDING'].map(status=>({label:status==='OK'?'Atualizados':status==='PARTIAL'?'Parciais':status==='STALE'?'Desatualizados':status==='RATE_LIMITED'?'Limite da API':'Pendentes',value:members.filter(m=>(m.apiSyncStatus||'PENDING')===status).length})).filter(row=>row.value>0);
      const brawlerCounts = new Map();for(const member of members){const name=member.representedBrawlerName||'Não informado';brawlerCounts.set(name,(brawlerCounts.get(name)||0)+1);}
      const brawlerRows=[...brawlerCounts].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value).slice(0,7);
      panel.innerHTML = `<div class="sp-analytics-heading"><div><span class="kicker">DADOS DA OPERAÇÃO</span><h2>Indicadores da Star Park</h2></div><small>Calculados com os registros disponíveis agora; sem histórico ou números inventados.</small></div><div class="sp-analytics-grid">${chart('Fluxo de candidaturas','Distribuição por status atual.',applicationRows)}${chart('Faixas de troféus','Membros ativos com troféus conhecidos: '+knownTrophies+'.',trophyGroups.filter(row=>row.value>0))}${chart('Saúde da sincronização','Estado da última consulta oficial por membro ativo.',syncRows)}${chart('Brawlers representantes','Distribuição dos Brawlers escolhidos pelos membros ativos.',brawlerRows)}</div>`;
    };
    const observer = new MutationObserver(render); observer.observe(anchor,{childList:true,subtree:true,characterData:true});
    window.addEventListener('starpark:auth-change',render); render();
  }

  function setupIdentityConsolidation() {
    const staffList = $('#staffList'); if (!staffList || staffList.dataset.spIdentityLink === '1') return;
    staffList.dataset.spIdentityLink = '1';
    let panel = $('#spIdentityLinkPanel');
    if (!panel) { panel=document.createElement('section');panel.id='spIdentityLinkPanel';panel.className='game-panel sp-identity-link-panel';staffList.insertAdjacentElement('afterend',panel); }
    const render = () => {
      if (!window.starParkHasRole?.('OWNER')) { panel.hidden=true; return; }
      panel.hidden=false;
      const data = typeof admin === 'object' && admin ? admin : {};
      const users = (data.users||[]).filter(item=>['ADMIN','OWNER'].includes(item.role)&&!item.disabled&&!item.memberId);
      const approvedIds = new Set((data.applications||[]).filter(item=>Array.isArray(item.history)&&item.history.some(entry=>entry.status==='APPROVED')).map(item=>item.id));
      const members = (data.members||[]).filter(item=>item.status==='ACTIVE'&&approvedIds.has(item.applicationId));
      const memberOptions = members.map(item=>`<option value="${esc(item.id)}">${esc(item.displayName)} · #${esc(item.playerTag)}</option>`).join('');
      const userOptions = users.map(item=>`<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.role)} · ${esc(item.email||item.username||'')}</option>`).join('');
      panel.innerHTML = `<div class="panel-head"><div><span class="kicker">IDENTIDADE ÚNICA</span><h3>Vincular administrador ao perfil de membro</h3></div></div><p>Consolida os dois espaços em um login. A conta administrativa escolhida mantém suas credenciais; a antiga conta MEMBER, quando selecionada, é desativada e preservada no histórico.</p><form id="spIdentityLinkForm" class="sp-identity-link-form"><label>Conta administrativa<select name="userId" required><option value="">Selecione</option>${userOptions}</select></label><label>Membro aprovado<select name="memberId" required><option value="">Selecione</option>${memberOptions}</select></label><label>Conta MEMBER antiga (opcional)<select name="mergeFromUserId"><option value="">Não consolidar outra conta</option></select></label><button type="submit" class="btn btn-yellow">VINCULAR IDENTIDADE</button><div id="spIdentityLinkFeedback" class="form-feedback" role="status"></div></form>${users.length&&members.length?'':'<div class="empty-box">Para vincular, é necessário haver uma conta administrativa sem perfil de membro e um membro ativo com candidatura aprovada.</div>'}`;
      const form = $('#spIdentityLinkForm',panel); if(!form)return;
      form.elements.memberId.addEventListener('change',()=>{
        const selected = form.elements.memberId.value;
        const linked = (data.users||[]).filter(item=>item.memberId===selected&&item.role==='MEMBER'&&!item.disabled);
        form.elements.mergeFromUserId.innerHTML = '<option value="">Não consolidar outra conta</option>'+linked.map(item=>`<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.email||item.username||'')}</option>`).join('');
      });
      form.addEventListener('submit',async event=>{
        event.preventDefault();const button=form.querySelector('button[type="submit"]');button.disabled=true;
        try{const body=Object.fromEntries(new FormData(form));await safeApi(`/api/admin/users/${encodeURIComponent(body.userId)}/link-member`,{method:'POST',body:JSON.stringify(body)});$('#spIdentityLinkFeedback').textContent='Identidade consolidada. O login administrativo agora também abre a área de membro.';if(typeof loadAdminData==='function')await loadAdminData();}
        catch(error){$('#spIdentityLinkFeedback').textContent=error.message||'Não foi possível vincular as identidades.';}
        finally{button.disabled=false;}
      });
    };
    const observer = new MutationObserver(render); observer.observe(staffList,{childList:true,subtree:true});
    window.addEventListener('starpark:auth-change',render); render();
  }

  function init() {
    setupWorkspaceSwitch();
    setupAdminAnalytics();
    setupIdentityConsolidation();
    setupTagPreview();
    setupWhatsAppSuccess();
    setupMemberQueue();
    setupMemberExtras();
    setupGoals();
    setupMonitor();
    setupOnboarding();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();

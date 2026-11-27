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
    const feedback = $('#applicationFeedback');
    if (!feedback || feedback.dataset.spObserver) return;
    feedback.dataset.spObserver = '1';
    const observer = new MutationObserver(async () => {
      const message = feedback.textContent || '';
      if (!/Candidatura recebida|Protocolo/i.test(message)) return;
      if ($('#spApplicationWhatsApp')) return;
      const box = document.createElement('div');
      box.id = 'spApplicationWhatsApp';
      box.className = 'sp-application-next';
      const title = document.createElement('b'); title.textContent = 'Proxima etapa: entrar na comunidade';
      const copy = document.createElement('p'); copy.textContent = 'Sua candidatura ja esta aguardando a confirmacao manual da administracao. Entre pelo link e aguarde a verificacao.';
      const link = document.createElement('a'); const community = await safeApi('/api/public/settings').catch(() => ({})); link.href = community.whatsappCommunityUrl || WA_URL; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'ENTRAR NA COMUNIDADE DO WHATSAPP';
      box.append(title, copy, link);
      feedback.insertAdjacentElement('afterend', box);
    });
    observer.observe(feedback, {childList:true, subtree:true, characterData:true});
  }

  function setupMemberQueue() {
    const host = $('#spAwaitingList');
    if (!host) return;
    const render = async () => {
      if (!auth?.user || auth.user.role === 'MEMBER' || adminQueueBusy) return;
      adminQueueBusy = true;
      try {
        const result = await safeApi('/api/admin/applications');
        const items = (result.items || []).filter(item => item.status === 'AWAITING_WHATSAPP');
        $('#spAwaitingCount').textContent = String(items.length);
        host.innerHTML = items.length ? items.map(item => `<article class="admin-row sp-awaiting-row" data-sp-application="${esc(item.id)}"><div class="admin-row-main"><b>${esc(item.displayName)} · ${esc(item.gameNickname)}</b><small>#${esc(item.playerTag)} · ${esc(item.desiredBrawlerName || 'Brawler nao informado')} · Enviada: ${esc(date(item.submittedAt))}</small>${item.wantsMemberAccount ? '<span class="status-tag">INTERESSE EM CONTA DE MEMBRO</span>' : ''}<span class="status-tag warn">AGUARDANDO WHATSAPP</span></div><div class="admin-row-actions"><button class="mini-action primary" type="button" data-sp-confirm>CONFIRMAR ENTRADA</button><button class="mini-action danger" type="button" data-sp-reject>REJEITAR</button></div></article>`).join('') : '<div class="empty-box"><b>Nenhuma pessoa aguardando confirmacao.</b><p>Novas candidaturas aparecerao aqui depois do envio.</p></div>';
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
      if (!auth?.user || auth.user.role !== 'MEMBER') return;
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

  function init() {
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

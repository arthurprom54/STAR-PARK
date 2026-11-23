# STAR PARK 5.0.2 — correções de sincronização, indicadores e contas de membros

## 1. Sincronização automática

- Perfis ativos passam a entrar em ciclos com intervalo-alvo de 60 segundos.
- Todas as chamadas à API oficial passam por uma fila global serial, com espaçamento mínimo configurável por `STAR_PARK_API_MIN_REQUEST_INTERVAL_MS` (padrão de 300 ms).
- Ciclos concorrentes são bloqueados.
- Respostas HTTP 429 respeitam `Retry-After` (com pausa de segurança quando o servidor não informa o prazo).
- Se o limite for atingido no meio de uma rodada, os membros que ficaram esperando são marcados como limitados/desatualizados; não aparecem como sincronizados por engano.
- Falhas preservam o último dado válido.
- O catálogo de imagens e informações visuais dos Brawlers continua em rotina independente, padrão de seis horas.

## 2. Indicadores

- Normalização dos campos disponíveis no perfil oficial: troféus atuais e recorde, nível e XP, vitórias 3x3/Solo/Duo, clube, quantidade de Brawlers, Brawler com maior troféu, recordes de Robo Rumble e Big Brawler e qualificação de Championship Challenge.
- Valores que não vierem na resposta oficial permanecem indisponíveis (`null`), não são fabricados como zero.
- Totais coletivos que exigem cobertura completa só aparecem quando todos os membros ativos têm os dados necessários.
- Battle Logs são deduplicados e agregados em histórico e contadores persistentes por membro.
- O histórico de troféus é limitado a 180 pontos por membro; detalhes recentes de batalha são limitados às últimas 100 entradas para controlar o tamanho dos documentos.
- O formato de batalha solo com `battle.brawler` sem lista de jogadores também é reconhecido.
- A interface diferencia dados oficiais do perfil de estatísticas observadas no Battle Log.

## 3. Cadastro de contas de membros

- Membros ativos podem solicitar o primeiro acesso com tag, e-mail e senha.
- A senha é protegida por hash scrypt com salt aleatório; os segredos são removidos do pedido após aprovação ou rejeição.
- Solicitações têm fila no painel administrativo.
- OWNER/ADMIN pode aprovar ou rejeitar; a aprovação revalida o membro, a tag e a existência de conta para impedir duplicidade.
- O papel criado é sempre `MEMBER`, vinculado ao registro ativo correspondente.
- O endpoint tem limite de tentativas por IP e não cria acesso automaticamente.

## 4. Automação de publicação

- Workflow manual no GitHub Actions: `STAR PARK — validar e publicar`.
- Executa checagem de sintaxe e a suíte de testes antes de solicitar deploy.
- Pós-deploy confere a versão 5.0.2, Firestore, OWNER, API oficial, intervalos configurados e resultado integral da última sincronização.
- Requer `RENDER_DEPLOY_HOOK_URL` como secret e `STAR_PARK_HEALTH_URL` como variable do repositório.

## Testes desta entrega

- `npm test`: 23 testes aprovados, 0 falhas.
- `node --check server.mjs`
- `node --check lib/brawl-stats.mjs`
- `node --check lib/firestore-store.mjs`
- `node --check public/app.js`

## Limites que permanecem

- A API Supercell não fornece um histórico vitalício ilimitado de batalhas. O Brawler mais usado é calculado sobre as partidas observadas e acumuladas pelo Star Park.
- O Battle Log pode levar até 30 minutos para mostrar uma batalha nova. O ciclo de 60 segundos é a frequência de consulta do servidor, não uma garantia de atualização instantânea de uma partida.
- O tempo para percorrer todos os membros depende da quantidade de jogadores, latência e limite do token. O código usa fila e cooldown para preservar dados e não pressionar a API.
- A API da Supercell pode exigir que o IP de saída do serviço Render esteja autorizado no portal de desenvolvedor.

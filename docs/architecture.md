# Arquitetura e regras de domínio — STAR PARK

## Áreas e rotas lógicas

- Público: início, diretório, Brawlers, rankings, estatísticas, eventos, comunicados, recrutamento e aviso de privacidade.
- Membro: painel pessoal, perfil, troféus/evolução, eventos, mural interno e solicitações de privacidade.
- Administração: dashboard, candidaturas, membros, Brawlers, eventos, comunicados, mensagens, equipe/permissões, auditoria, privacidade, API e configurações.

## Papéis

- `OWNER`: controle total; pode criar contas de equipe, acessar contatos e corrigir baseline.
- `ADMIN`: gestão operacional; pode criar contas MEMBER, mas não outros administradores.
- `MODERATOR`: análise de candidaturas e moderação operacional, sem acesso ao telefone por padrão.
- `MEMBER`: acesso apenas ao próprio perfil e funções de membro.
- `VISITOR`: endpoints públicos.

O servidor verifica permissões; a navegação do cliente não é a barreira de segurança.

## Candidaturas

`PENDING → IN_REVIEW → NEEDS_INFORMATION / APPROVED / REJECTED / CANCELLED`

`APPROVED → AWAITING_WHATSAPP → ACTIVE`

`ACTIVE` não é alcançado por aprovação simples. A ativação ocorre em endpoint separado, após confirmação manual de entrada no grupo. O endpoint confirma novamente estado e reserva dentro da operação serializada.

## Brawlers

`AVAILABLE`: não existe membro ativo nem candidatura aberta reservando o Brawler.

`RESERVED`: candidatura válida em estado ativo reservando o Brawler.

`UNAVAILABLE`: existe membro ativo representando o Brawler.

A reserva é revalidada na mutação serializada para impedir concorrência dentro do processo. Para múltiplas instâncias, essa garantia precisa migrar para uma transação no banco gerenciado.

## Baseline

- Capturado durante ativação após confirmação do WhatsApp.
- Falha de API mantém `PENDING_CAPTURE`.
- Captura posterior registra o timestamp real.
- Sincronização de troféus atuais não altera baseline.
- Correção é OWNER-only, exige valor inteiro e justificativa e gera auditoria.

## Privacidade

- Contato e faixa etária ficam em documentos de candidatura privados no armazenamento local.
- O endpoint público de membros produz uma projeção com campos permitidos.
- OWNER é o único papel que recebe telefone nesta versão.
- Pedidos de titulares são registrados e aparecem no painel administrativo.
- A retenção e a identificação do controlador ainda precisam ser definidas antes do lançamento.

## Persistência atual

O modo local usa `data/store.json` e existe apenas para desenvolvimento/testes (`STAR_PARK_STORAGE_DRIVER=json`). A publicação deve usar `STAR_PARK_STORAGE_DRIVER=firestore`.

No Firestore, o servidor usa Firebase Admin SDK e grava documentos individuais nestas coleções:

- `users`: contas, papéis e hashes de senha (somente backend).
- `applications`: candidaturas e dados de contato/idade (somente backend).
- `members`: registros de membros.
- `events`, `announcements`, `audit`, `privacyRequests`, `snapshots`, `messageLogs`.
- `settings/main`: configurações da House.

O navegador nunca recebe a credencial Admin. `firestore.rules` bloqueia leitura e escrita direta por clientes web/mobile. O Admin SDK opera somente no servidor e ignora Security Rules; as rotas do backend continuam responsáveis pela autorização.

As mutações são executadas em transações Firestore para revalidar o estado compartilhado e persistir apenas os documentos alterados. A camada atual relê as coleções na mutação e mantém uma cópia em memória por compatibilidade com a lógica preexistente; isso serve à operação inicial de uma comunidade, mas aumenta leituras/custo conforme os registros crescem. Para escalar, substituir por consultas e repositórios específicos por domínio.

Sessões e rate limits ainda ficam em memória. Mantenha uma instância Render; para múltiplas instâncias, é necessário migrar sessões/rate limits para armazenamento compartilhado. Para dados antigos em JSON, use `npm run migrate:firestore -- caminho/para/store.json`; para exportar backup auxiliar, use `npm run backup:firestore -- caminho/para/backup.json`.


## API Supercell e indicadores (v5.0.2)

- Perfis ativos são consultados pelo servidor no intervalo configurável `STAR_PARK_PLAYER_SYNC_INTERVAL_SECONDS` (padrão 60 s; mínimo 30 s). Perfil e Battle Log são coletados por membro, mas todas as chamadas oficiais passam por uma fila serial global com espaçamento mínimo configurável (`STAR_PARK_API_MIN_REQUEST_INTERVAL_MS`, padrão 300 ms). Ciclos não se sobrepõem, falhas 429 marcam também os membros que ficaram aguardando, e o servidor respeita `Retry-After` antes de retomar.
- Campos oficiais de perfil que estiverem ausentes permanecem `null`; a camada pública não apresenta ausência como zero. Totais coletivos que exigem todos os perfis só são exibidos quando a cobertura é completa.
- Battle Logs recebidos são identificados por hash e agregados em `members/{id}.battleUsage`; detalhes recentes ficam em `members/{id}.battleHistory` (últimas 100 partidas) para deduplicação e transparência. Contadores de uso acumulam apenas batalhas novas observadas. Histórico de troféus é limitado a 180 pontos por membro em `members/{id}.trophyHistory`, evitando crescimento ilimitado da coleção global de snapshots.
- O Battle Log oficial pode demorar até 30 minutos para exibir uma nova batalha; portanto, consultar a cada 60 segundos não significa que a partida aparecerá imediatamente. A Supercell fornece um Battle Log recente, não um histórico vitalício ilimitado. Portanto, “Brawler mais usado” e modos representam somente partidas que o Star Park conseguiu observar desde que começou a coleta, não a carreira inteira do jogador.
- Cada conta de membro é solicitada pelo próprio jogador com tag, e-mail e senha. O pedido fica pendente; OWNER/ADMIN deve conferir o vínculo ativo com a House e aprovar. A senha é armazenada como hash scrypt com salt aleatório; segredo e hash são removidos do pedido após aprovação/rejeição e nunca são retornados ao frontend.
- `accountRequests` é uma coleção Firestore adicional. Battle history e contadores são embutidos no documento `members` para evitar uma coleção global ilimitada.

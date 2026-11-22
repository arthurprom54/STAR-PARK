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

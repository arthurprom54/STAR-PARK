# STAR PARK 5.1.0 — A arena é nossa!

Plataforma comunitária independente para organizar a House STAR PARK de Brawl Stars. Não é produto oficial, não possui vínculo, patrocínio nem aprovação da Supercell.

## Organização dos arquivos

- `public/`: interface e arquivos que o navegador pode receber.
- `server.mjs` e `lib/`: backend e acesso ao armazenamento; não são publicados como arquivos estáticos.
- `scripts/`: migração e exportação administrativa; executar apenas em ambiente confiável.
- `tests/`: testes automatizados.
- `docs/`: documentação de operação e publicação.
- `firestore.rules`: regras a publicar no console Firebase, não é uma página do site.

O Render recebe o repositório completo para executar o Node.js, mas o servidor só disponibiliza explicitamente os arquivos da pasta `public/` listados na allowlist.

## Experiência do produto

A aplicação possui três áreas separadas:

### 1. Área pública
- Página inicial da House com indicadores reais e estados vazios honestos.
- Diretório de membros ativos com somente os campos marcados como públicos.
- Enciclopédia de Brawlers com imagens, pesquisa, filtros por raridade/classe/estado e ficha de detalhes.
- Rankings de troféus e evolução desde o baseline.
- Estatísticas agregadas, eventos, comunicados e recrutamento.
- Atualização visual automática de perfis e indicadores a cada 60 segundos por padrão.
- Histórico próprio deduplicado das batalhas que a API forneceu durante a coleta.
- Aviso de privacidade e aviso de independência da Supercell.

### 2. Área dos membros
- Cadastro próprio de primeiro acesso, com senha protegida e aprovação administrativa obrigatória.
- Login individual e sessão protegida.
- Painel pessoal com troféus atuais, baseline e evolução, quando disponíveis.
- Edição limitada do próprio perfil e das preferências de visibilidade.
- Eventos, inscrições e mural interno.
- Solicitações de acesso, correção ou exclusão de dados.

### 3. Área administrativa
- Login administrativo e dashboard operacional.
- Fila de candidaturas, notas privadas e transições de estado.
- Cadastro manual de membros por tag.
- Gestão de membros, suspensão, reativação e encerramento.
- Confirmação manual de entrada no WhatsApp antes da ativação.
- Reserva exclusiva de Brawlers, com validação serializada no servidor.
- Captura de baseline de troféus no momento da ativação e correção excepcional auditada.
- Gestão de eventos, comunicados, modelos e central de mensagens WhatsApp.
- Criação de contas de membro/equipe, auditoria, solicitações de privacidade e configurações.
- Status da API oficial e atualização manual do catálogo visual.

## Catálogo de Brawlers e imagens

### Lista incluída

O snapshot local deste pacote contém **111 personagens únicos**: 108 Brawlers no arquivo principal `public/brawlers.json` e os três lançamentos do conjunto de novembro de 2026 — **Thunder Frogs, Rey e Ruby** — em `public/brawlers-supplement.json`. A lista exclui Buzz Lightyear da seleção atual porque a fonte consultada o marcava como temporário/não disponível (`released: false`). A contagem não é tratada como permanente: quando a BrawlAPI incluir novos lançamentos, a galeria atualiza dinamicamente e remove duplicatas pelas chaves dos personagens.

### Como as imagens aparecem

- Para os 108 personagens do snapshot principal, o site já inclui ID e URL de modelo de corpo inteiro no CDN Brawlify (`https://cdn.brawlify.com/brawlers/model/{id}.png`).
- Para Thunder Frogs, Rey e Ruby, o pacote inclui retratos de personagem hospedados no CDN BrawlHub.
- Caso o modelo principal falhe, a interface tenta as imagens do catálogo e um retrato BrawlHub montado a partir da chave do Brawler. As iniciais só aparecem se as fontes de imagem falharem.
- A lista do catálogo público é enriquecida em tempo real com dados da BrawlAPI (`https://api.brawlapi.com/v1/brawlers`): raridade, classe, descrição, acessórios, poderes e imagens.
- O catálogo visual **não precisa da chave privada da API da Supercell**. O navegador também tenta consultar a BrawlAPI diretamente; a galeria começa a renderizar usando o snapshot enquanto essa consulta acontece.

A cobertura de catálogo consultada em 22/11/2026 era de 109 entradas BrawlAPI, incluindo Buzz Lightyear marcado como indisponível. As notas oficiais da atualização de 11/11/2026 anunciavam os três Brawlers novos, que ainda não estavam naquele snapshot da BrawlAPI; por isso o arquivo complementar foi adicionado. Essa combinação forma os 111 personagens atuais no snapshot incluído. Novos lançamentos serão incorporados quando a fonte comunitária for atualizada; se houver atraso, o arquivo complementar pode ser atualizado pela administração/desenvolvimento.

**Dependência de internet:** as imagens são carregadas de CDNs externos. Se a rede do visitante bloquear `cdn.brawlify.com` ou `cdn.brawlhub.gg`, os nomes e a lista permanecem disponíveis, mas as imagens poderão não aparecer. O pacote guarda URLs e metadados, não copia os arquivos de arte para dentro do ZIP.

BrawlAPI, Brawlify e BrawlHub são fontes de terceiros, não serviços oficiais da Supercell. O CDN Brawlify documenta imagens, retratos e modelos de Brawlers. O BrawlHub descreve sua coleção como uma coleta feita por fãs. As imagens são assets relacionados ao jogo, usados somente para identificação em uma comunidade de fãs. A STAR PARK não reproduz o logotipo nem se apresenta como produto oficial. Mantenha o aviso de não oficialidade e consulte a [Política de Conteúdo para Fãs da Supercell](https://supercell.com/en/fan-content-policy/pt/) antes de publicar.

Fontes consultadas: [BrawlAPI — lista de Brawlers](https://api.brawlapi.com/v1/brawlers), [Brawlify CDN — documentação dos assets](https://github.com/Brawlify/CDN), [BrawlHub — coleção de retratos](https://brawlhub.gg/resources/portraits/), [notas oficiais da atualização de novembro de 2026](https://supercell.com/en/games/brawlstars/blog/), [Política de Conteúdo para Fãs](https://supercell.com/en/fan-content-policy/pt/).


## Navegação de acesso (versão 4.2)

O seletor Público/Membros/Admin foi removido da barra lateral. Visitantes navegam somente pela área pública. O botão **ENTRAR** abre um hub com dois acessos separados: portal do membro e acesso administrativo. O acesso administrativo também pode ser encontrado no rodapé. Depois do login, o menu lateral muda conforme o papel da conta; o frontend também redireciona tentativas de abrir páginas internas sem a função correta, enquanto o servidor continua sendo a autoridade real das permissões.

## Instalação local

Requisitos: Node.js 22 ou superior.

1. Extraia o ZIP.
2. Abra um terminal na pasta `star-park`.
3. Copie `.env.example` para `.env`.
4. Configure as três variáveis OWNER antes de usar a área administrativa.
5. Execute:

```bash
npm start
```

6. Abra `http://localhost:4173`.

Para desenvolvimento com reinício automático:

```bash
npm run dev
```

## Primeiro acesso OWNER

Não há senha padrão nem conta universal embutida. No `.env`, configure:

```env
STAR_PARK_OWNER_EMAIL=seu-email@exemplo.com
STAR_PARK_OWNER_PASSWORD=uma-senha-forte-com-14-caracteres-ou-mais
STAR_PARK_SESSION_SECRET=segredo-aleatorio-longo
```

Gere um segredo de sessão com:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Na primeira inicialização, a conta OWNER é criada se ainda não existir. Senhas são derivadas com `scrypt`; cookies de sessão são `HttpOnly`, `SameSite=Strict` e assinados com HMAC. O OWNER cria contas adicionais na área **Administração → Equipe & permissões**. Mantenha `.env` fora do controle de versão.

## Integração com a API oficial de Brawl Stars

Fonte oficial: [developer.brawlstars.com](https://developer.brawlstars.com/).

Configure no `.env`:

```env
BRAWL_STARS_API_TOKEN=token_emitido_no_portal_oficial
BRAWLER_SYNC_INTERVAL_HOURS=6
STAR_PARK_PLAYER_SYNC_INTERVAL_SECONDS=60
STAR_PARK_API_MIN_REQUEST_INTERVAL_MS=300
```

A chave permanece exclusivamente no servidor. Ela é usada para consultar jogadores por tag, troféus e battlelogs; não é necessária para exibir o catálogo visual. A autorização depende das regras vigentes no portal da Supercell, incluindo IP autorizado quando exigido. Não presuma que qualquer hospedagem serverless tem IP de saída fixo.

A aplicação trata falhas, serializa chamadas autenticadas com espaçamento global, respeita pausas HTTP 429 e mantém o último valor válido; não inventa troféus. A API oficial não fornece um agregado vitalício comunitário do “Brawler mais usado”. O site calcula o indicador a partir dos battlelogs recentes consultados. “Brawler com mais troféus” é calculado somando os troféus desse Brawler nos perfis dos membros ativos sincronizados.

## Regras de negócio principais

- A House é independente; membros são cadastrados pela administração usando tags de jogador. Depois de ativos, eles podem solicitar conta própria e aguardar aprovação administrativa.
- A candidatura não pede troféus; a plataforma consulta a API quando configurada. O recrutamento começa fechado por padrão e só deve ser aberto após a revisão de privacidade e armazenamento.
- Uma candidatura válida reserva o Brawler desejado; a operação serializada impede duas reservas concorrentes nesta instância.
- Rejeição, cancelamento e expiração liberam reserva. Aprovação não ativa o membro.
- A ativação ocorre somente após a administração confirmar manualmente que o candidato entrou no WhatsApp.
- O baseline de troféus é capturado na ativação; se a API falhar, fica pendente até captura real posterior.
- Sincronizações comuns atualizam troféus atuais, nunca sobrescrevem o baseline.
- Correção de baseline exige OWNER, justificativa e auditoria.
- Cada membro ativo representa um Brawler e cada Brawler tem no máximo um representante ativo.
- Telefone, faixa etária, motivação e notas de candidatura não aparecem no diretório público.
- Abrir o WhatsApp não é considerado envio; o envio só é registrado após confirmação manual.
- Dados ausentes não são convertidos em zero nos rankings.

## Dados e arquitetura desta entrega

O projeto foi evoluído sobre a base HTML/CSS/JavaScript + Node existente, preservando o frontend e o servidor Node.js atuais. O servidor implementa endpoints, sessões, autorização por papel, validação, proteção CSRF, rate limiting básico, integração server-side com a API oficial e dois modos de persistência: JSON para desenvolvimento local e Cloud Firestore para publicação. Quando `STAR_PARK_STORAGE_DRIVER=firestore`, o servidor usa Firebase Admin SDK e organiza os dados em documentos individuais nas coleções `users`, `applications`, `members`, `events`, `announcements`, `audit`, `privacyRequests`, `snapshots` e `messageLogs`; as configurações ficam em `settings/main`. O navegador não recebe credenciais nem acessa o banco diretamente. As regras `firestore.rules` negam acesso a clientes web/mobile. O catálogo público é mantido em cache local em `data/brawlers-cache.json`; esse cache pode ser reconstruído e não contém os registros de membros.

**Limitações importantes:** as mutações usam transações Firestore, mas a lógica atual carrega os registros em memória e relê as coleções a cada mutação. É uma ponte de compatibilidade adequada para a comunidade em estágio inicial, não a arquitetura final para grande escala. Sessões e rate limits também permanecem em memória; mantenha uma única instância do Render. Para crescer horizontalmente, será necessário persistir sessões/rate limits e substituir a camada de compatibilidade por consultas específicas por domínio. Não receba dados reais de crianças/adolescentes antes de concluir a revisão LGPD, política de retenção, acesso mínimo e backups. O Firestore Admin SDK tem privilégios administrativos e ignora Security Rules; a chave deve permanecer exclusivamente nas variáveis secretas do servidor.

## Testes executados

Com Node.js 22:

```bash
node --check public/app.js
node --check server.mjs
npm test
```

A suíte inclui testes de login OWNER, criação e limites de acesso de MEMBER, edição de perfil, eventos/comunicados, catálogo de Brawlers, reserva concorrente, ausência de métricas fictícias, acesso privado a candidaturas e persistência Firestore simulada. Execute `npm test` para validar a versão modificada.

## Configuração do Firestore

Para desenvolvimento local, `STAR_PARK_STORAGE_DRIVER=json` mantém o comportamento de arquivos JSON. Para produção, defina `STAR_PARK_STORAGE_DRIVER=firestore` e configure `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON completo de uma conta de serviço Firebase, ou use `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY`. Essas credenciais ficam somente no servidor. A dependência `firebase-admin` é carregada apenas no modo Firestore. O script `npm run migrate:firestore -- caminho/para/store.json` importa dados legados para coleções vazias; `npm run backup:firestore -- caminho/para/backup.json` exporta uma cópia de apoio.

## Variáveis de ambiente

| Variável | Finalidade |
|---|---|
| `PORT` | Porta HTTP, padrão `4173` |
| `BRAWL_STARS_API_TOKEN` | Token oficial da API, somente servidor |
| `STAR_PARK_OWNER_EMAIL` | E-mail inicial do OWNER |
| `STAR_PARK_OWNER_PASSWORD` | Senha inicial do OWNER, mínimo 14 caracteres |
| `STAR_PARK_SESSION_SECRET` | Segredo HMAC para cookies de sessão |
| `BRAWL_CATALOG_API_URL` | Fonte pública do catálogo visual (sem chave) |
| `BRAWLER_SYNC_INTERVAL_HOURS` | Intervalo de sincronização do catálogo visual, padrão 6 horas |
| `STAR_PARK_PLAYER_SYNC_INTERVAL_SECONDS` | Intervalo-alvo entre ciclos de consulta, padrão 60 segundos (mínimo 30; máximo 3600) |
| `STAR_PARK_API_MIN_REQUEST_INTERVAL_MS` | Espaçamento global mínimo entre chamadas autenticadas à Supercell, padrão 300 ms (mínimo 100) |
| `STAR_PARK_DISABLE_CATALOG_SYNC` | Desativa sincronização automática quando `1` (testes) |
| `STAR_PARK_DATA_DIR` | Diretório alternativo de dados/cache, útil em testes |
| `STAR_PARK_STORAGE_DRIVER` | `json` para desenvolvimento ou `firestore` para produção |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON completo de credenciais Admin, somente servidor |
| `FIREBASE_PROJECT_ID` | ID do projeto Firebase, alternativa à credencial JSON |
| `FIREBASE_CLIENT_EMAIL` | E-mail da conta de serviço, alternativa à credencial JSON |
| `FIREBASE_PRIVATE_KEY` | Chave privada da conta de serviço, alternativa à credencial JSON |
| `NODE_ENV` | Defina `production` somente atrás de HTTPS para ativar cookies `Secure` |

## Limitações e checklist antes de publicar

- Configurar backups periódicos do Firestore e validar restauração antes de abrir inscrições reais.
- Configurar domínio, HTTPS obrigatório, proteção de borda, logs e monitoramento.
- Manter credenciais Admin e token da API somente nas variáveis secretas do servidor; nunca em arquivos públicos.
- Configurar IP de saída estável se exigido pela API oficial.
- Implementar rate limiting distribuído, recuperação de senha e fluxo de convite/primeiro acesso.
- Completar permissões granulares e auditoria de leitura de dados de contato.
- Completar o aviso de privacidade com identificação do controlador, bases legais, retenção, compartilhamentos e canal dos titulares.
- Revisar juridicamente o tratamento de dados de crianças e adolescentes e a participação de responsáveis, conforme LGPD e orientações vigentes da ANPD.
- Testar responsividade, acessibilidade, segurança e concorrência em ambiente de staging e em aparelhos físicos.

Não há estimativa de custo de nuvem nesta entrega, pois nenhum provedor de produção foi selecionado. Custos de hospedagem, banco, IP fixo/NAT, logs, backups e monitoramento dependem de região, tráfego e plano contratado.

## Publicação na internet

A navegação de acesso foi reorganizada: visitantes veem apenas a área pública; o botão **ENTRAR** abre uma página separada para escolher o portal de membro ou o acesso administrativo. O link de administração também fica discretamente no rodapé. Depois de autenticar, o menu lateral passa a mostrar somente a área correspondente ao papel da conta.

Consulte [`docs/publicar.md`](docs/publicar.md) para o passo a passo de publicação como Node Web Service no Render com Firestore, variáveis secretas, criação do OWNER, integração da API oficial, migração de dados e backups.


## Notas da versão 5.0.2

Consulte [docs/alteracoes-v5-0-2.md](docs/alteracoes-v5-0-2.md) para as correções, verificações e limites conhecidos desta versão.

## STAR PARK 6.0.0 — Mega atualização integrada

- Candidaturas novas começam em `PENDING`; a confirmação de WhatsApp exige aprovação administrativa registrada no histórico.
- Solicitação e aprovação de conta de membro continuam em fluxo separado e exigem membro ativo vinculado a candidatura aprovada. Membros já ativados pelo fluxo anterior têm a aprovação histórica preservada na migração.
- Identidades podem reunir permissões `ADMIN`/`OWNER` e `MEMBER`; uma conta administrativa pode ser vinculada a um perfil, preservando e desativando com auditoria a conta de membro antiga quando houver consolidação.
- Correção de tag consulta novamente a API, exige confirmação do nickname retornado, arquiva o contexto anterior e reinicia as estatísticas para não misturar jogadores.
- A confirmação de candidatura substitui o formulário por uma tela com protocolo e link do WhatsApp.
- Indicadores administrativos usam dados atuais de candidaturas, troféus, sincronização e Brawlers; estados sem dados ficam vazios, sem valores fictícios.
- Perfis de Brawlers preservam gadgets, poderes e equipamentos somente quando esses campos estão presentes na resposta oficial.
- As áreas, eventos, anúncios, rankings, catálogo, sincronização, auditoria e recursos existentes são mantidos.

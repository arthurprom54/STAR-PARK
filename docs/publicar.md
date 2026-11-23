# Publicar a STAR PARK 5.0

Este projeto é um Web Service Node.js. Não publique como site estático: login, painel administrativo, sessões e API do Brawl Stars dependem do servidor.

## Separação entre arquivos públicos e privados

A pasta `public/` contém somente os arquivos que o navegador precisa baixar: `index.html`, `styles.css`, `app.js`, os snapshots JSON do catálogo e `assets/`. O servidor entrega apenas uma lista permitida desses caminhos.

Os arquivos `server.mjs`, `lib/`, `scripts/`, `tests/`, `docs/`, `firestore.rules`, `package.json` e `.env.example` **não são páginas nem arquivos públicos do site**. Eles permanecem no repositório privado do GitHub porque o Render precisa do servidor, das dependências e das instruções para executar a aplicação. Eles não são servidos como arquivos estáticos pelo site. Segredos, chaves de serviço, `.env` e dados reais nunca devem ser enviados ao GitHub.

## Arquitetura desta versão

- **Render Web Service:** executa o frontend servido pelo Node.js e as rotas do backend.
- **Cloud Firestore:** armazena usuários, candidaturas, membros, eventos, comunicados, auditoria, solicitações de privacidade, snapshots, logs de mensagens e configurações.
- **BrawlAPI:** fornece dados públicos do catálogo visual; não exige token privado.
- **API oficial Brawl Stars:** fornece dados de jogadores, troféus e battlelogs; exige token configurado apenas no backend.
- **GitHub privado:** guarda o código-fonte. Não envie chaves, arquivos `.env` ou dados de produção.

O backend usa Firebase Admin SDK. O navegador não acessa o Firestore diretamente. O arquivo `firestore.rules` nega leitura e escrita a clientes web/mobile; o Admin SDK do servidor opera com credencial de serviço e ignora as regras do Firestore.

## 1. Criar o projeto Firestore

1. Entre em https://console.firebase.google.com/ e crie um projeto `STAR-PARK`.
2. Abra **Firestore Database** e clique em **Create database**.
3. Escolha **Production mode**.
4. Escolha cuidadosamente a região antes de confirmar: a localização do banco não pode ser alterada depois. Para uma comunidade no Brasil, `southamerica-east1` (São Paulo) é uma opção regional; compare com a região escolhida para o Render antes de finalizar.
5. Depois que o banco for criado, publique as regras de `firestore.rules` no menu **Firestore Database → Rules**.
6. Em **Project settings → Service accounts**, gere uma chave privada para uma conta de serviço. Guarde o arquivo JSON como segredo. Não o envie ao GitHub, não o publique e não o coloque no frontend.

A conta de serviço é usada exclusivamente pelo backend com Firebase Admin SDK. O SDK Admin tem privilégios administrativos; proteja a chave como uma senha de servidor.

## 2. Preparar o repositório no GitHub

1. Extraia o ZIP.
2. Crie um repositório **Private**.
3. Envie o conteúdo completo da pasta `star-park`, incluindo `public/`, `docs/`, `lib/`, `scripts/` e `tests/`. O repositório deve conter o servidor e os arquivos de suporte; somente `public/` é entregue ao navegador.
4. Não envie `.env`, `data/store.json`, exportações de banco nem qualquer chave JSON de serviço.

O `.gitignore` já exclui `.env`, `data/`, `node_modules/` e nomes comuns de chaves de serviço.

## 3. Criar o serviço no Render

1. Entre em https://render.com/ e conecte o GitHub.
2. Escolha **New → Web Service** e selecione o repositório privado.
3. Configure:
   - Name: `star-park`
   - Runtime/Language: `Node`
   - Branch: `main`
   - Root Directory: vazio
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
4. Escolha uma região e um plano. O serviço precisa permanecer em uma instância por enquanto: as sessões e o rate limit desta versão ainda ficam em memória.
5. Não é necessário adicionar Persistent Disk para os dados de membros quando o Firestore estiver ativo. O cache visual local de Brawlers pode ser reconstruído.

## 4. Configurar variáveis no Render

Em **Environment → Environment Variables**, crie:

| Nome | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `STAR_PARK_STORAGE_DRIVER` | `firestore` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Conteúdo JSON completo da chave privada da conta de serviço |
| `STAR_PARK_OWNER_EMAIL` | Seu e-mail de administrador principal |
| `STAR_PARK_OWNER_PASSWORD` | Senha exclusiva com pelo menos 14 caracteres |
| `STAR_PARK_SESSION_SECRET` | Segredo aleatório longo, diferente da senha |
| `BRAWL_STARS_API_TOKEN` | Token oficial, depois de configurar a restrição de IP |
| `BRAWLER_SYNC_INTERVAL_HOURS` | `6` (catálogo visual) |
| `STAR_PARK_PLAYER_SYNC_INTERVAL_SECONDS` | `60` (intervalo-alvo entre ciclos; mínimo 30) |
| `STAR_PARK_API_MIN_REQUEST_INTERVAL_MS` | `300` (espaçamento global mínimo entre chamadas oficiais) |
| `STAR_PARK_RECRUITMENT_OPEN_ON_BOOT` | `false` |

O JSON da conta de serviço deve ser inserido inteiro em `FIREBASE_SERVICE_ACCOUNT_JSON`. Como alternativa, é possível usar `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` e `FIREBASE_PRIVATE_KEY` em três variáveis separadas. Nunca coloque o valor em `app.js`, `index.html`, `.env` commitado ou mensagens.

Gere `STAR_PARK_SESSION_SECRET` com um gerador criptográfico confiável. Em ambiente Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

O OWNER inicial será criado na primeira inicialização quando e-mail, senha e segredo estiverem configurados. Se o serviço não conseguir conectar ao Firestore, a inicialização falha em vez de voltar silenciosamente para JSON.

## 5. API oficial do Brawl Stars

1. Entre em https://developer.brawlstars.com/.
2. Crie uma API Key e verifique as exigências de IP do portal.
3. No Render, abra os detalhes do serviço → **Connect → Outbound** e consulte as faixas de IP de saída da região escolhida.
4. Autorize no portal da Supercell somente os IPs/faixas que ele aceitar e que correspondam ao serviço. O Render documenta faixas de saída compartilhadas por região e também oferece IPs dedicados como recurso pago; não presuma que a saída é um único IP fixo.
5. Cole o token em `BRAWL_STARS_API_TOKEN` no Render e faça deploy novamente.

Se a restrição de IP exigida pelo portal não puder ser atendida pelo plano/região escolhidos, mantenha a variável vazia. O catálogo visual continuará funcionando via snapshot/BrawlAPI, mas a consulta de perfis e troféus pela API oficial ficará desativada até resolver a saída IP.

## 6. Verificar o deploy

Abra o endereço `https://<nome-do-servico>.onrender.com/api/health`. A resposta deve indicar `ok: true`, `storageDriver: "firestore"` e a quantidade de Brawlers carregada. Em seguida, teste:

- login do OWNER;
- sessão e logout;
- diretório público e visibilidade de perfil;
- cadastro, aprovação e ativação de candidatura;
- cadastro e edição de membro;
- eventos, comunicados e configurações;
- auditoria e solicitações de privacidade;
- consulta de jogador, quando a API oficial estiver habilitada.

Mantenha `STAR_PARK_RECRUITMENT_OPEN_ON_BOOT=false` durante todos os testes. Só considere abrir o recrutamento depois de testar a proteção de dados e concluir a revisão de privacidade.

## 7. Dados existentes e backups

O ZIP distribuído não inclui `data/store.json`, então o banco começa sem membros/candidaturas existentes e o OWNER é criado no primeiro boot. Se você tiver um `data/store.json` de uma instalação antiga, mantenha uma cópia original e use, em ambiente Node.js com credenciais Firebase configuradas:

```bash
npm run migrate:firestore -- data/store.json
```

O ZIP atual não contém `data/store.json`, então não há dados antigos incluídos para migrar. Se houver uma instalação anterior com dados, execute a migração antes da primeira inicialização do serviço (o script interrompe a operação se encontrar dados nas coleções-alvo; não sobrescreve registros). Depois, exporte uma cópia JSON de segurança com:

```bash
npm run backup:firestore -- data/firestore-backup.json
```

Faça backups periódicos também pelas ferramentas do Google Cloud. O export JSON contém dados pessoais e hashes de senha: mantenha-o protegido, preferencialmente criptografado, e fora do GitHub e de conversas.

## Limitações conhecidas antes de crescer

- O backend carrega os registros em memória e usa transações Firestore para revalidar o estado e persistir apenas documentos alterados. Essa camada é uma ponte de compatibilidade para a lógica atual e relê as coleções nas mutações; muitas gravações podem gerar custo de leitura. Em escala maior, substitua-a por repositórios com consultas específicas por rota.
- Sessões e rate limits continuam em memória. Mantenha uma instância do Render; para escalar horizontalmente, será necessário persistir sessões e rate limits em armazenamento compartilhado.
- O Firestore Admin SDK ignora as Security Rules. Por isso, a proteção principal é manter a chave só no servidor e as rotas Node.js com autenticação, autorização e validação. As regras de negação protegem contra acesso direto de clientes, mas não substituem a segurança do backend.
- A API oficial Brawl Stars e a BrawlAPI são serviços separados. O token oficial não é necessário para o catálogo visual, mas é necessário para consultar perfis e troféus.
- Antes de receber dados reais de crianças/adolescentes, conclua a revisão LGPD: controlador, finalidade, base legal, retenção, canal de titulares, necessidade de participação dos responsáveis e acesso mínimo aos dados de contato.

## Referências oficiais

- https://firebase.google.com/docs/admin/setup/
- https://firebase.google.com/docs/firestore/quickstart-server
- https://firebase.google.com/docs/firestore/security/get-started
- https://render.com/docs/web-services
- https://render.com/docs/outbound-ip-addresses
- https://render.com/docs/dedicated-ips


## Automação pelo GitHub (v5.0.2)

O workflow `.github/workflows/star-park-release.yml` adiciona um botão em **Actions → STAR PARK — validar e publicar → Run workflow**. Primeiro executa verificações de sintaxe e todos os testes; só depois solicita o deploy do Render e aguarda o endpoint `/api/health` confirmar que a nova versão está ativa.

Antes de executar, configure no repositório:

- Secret `RENDER_DEPLOY_HOOK_URL`: deploy hook privado do serviço Web no Render.
- Variable `STAR_PARK_HEALTH_URL`: URL pública completa do endpoint `https://SEU-SITE/api/health`.

O serviço Render precisa estar com `STAR_PARK_STORAGE_DRIVER=firestore`, `BRAWL_STARS_API_TOKEN`, `STAR_PARK_SESSION_SECRET`, `STAR_PARK_OWNER_EMAIL` e `STAR_PARK_OWNER_PASSWORD` configurados em Environment. O workflow não contém nem imprime essas credenciais. A etapa de pós-deploy falha se Firestore, OWNER, chave da Supercell, versão 5.0.2, intervalo de 60 segundos, execução integral da última sincronização ou healthcheck não estiverem ativos.

A sincronização de jogadores ocorre no processo Node.js do serviço web. O intervalo de 60 segundos é a frequência-alvo entre ciclos, não uma promessa de que qualquer quantidade de membros será consultada em 60 segundos: o tempo do ciclo depende do número de jogadores, latência e limites da API. Se a API responder HTTP 429, o servidor respeita `Retry-After` (ou uma pausa de segurança) e preserva os dados anteriores.

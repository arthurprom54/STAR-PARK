# STAR PARK 5.0.0 — O que mudou

Esta versão foi preparada a partir do ZIP `star-park-site-v6.zip`.

## Preservado sem alterações visuais

- `public/index.html`
- `public/app.js`
- `public/styles.css`
- assets e snapshots locais de Brawlers

O hash dos três principais arquivos de interface foi comparado com o ZIP original e permanece idêntico.

## Alterações de backend e publicação

- Adicionado Firebase Admin SDK no backend, acionado por `STAR_PARK_STORAGE_DRIVER=firestore`.
- Criadas coleções Firestore por registro e documento `settings/main`.
- Mutação de dados passa por transações Firestore e grava apenas os documentos alterados.
- Credenciais de serviço lidas por variáveis de ambiente, nunca pelo frontend.
- Adicionado `firestore.rules` com negação de acesso direto a clientes web/mobile.
- Criados scripts para importar dados JSON legados e exportar backup JSON.
- Adicionados testes unitários com Firestore simulado.
- `NODE_ENV=production` agora exige `STAR_PARK_STORAGE_DRIVER=firestore`, evitando iniciar produção acidentalmente com armazenamento JSON.
- Adicionado `.node-version` para Node 22.
- Atualizados README e guia completo de publicação via Render/Firebase/API Brawl Stars.

## Verificação executada

- `node --check` nos arquivos JavaScript/MJS do projeto.
- `npm test`: 17 testes aprovados.
- Confirmado que o HTML, CSS e JavaScript de frontend não mudaram em relação ao ZIP original.

## O que ainda depende das contas do proprietário

- Criar o projeto Firestore e escolher a região do banco.
- Gerar a chave privada de conta de serviço e guardá-la nas variáveis secretas do Render.
- Criar conta GitHub privada e conectar o serviço Render.
- Definir e cadastrar o e-mail/senha OWNER e o segredo das sessões.
- Criar token oficial Brawl Stars e confirmar se a allowlist IP pode aceitar as faixas de saída do Render.
- Executar deploy e testar com as contas/credenciais reais.

Nenhuma senha, chave Firebase ou token Supercell foi incluído neste ZIP.

## Correção do formulário de candidatura

- Removido o bloqueio de cinco tentativas por hora do endpoint público de candidaturas. Tentativas com dados inválidos não impedem novas inscrições.
- Mantidas validações de campos, tag, faixa etária, telefone, duplicidade de candidatura e disponibilidade do Brawler.
- O telefone aceita números brasileiros com DDD sem exigir que a pessoa digite `+55`; o servidor normaliza o valor para E.164 antes de salvar.
- O campo de telefone formata automaticamente números brasileiros enquanto a pessoa digita.
- A limitação de tentativas do login administrativo e da consulta de jogadores permanece ativa.

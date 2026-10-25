# Guia de Deploy no Easypanel (VPS Própria) - DIM Platform

Este guia descreve o passo a passo completo para realizar o deploy do **DIM (Digital Influencer Management)** em uma VPS própria utilizando o [Easypanel](https://easypanel.io).

---

## 1. Visão Geral da Arquitetura

O ecossistema DIM é composto por 4 serviços principais:

1. **`dim-web`**: Frontend Next.js (App Router, Standalone build) na porta `3000`.
2. **`dim-api`**: Backend Fastify (Node.js 24) na porta `3001` com migração automática de banco.
3. **`dim-worker`**: Processador de tarefas assíncronas (BullMQ) para publicações, fluxos n8n e ingestão de mensagens.
4. **`dim-redis`**: Armazenamento em memória para filas e controle de taxa (Rate Limiting).
5. **PostgreSQL / Supabase**: Camada de persistência (já configurada via Supabase self-hosted ou PostgreSQL).

O Easypanel utiliza Docker Swarm por baixo dos panos, fornecendo automaticamente:
- Proxy reverso (Traefik) com terminação SSL gratuita e automática (Let's Encrypt).
- Isolamento de rede interna entre os containers.
- Gerenciamento de variáveis de ambiente.
- Webhooks para deploy contínuo (CI/CD) ao realizar `git push`.

---

## 2. Método Recomendado: Deploy via Docker Compose

O método mais simples e robusto para gerenciar todo o ecossistema DIM no Easypanel em um único local.

### Passo 1: Criar o Projeto no Easypanel
1. Acesse o painel web do seu Easypanel (ex: `https://easypanel.seu-servidor.com`).
2. Clique no botão **`+ New Project`** e dê o nome de `dim` (ou `digital-influencer`).

### Passo 2: Criar o Serviço Compose
1. Dentro do projeto `dim`, clique em **`+ Add Service`** e escolha **`Docker Compose`**.
2. Defina o nome do serviço como `dim-stack`.
3. Na aba **Source**:
   - Selecione **Git Repository**.
   - **Repository URL**: `https://github.com/appbigwriter/dim.git`
   - **Branch**: `main`
   - **Compose Path**: `docker-compose.yml`

### Passo 3: Configurar as Variáveis de Ambiente
1. No menu lateral do serviço, vá na aba **Environment**.
2. Copie o conteúdo do arquivo [.env.easypanel.example](file:///f:/Projetos/_FBR/DigitalInfluencer/.env.easypanel.example) e cole na área de variáveis.
3. Preencha com os seus dados reais:
   - `DATABASE_URL`: URL de conexão ao PostgreSQL do Supabase.
   - `SUPABASE_URL`: Ex: `https://supabase-control-tower-api.fbr.news`
   - `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`: Chaves do Supabase.
   - `WEB_ORIGIN`: URL pública do frontend (ex: `https://dim.seudominio.com`).
   - `AUTO_MIGRATE=true`: Para que a API execute as migrações do schema automaticamente ao inicializar.

### Passo 4: Configurar Domínios e SSL
1. No Easypanel, vá na aba **Domains** dos serviços:
   - Para o serviço `dim-web`: adicione o domínio `dim.seudominio.com` apontando para a porta `3000`.
   - (Opcional) Para a API `dim-api`: adicione `api-dim.seudominio.com` apontando para a porta `3001` se desejar acesso externo direto à API.
2. Certifique-se de que no seu DNS (ex: Cloudflare, Hostinger, Registro.br) os registros do tipo `A` dos domínios apontam para o IP da sua VPS.
3. O Easypanel gerará o certificado SSL Let's Encrypt automaticamente em poucos segundos.

### Passo 5: Deploy
1. Clique no botão **`Deploy`** no canto superior direito.
2. Acompanhe os logs da compilação e inicialização.

---

## 3. Método Alternativo: Deploy com Apps Individuais no Easypanel

Se você preferir monitorar CPU, memória e logs de cada aplicação de forma independente pela interface do Easypanel:

### 1. Criar o Serviço Redis
1. No projeto `dim`, clique em **`+ Add Service`** -> **`Redis`**.
2. Dê o nome de `dim-redis`.

### 2. Criar a API (`dim-api`)
1. Clique em **`+ Add Service`** -> **`App`**.
2. Nome: `dim-api`.
3. **Source**: Git Repository `https://github.com/appbigwriter/dim.git`, branch `main`.
4. **Build**:
   - Build Type: `Dockerfile`
   - Dockerfile Path: `infra/Dockerfile.api`
5. **Environment**:
   - `DATABASE_URL`: String de conexão ao Postgres.
   - `SUPABASE_URL`: URL do Supabase.
   - `SUPABASE_ANON_KEY`: Anon Key.
   - `REDIS_URL`: `redis://dim-redis:6379` (ou os dados do Redis criado no passo 1).
   - `AUTO_MIGRATE`: `true`
   - `PORT`: `3001`
   - `HOST`: `0.0.0.0`
6. **Domains**: Configure `api-dim.seudominio.com` apontando para a porta `3001`.

### 3. Criar o Worker (`dim-worker`)
1. Clique em **`+ Add Service`** -> **`App`**.
2. Nome: `dim-worker`.
3. **Source**: Git Repository `https://github.com/appbigwriter/dim.git`, branch `main`.
4. **Build**:
   - Build Type: `Dockerfile`
   - Dockerfile Path: `infra/Dockerfile.worker`
5. **Environment**:
   - `DATABASE_URL`: String de conexão ao Postgres.
   - `REDIS_URL`: `redis://dim-redis:6379`
   - `VAULT_ADDR` e `VAULT_TOKEN`: Configurações do Vault.
   - `N8N_URL` e `N8N_SERVICE_TOKEN`: Conector n8n.
   - Tokens das redes sociais (WhatsApp, Telegram, X).

### 4. Criar o Frontend (`dim-web`)
1. Clique em **`+ Add Service`** -> **`App`**.
2. Nome: `dim-web`.
3. **Source**: Git Repository `https://github.com/appbigwriter/dim.git`, branch `main`.
4. **Build**:
   - Build Type: `Dockerfile`
   - Dockerfile Path: `infra/Dockerfile.web`
   - Build Args:
     - `NEXT_PUBLIC_SUPABASE_URL`: `https://supabase-control-tower-api.fbr.news`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Sua chave anon
5. **Environment**:
   - `API_INTERNAL_URL`: `http://dim-api:3001` (comunicação interna na rede Docker)
   - `PORT`: `3000`
   - `HOSTNAME`: `0.0.0.0`
6. **Domains**: Configure `dim.seudominio.com` apontando para a porta `3000`.

---

## 4. Deploy Contínuo (CI/CD Automático via GitHub)

Para que cada `git push` na branch `main` realize o redeploy automático na sua VPS:

1. No Easypanel, abra a aba **Source / General** do serviço.
2. Localize o campo **Deploy Webhook** e copie a URL gerada (ex: `https://easypanel.seu-servidor.com/api/deploy/...`).
3. No GitHub:
   - Vá no seu repositório: `https://github.com/appbigwriter/dim`
   - Clique em **Settings** -> **Webhooks** -> **Add webhook**.
   - No campo **Payload URL**, cole a URL do webhook do Easypanel.
   - **Content type**: `application/json`.
   - **Which events**: Selecione *Just the push event*.
   - Clique em **Add webhook**.

A partir de agora, qualquer commit enviado para o repositório disparará o build e deploy automático na VPS!

---

## 5. Bootstrap Inicial (Criar Primeiro Usuário e Organização)

Após o primeiro deploy com a API em execução e as tabelas criadas (`AUTO_MIGRATE=true`):

1. Crie o primeiro usuário no Supabase Auth (via Dashboard do Supabase ou cadastro) e copie o `UUID` do usuário.
2. Na VPS ou pelo Easypanel (aba **Console** do serviço `dim-api`):
   ```bash
   BOOTSTRAP_USER_ID="UUID_DO_SEU_USUARIO" \
   BOOTSTRAP_ORG_NAME="Minha Organizacao" \
   BOOTSTRAP_ORG_SLUG="minha-org" \
   node --import tsx scripts/bootstrap.ts
   ```
3. O script criará a organização inicial no schema `custom_dim`, atribuirá permissões administrativas ao usuário e concluirá o setup.

---

## 6. Verificação de Saúde e Monitoramento

- **Healthcheck da API**: `https://api-dim.seudominio.com/health/ready` (retorna JSON com status de banco e Redis).
- **Healthcheck do Frontend**: `https://dim.seudominio.com/health` (retorna `{"status":"ok"}`).
- **Logs**: No Easypanel, clique na aba **Logs** de qualquer serviço para ver saídas em tempo real do Node.js, erros de workers ou requisições HTTP.

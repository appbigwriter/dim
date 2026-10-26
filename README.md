# DIM — Digital Influencer Management

Implementação local do PRD e do plano S00–S09 em `prd/`. Monorepo TypeScript: Next.js 16 / React 19 / Tailwind 4, API Fastify 5, PostgreSQL no schema `custom_dim`, Supabase Auth/Storage, worker BullMQ/Redis, adaptadores de cofre e conectores oficiais.

**Estado de entrega:** aplicação compilável e fluxos principais verificados localmente. Homologação, infraestrutura remota e integrações reais permanecem nos gates descritos em [docs/implementation-status.md](docs/implementation-status.md). A existência de código não representa aprovação dos gates de produção.

Audience Builder gere persona/autoridade/blog; DIM executa as ações aprovadas com revisão e direitos locais. A rodada atual acrescenta execução contínua separada, receipts duráveis, WordPress via Audience, Facebook/Instagram/YouTube, respostas Resend, Inbox/privacidade e comparação de mídia. Configuração e limites por canal: [integração Audience](docs/audience-integration.md), [cobertura dos nove canais](docs/channel-coverage.md).

## Preparar o ambiente

Requer Node 24, PostgreSQL/Supabase compatível, Redis e credenciais do ambiente. O repositório não contém segredos. No PowerShell, na raiz:

```powershell
npm ci
Copy-Item .env.example .env
# Preencher .env pelo gerenciador de segredos do ambiente.
npm run db:migrate
# Usuário já existente no Supabase Auth:
$env:BOOTSTRAP_USER_ID = '<UUID do administrador>'
$env:BOOTSTRAP_ORG_NAME = '<nome confirmado>'
$env:BOOTSTRAP_ORG_SLUG = '<slug confirmado>'
npm run db:bootstrap
npm run dev
```

Frontend: `http://localhost:3000`. API: `http://127.0.0.1:3001`. Execute `npm run worker` em outro terminal. Cadastre MFA pelo login antes de operar como administrador. Os placeholders acima devem ser substituídos por valores confirmados.

`npm run db:migrate` deve ser executado com um papel de migration autorizado. A aplicação usa transações com `SET LOCAL ROLE dim_app` para os comandos de domínio e contexto de tenant. O papel da conexão precisa conseguir assumir `dim_app` e ler os dados de Auth/membership usados pela autenticação. Consulte as limitações desse modelo no runbook.

O Supabase e o n8n centrais existentes não são duplicados. O Compose em `infra/` sobe somente os componentes DIM e Redis, a ser adaptado à rede real do Easypanel.

## Verificar

```powershell
npm run check
npm run openapi
npm run test:load
docker compose -f infra/compose.yaml config --quiet
```

Os testes de banco usam PostgreSQL WASM (PGlite) com fixtures locais de `auth.users` e papéis Supabase. Somente a extensão `pgcrypto` é omitida no harness porque `gen_random_uuid` já está disponível. As migrations entregues não são modificadas pelo teste. RLS, FKs, triggers e transações são executados, não simulados. Isso não substitui os testes no Supabase Self-Hosted da organização.

## Conteúdo

| Diretório | Responsabilidade |
| --- | --- |
| `apps/web` | Dashboard, formulários, wizard, Studio, calendário, Inbox, governança e comercial |
| `apps/api` | API versionada, sessão, RBAC, validação, comandos e OpenAPI |
| `apps/worker` | Outbox, filas, publicação, respostas e execução n8n |
| `packages/core` | Regras de identidade, direitos, aprovação, escopo, consentimento e custos |
| `packages/contracts` | Validação e contratos TypeScript/Zod |
| `packages/db` | Conexão, migrations com checksum, catálogo e bootstrap |
| `packages/connectors` | Vault KV v2, OAuth X PKCE, Telegram, WhatsApp e Storage/ClamAV |
| `packages/ui` | Componentes compartilhados de estado, erro e métricas |
| `supabase/migrations` | Fonte versionada das três migrations; cópia idêntica em `packages/db/migrations` |
| `n8n/workflows` | 12 workflows importáveis e desativados; configuração descrita no runbook |
| `infra` | Containers, rede privada, inventário, backup, restore e alertas |
| `tests` | Casos de API/domínio/segurança/integração e recuperação |

Documentação: [runbook](docs/runbook.md), [status das 40 Stories](docs/implementation-status.md), [arquitetura e decisões](docs/architecture.md), [OpenAPI](docs/openapi.json), [carga](docs/load-report.json), [recuperação local](docs/recovery-report.json), [QA da interface](docs/ui-qa.md).

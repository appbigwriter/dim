# DIM Platform — Product Requirements Document (PRD)

**Versão:** 1.0 — especificação funcional e técnica inicial  
**Data:** 24/10/2026  
**Status:** baseline para implementação e revisão de infraestrutura  
**Produto:** Digital Influencer Management Platform (DIM)  
**Fonte funcional:** Projeto Conceitual DIM v2.0, estabelecido nesta conversa  
**Infraestrutura confirmada:** VPS própria; Easypanel; Supabase Self-Hosted; n8n central  
**Pendência importante:** `F:\Projetos\_FBR\DigitalInfluencer\dim-dev-doc.md` não estava disponível nesta sessão. Domínios, recursos, rede, paths, volumes, instâncias e serviços já implantados NÃO foram presumidos.

---

## 1. Visão do produto, objetivos e escopo

### 1.1. Problema
Uma rede de influenciadores humanos, virtuais e híbridos demanda controle de identidades, contratos, canais, permissões, produção editorial, publicação, mensagens, custos e receita. A dispersão em ferramentas isoladas cria perda de rastreabilidade, credenciais compartilhadas, riscos de titularidade e dificuldade de escala.

### 1.2. Solução
Um núcleo administrativo multi-organização e multicanal com Identity Manager, governança, provisionamento assistido, Content Studio com agentes de IA, calendário editorial, publicação com conectores oficiais, Inbox, Analytics e monetização. Uma identidade virtual **não é** uma conta pessoal falsa; sua representação pública deve ser transparente. Cadastro em plataformas externas não será automatizado por robôs que contornem verificações.

### 1.3. Perfis e tarefas
| Perfil | Tarefa principal | Restrições |
|---|---|---|
| Super Admin | Administrar serviço, políticas e emergência | MFA, dupla confirmação em ações críticas |
| Admin da Organização | Configurar equipe, influenciadores e canais | Apenas organização atribuída |
| Identity Manager | Cadastrar identidade e provisionar ativos | Sem publicação automática irrestrita |
| Diretor Editorial | Aprovar políticas e conteúdo | Sem acesso a credenciais |
| Editor/Social Media | Produzir, revisar, agendar | Escopo de influenciadores/canais |
| Comercial | Gerenciar campanhas, receitas e custos | Sem editar contratos de identidade sem permissão |
| Atendimento | Responder e encaminhar conversas | Consentimento, escopo, retenção |
| Influenciador humano | Ver materiais, aprovar e operar conforme contrato | Acesso apenas aos seus ativos autorizados |
| Auditor | Consultar trilhas e evidências | Somente leitura |
| Agente de IA | Pesquisar/gerar/sugerir por workflow | Nunca recebe token proprietário ou papel administrador |

### 1.4. Prioridades
- **P0 — mínimo seguro:** Auth, MFA administrativo, organização, RBAC, Identity Manager, contratos, contas e inventário, auditoria, onboarding, storage privado, jobs.
- **P1 — MVP operacional:** persona, editor e versões, revisão e calendário, integração com blog/e-mail e ao menos um conector social aprovado, n8n e métricas básicas.
- **P2 — expansão:** Inbox WhatsApp/Telegram, analytics ampliado, campanhas e monetização, agentes especializados.
- **P3 — escala:** automação assistida avançada, dashboards comparativos, novos conectores, infraestrutura separada.

### 1.5. Fora do escopo inicial
Automação de registro social por simulação de usuário; compra de contas, números descartáveis ou proxies de evasão; bots de likes/follows ou comentários coordenados; monetização garantida; clonagem de identidade humana sem autorização; promessas de publicação em APIs sem permissão contratada.

## 2. Arquitetura geral do sistema

### 2.1. Componentes
- **DIM Web:** Next.js + TypeScript + Tailwind, SSR onde conveniente, i18n PT-BR/EN/ES, componentes reutilizáveis, formulários validados.
- **DIM API:** backend TypeScript modular, aplicação das políticas, auditoria e orquestração de comandos; a autorização definitiva não reside no n8n.
- **Supabase Self-Hosted:** PostgreSQL, Auth e Storage; RLS e segregação por organização. Chave administrativa apenas no servidor.
- **Redis + Workers:** BullMQ para jobs transacionais e de publicação com chave de idempotência, retries limitados, DLQ e backpressure.
- **n8n central:** fluxos empresariais longos, geração e análise, acionado por comandos assinados/serviço autenticado.
- **Connectors:** adaptadores versionados Meta, X, Telegram, WhatsApp, CMS e e-mail; cada um publica um manifesto de capacidades.
- **Vault/Secrets:** tokens OAuth/API e segredos com referência lógica em DB; proibir material em texto claro em logs e tabelas.
- **Telemetry:** logs estruturados, correlation_id, métricas e alertas.

### 2.2. Contextos de domínio
`organizations`, `identity`, `governance`, `channels`, `editorial`, `automation`, `inbox`, `commercial`, `analytics`, `security`. Cada domínio expõe serviço, modelos, endpoints e eventos; acesso entre domínios via API de aplicação/eventos, não CRUD arbitrário em tabelas alheias.

### 2.3. Padrão de transação/evento
**Comando UI → sessão Supabase Auth → DIM API → checagem organização/escopo → validação → transação PostgreSQL + outbox → consumidor → workflow/job → conector → resultado → audit log/telemetria.**
Eventos devem ter `event_id`, `event_type`, `organization_id`, `aggregate_id`, `correlation_id`, `payload_version`, `occurred_at`, `processed_at`; entrega no mínimo uma vez com consumidores idempotentes.

### 2.4. Dashboard principal `UI-002 /dashboard`
Widgets: identidades ativas/pendentes, canais conectados/com problema, aprovações pendentes, publicações hoje/próximas, falhas jobs, Inbox não lida, custos IA, desempenho resumido. Filtros organização, influenciador, status, período. Cada KPI exibe origem e hora da última atualização. Drilldown conduz a módulo relevante. Loading/skeleton, vazio, erro, permissão insuficiente e sincronização atrasada são estados obrigatórios.

## 3. Governança de humanos, virtuais e híbridos

### 3.1. Regras
- `human`: cadastro privado e contrato de representação com especificação de titularidade, canais, direitos de imagem/voz, aprovações, prazo e saída.
- `virtual`: marca/personagem e Bíblia de Identidade versionada, direitos de ativos, declaração transparente de natureza sintética, regras de continuidade e comportamento.
- `hybrid`: regras de humano + permissões específicas para avatar, imagem e voz sintéticas.
- Cada identidade deve ter responsável humano interno; ações de IA registram solicitante técnico e proprietário responsável.
- Revogação de autorização paralisa trabalhos que dependam dela; não apaga automaticamente provas ou registros sujeitos à retenção legal.

### 3.2. Telas
`GOV-001 /influencers/:id/governance` checklist de documentos, autorizações, titularidade e risco. `GOV-002 /influencers/:id/contracts` versões, validade, anexos e assinatura externa (se integrar). `GOV-003 /influencers/:id/persona` editor da Bíblia: voz, valores, limites, expertise, público, histórias permitidas, fatos canônicos. `GOV-004 /influencers/:id/assets` referências de aparência/voz e licenças. `GOV-005 /influencers/:id/disclosures` divulgação de IA e publicidade por plataforma. `GOV-006 /influencers/:id/offboarding` assistente de desvinculação e retenção.

### 3.3. Campos-chave
Contrato: `contract_type`, `owner_party_id`, `start_at`, `end_at`, `asset_scope[]`, `territory`, `channel_scope[]`, `approval_policy_id`, `storage_object_id`, `status`. Consentimento: `subject_id`, `use_type`, `scope`, `evidence`, `granted_at`, `expires_at`, `revoked_at`. Persona: `version`, `public_bio`, `tone`, `traits`, `allowed_topics`, `restricted_topics`, `canon`, `disclosure_policy`, `approval_status`.

### 3.4. Aceite
**GOV-AC-01:** humano sem contrato obrigatório não transita para `approved`. **GOV-AC-02:** atualização de voz/aparência aprovada produz versão nova. **GOV-AC-03:** material gerado para virtual recebe informações de transparência configuradas e avaliadas antes de publicação. **GOV-AC-04:** desligamento interrompe agendamentos e revoga integrações conforme titularidade e contrato.

## 4. Matriz de criação e administração das contas

### 4.1. Tipos e capacidades
`platforms` contém serviços; `social_accounts` contém recursos concretos (Página Facebook, perfil Instagram, perfil X, número WhatsApp, bot/canal Telegram, blog e e-mail). Cada conta possui `account_status` e `integration_status` independentes. Capacidades `read_profile`, `publish_text`, `publish_media`, `read_metrics`, `read_messages`, `send_messages`, `moderate` são determinadas por integração real, escopo, conta e permissão.

### 4.2. Processo `ACC-WF-01`
Criar solicitação → definir provedor/tipo → exibir requisitos → atribuir operador → cadastro manual oficial ou provisionamento administrativo legítimo (CMS/e-mail) → salvar handle e ID externo → OAuth/autorização oficial → validação do callback e escopos → teste não destrutivo → atribuição de permissões → status ativo. Erros de cadastro ou rejeição de plataforma ficam documentados como tarefa humana.

### 4.3. Telas
`ACC-001 /accounts`: tabela/filtros, plataforma, influenciador, titular, estado, validade de token, ações. `ACC-002 /accounts/:id`: abas Resumo, Integração, Capacidades, Permissões, Publicações, Segurança. `ACC-003 /accounts/new`: wizard. `ACC-004 /accounts/:id/health`: histórico de verificações. `ACC-005 /connectors`: catálogo e configuração administrativa.

### 4.4. Campos e validação
`influencer_id` obrigatório, `platform_id` obrigatório, `account_type` enum do manifesto, `external_id` único no escopo de plataforma/instância onde aplicável, `handle` com validação específica, `public_url` normalizada, `owner_reference`, `recovery_owner_id`, `status`; conexão com `grant_scope[]`, `expires_at`, `secret_ref`, `last_tested_at`, `health`. Nunca armazenar senha da rede social em campo normal de formulário.

### 4.5. Aceite
Conta sem autorização não publica; token expirado gera `integration_expired`; conector indisponível não afeta os demais; teste e reconexão registram auditoria; nenhuma ação externa é oferecida na UI sem capacidade validada.

## 5. Governança corporativa e segurança

### 5.1. Permissões
Formato `domain.resource.action`, atribuição `role_assignments` por organização, influenciador ou conta; permissões administrativas sensíveis exigem MFA e, quando definido em política, segunda aprovação. Backend confere sessão, membership, role e resource scope; RLS é defesa adicional. Não confiar em `organization_id` fornecido isoladamente pelo cliente.

### 5.2. Telas
`SEC-001 /settings/users` convites, revogação, último acesso; `SEC-002 /settings/roles` matriz granular; `SEC-003 /settings/teams` escopos; `SEC-004 /security/audit` pesquisa por ator, recurso, data e correlação; `SEC-005 /security/incidents` triagem, severidade e ações; `SEC-006 /security/sessions` sessões e revogação; `SEC-007 /settings/policies` regras de aprovação e retenção.

### 5.3. Formulários
Convite: e-mail, role, organization, influencer/account scope, expiry. Permissão excepcional: ação, recurso, justificativa, aprovador, vencimento. Incidente: categoria, severidade, afetados, evidência, mitigação, status. Política: escopo, condições, aprovações, versão, vigência.

### 5.4. Aceite
Teste cross-tenant em endpoints e Storage retorna 403/404 sem vazamento; revogação impede ações novas imediatamente dentro do modelo de sessão definido; alteração de role e credencial deixa log de auditoria imutável para usuário comum; serviços não usam role de Super Admin.

## 6. Identity Manager

### 6.1. Rotas
`ID-001 /influencers` diretório com tabela/cards, busca e filtros. `ID-002 /influencers/new` onboarding. `ID-003 /influencers/:id` resumo. Abas `profile`, `persona`, `media`, `channels`, `editorial`, `agents`, `inbox`, `commercial`, `governance`, `history`. `ID-004 /influencers/:id/status` status e bloqueadores. `ID-005 /influencers/:id/versions` diff e rollback de persona.

### 6.2. Formulário de identidade
**A. Básico:** `public_name*`, `internal_name*`, `slug*` (único por organização), `type*`, `primary_language*`, `timezone*`, país, nicho, tags, gestor. **B. Posicionamento:** objetivo, audiência, valores, diferencial, temas aprovados e vedados. **C. Visual:** avatar, banner, paleta, tipografia, variantes, licença. **D. Operação:** editor, equipe, canais pretendidos, frequência, política de aprovação, teto orçamentário. **E. Agentes:** idioma, modelo/fallback, estilo, base de conhecimento, limites e aprovação. Validação de obrigatoriedade varia por `type`.

### 6.3. Estados
`draft → under_review → approved → provisioning → ready → active`; desvios `changes_required`, `paused`, `restricted`, `offboarding`, `archived`. Somente backend efetua transições após checagem de guardas e registro em `influencer_status_history`.

### 6.4. Requisitos
Autosave com versionamento, validação por etapa, upload com AV e restrições MIME, prévia de bio por rede, detecção de conflito de slug/handle, exportação da ficha com dados sujeitos a permissão, histórico comparável, nenhuma exclusão física de identidade ativa por simples clique.

## 7. Automação editorial e agentes

### 7.1. Modelo
Agentes: Pesquisador, Estrategista, Redator, Adaptador, Mídia, Verificador, Compliance, Publicador e Analista. Definição reutilizável `agent_definitions`; instância/configuração por influenciador `agent_assignments`; ferramenta permitida por política e execução. Agentes não podem consultar credenciais externas ou aprovar as próprias publicações de alto risco.

### 7.2. Telas
`ED-001 /editorial/topics` pautas e fontes; `ED-002 /studio/new` briefing; `ED-003 /studio/:id` editor multimodal, versões, fontes, custos e avisos; `ED-004 /editorial/calendar` dia/semana/mês, filtros e reagendamento; `ED-005 /approvals` fila e diff; `ED-006 /publications` jobs, tentativas e destino; `ED-007 /agents` configuração; `ED-008 /agents/runs` execução, custo, incidentes e output; `ED-009 /media` biblioteca licenciada.

### 7.3. Briefing
Influenciador, objetivo, tipo, tema, canal, idioma, público, palavras-chave, fontes, fatos obrigatórios, CTA, campanha, data, orçamento, estilo, limite de autonomia. A submissão cria item `idea` e trabalho assíncrono.

### 7.4. Pipeline
`idea → researching → drafting → review_required → approved → scheduled → publishing → published`, alternativas `changes_requested`, `rejected`, `blocked`, `failed`, `cancelled`. Aprovação vinculada a `content_version_id` + hash de payload e política. Alteração substancial cancela a validade de aprovação anterior. Distribuição exige a versão exata aprovada e permite versões específicas por rede, sem crossposting repetitivo artificial.

### 7.5. Workflows n8n a especificar em JSON no PRD de execução
| Código | Entrada | Saída | Falha crítica |
|---|---|---|---|
| `identity.onboard` | identity id, scope | tarefas criadas | bloquear ativação |
| `identity.audit` | identity id | relatório políticas | criar incidente |
| `content.research` | brief id | fontes e notas | revisão humana |
| `content.generate` | brief/persona versions | draft/version | preservar erro/custo |
| `content.verify` | content version | flags/referências | bloquear publicação |
| `content.approve` | version/policy | requests/status | bloquear se pendente |
| `social.publish` | approved job | external ID/status | retry/DLQ |
| `social.metrics` | external post ID | metric samples | estado stale |
| `inbox.triage` | conversation id | categoria/sugestão | encaminhar humano |
| `campaign.track` | campaign id | custo/receita | alertar reconciliação |
| `security.monitor` | health/audit event | incidente/alerta | escalar |
| `identity.offboard` | influencer id | tarefas revogação | bloqueio cautelar |

### 7.6. Requisitos de jobs
Transporte com retries exponenciais e jitter; limites por provedor e conta; circuit breaker; timeout; DLQ; validação just-in-time da autorização; idempotency_key por destino+versão+ação; respostas externas registradas com dados sensíveis removidos; execução agendada respeita timezone da identidade e DST. Se publicação tiver resultado incerto, consultar estado externo antes de reenviar quando API permitir.

## 8. WhatsApp, Telegram e relacionamento

### 8.1. Inbox
`CRM-001 /inbox` três painéis: lista, conversa e ficha de contato. Filtros influenciador, canal, responsável, não lida, tags, SLA. Ações: responder, sugestão IA, nota interna, atribuir, escalar, encerrar, opt-out, exportação autorizada. `CRM-002 /contacts` busca e desduplicação manual; `CRM-003 /contacts/:id` identidades, consentimento, histórico; `CRM-004 /inbox/rules` automações; `CRM-005 /templates` templates por canal e status.

### 8.2. WhatsApp
Priorizar WhatsApp Business Platform oficial, número elegível, webhooks validados, opt-in por finalidade, templates/limites dinâmicos e escalonamento humano. Não presumir que API de WhatsApp comum reproduza recursos da Business Platform.

### 8.3. Telegram
Separar usuário, canal, grupo e bot. Bot opera por Bot API e permissões explícitas; não representar bot como conta humana; tratar comandos, chats, moderação e publicação em canais autorizados.

### 8.4. Dados e fluxo
Webhook → validação de assinatura/segredo → `webhook_events` com dedupe → normalização → canal/contato/consentimento → `conversations`/`messages` → triagem → humano ou sugestão de IA → resposta pela API permitida → status de entrega. Conteúdo recebido é não confiável: proteção contra prompt injection e nunca transformar mensagem em comando administrativo.

### 8.5. Aceite
Webhook duplicado não duplica mensagens; opt-out impede novos envios de marketing; atendimento identifica canal e influenciador; operador sem permissão não vê dados; conversa pode ser transferida e auditada; regras de template e janela são configuráveis por provedor.

## 9. Stack, operações e deploy em VPS/Easypanel

### 9.1. Contratos de implantação
Serviços lógicos: `dim-web`, `dim-api`, `dim-worker`, `dim-redis`, `dim-n8n` (central ou compartilhado), `dim-supabase` (stack oficial verificada), `dim-monitor`, `dim-backup`. Não implantar duplicatas do n8n ou Supabase existente antes de conferir `dim-dev-doc.md`. Ports, networks, volume paths, domínio, certificados, recursos CPU/RAM/disco e imagem exata permanecem **TBD-ENV**.

### 9.2. Supabase
Usar Compose oficial versionado e adequar Easypanel após revisão; Auth e Storage com endpoints corretos e SMTP configurado; migrations sequenciais, seeds sem segredos; schemas `public`, `private`, `ops`, `analytics`; RLS nas tabelas expostas; schemas privados fora da API pública; chave service-role somente API/worker protegido. Backups de banco **não substituem** backup de objetos Storage.

### 9.3. Operação e segurança
Acesso externo somente HTTPS e webhooks necessários. DB, Redis, Studio e painel n8n não públicos; preferir VPN/admin proxy/SSO. Credenciais em vault; backup criptografado fora da VPS; teste de restore regular; coleta métricas de disco, IOPS, RAM, conexões, filas e latência. Separar ambientes dev/staging/prod e nunca usar tokens de produção em staging.

### 9.4. Health, RPO/RTO e escala
Endpoints `/health/live`, `/health/ready`, `/health/dependencies`; workers com liveness e parada graciosa; monitor de jobs stuck. Objetivos propostos a validar: disponibilidade app 99,5%, RPO inicial 24h, RTO 8h. Uma VPS é single point of failure; metas dependem de backup remoto e capacidade real de restaurar. Teste de carga com cenários de 10, 50 e 100 influenciadores e volume de jobs/mídia definido por estimativa observada, não pela contagem isolada.

### 9.5. CI/CD
Git → lint/testes/unitários → SAST/dependency scan → build imutável → staging → testes DB + RLS + e2e → aprovação → produção → smoke tests → rollback de aplicação. Alterações de schema com estratégia expand/contract e plano de reversão.

### 9.6. Checklist `dim-dev-doc.md` a incorporar antes do deploy
Hostname/IP da VPS, distro, dimensões, domínio/subdomínios, projeto Easypanel, serviços/versões existentes, redes, portas, volumes, localização do Compose, endpoints do Supabase, SMTP, estratégia TLS, caminhos do storage, N8N URL, Redis, monitoração, backups externos, política de segredos, DNS e restrições. **Não inserir valores fictícios nesses campos.**

## 10. Onboarding completo de um influenciador

### 10.1. Wizard `ONB-001 /influencers/new`
1. **Identidade:** tipo, nome, slug, nicho, idioma, responsáveis.
2. **Persona e direitos:** humano: contrato; virtual: Bíblia/proveniência; híbrido: ambos.
3. **Aprovação:** validações, bloqueadores e decisão.
4. **Infraestrutura:** e-mail, site, mídia, equipe e armazenamento.
5. **Contas sociais:** canais desejados, tarefas manuais, OAuth.
6. **Editorial:** agent config, política, calendário, orçamento.
7. **Testes:** Auth, permissões, API, storage, job teste autorizado, logs.
8. **Ativação:** checklist fechado e responsável confirma.

Interface com progress bar, autosave, botão voltar, tarefas atribuídas, estado de erro recuperável, conclusão parcial e retomada. Cada etapa grava `onboarding_steps`; falha de um conector nunca apaga o cadastro já criado.

### 10.2. Guardas da ativação
Identidade aprovada, titular e editor identificados, direitos válidos, pelo menos um canal operacional conforme plano, MFA de administradores, política editorial aprovada, conectores testados e ausência de bloqueador crítico.

### 10.3. Offboarding
Suspender novos jobs imediatamente → inventariar posts agendados e mensagens → validar contrato/titularidade → revogar permissões e tokens de equipe → decidir transferência/arquivo das contas → preservar registros obrigatórios → gerar relatório final.

## 11. Catálogo de dados relacional — baseline para migrations

**Convenções:** PK `uuid`, `id` por padrão; timestamps `timestamptz` UTC; colunas `created_at`, `updated_at` em tabelas mutáveis; FKs indexadas; `organization_id` nas entidades multi-tenant; `jsonb` somente para atributos dinâmicos controlados; índices parciais para registros ativos. Referenciar `auth.users(id)` via perfil sem duplicar senha. `social_account` deve referenciar uma plataforma e identidade. Não armazenar tokens em DB; apenas `secret_ref`.

| Domínio | Tabelas essenciais e relações |
|---|---|
| Tenant | `organizations`, `organization_members`, `organization_settings`, `user_profiles` |
| RBAC | `roles`, `permissions`, `role_permissions`, `role_assignments`, `teams`, `team_members` |
| Identidade | `influencers`, `influencer_profiles`, `influencer_personas`, `persona_canon`, `influencer_languages`, `influencer_assignments`, `influencer_status_history`, `influencer_goals` |
| Direitos | `legal_parties`, `influencer_contracts`, `identity_consents`, `identity_assets`, `identity_disclosures`, `media_licenses` |
| Contas | `platforms`, `connectors`, `social_accounts`, `account_integrations`, `account_capabilities`, `account_permissions`, `account_provisioning_tasks`, `account_health_checks` |
| Onboarding | `onboarding_sessions`, `onboarding_steps`, `onboarding_tasks`, `onboarding_approvals`, `onboarding_events` |
| IA | `agent_definitions`, `agent_assignments`, `ai_model_configs`, `knowledge_sources`, `agent_runs` |
| Editorial | `editorial_topics`, `content_items`, `content_versions`, `content_sources`, `content_assets`, `content_approvals`, `editorial_calendar_items` |
| Distribuição | `publication_jobs`, `publication_attempts`, `published_posts`, `publication_metrics` |
| Conversas | `contacts`, `contact_identities`, `contact_influencers`, `consent_records`, `conversations`, `messages`, `message_attachments`, `conversation_assignments`, `conversation_notes`, `automated_response_rules`, `message_templates`, `webhook_events` |
| Comercial | `campaigns`, `campaign_influencers`, `partners`, `campaign_deliverables`, `revenue_events`, `cost_events` |
| Operações | `system_events`, `outbox_events`, `notifications`, `audit_logs`, `security_incidents`, `operation_jobs`, `storage_objects` |

### 11.1. Chaves, índices e restrições explícitas
- `organizations.slug UNIQUE`.
- `influencers UNIQUE (organization_id, slug)`; `CHECK type IN ('human','virtual','hybrid')`.
- `organization_members UNIQUE (organization_id, user_id)` para membership ativa (índice parcial se houver histórico).
- `social_accounts UNIQUE (platform_id, external_id)` quando não nulo e no escopo correto do provedor; checar caso de contas compartilhadas e se ID é global.
- `account_integrations`: mais de uma autorização histórica pode existir; uma conexão ativa por conta/tipo mediante índice parcial.
- `content_versions UNIQUE (content_id, version_number, language, format)`.
- `publication_jobs UNIQUE (organization_id, idempotency_key)`.
- `webhook_events UNIQUE (provider, event_id)` quando provedor garante ID; fallback hash com TTL/estratégia documentada.
- `audit_logs`: append-only via permissões de DB, sem UPDATE/DELETE pelo app; eventos sensíveis mascarados.
- `consent_records` preserva concessões/revogações e prova, sem sobrescrever histórico.
- Todos os FKs organizacionais devem ser verificados para evitar referência cruzada de tenant (FK composta quando adequada e validação na API).

### 11.2. RLS
Políticas por `organization_id` derivado do usuário autenticado e `organization_members`; regras adicionais por `influencer_id`/conta e função. Somente funções elevadas no backend acessarão `private`/`ops`, com segregação de credenciais. `storage.objects` com políticas por path sem confiar em nome do arquivo. SQL detalhado virá em migrations `0001..N` após conferir versão e configuração real do Supabase e fechar modelagem de dados.

### 11.3. Retenção e privacidade
Política configurável por tipo de dado; contatos e mensagens com fundamento, consentimento quando exigido e solicitações do titular; logs sem material de autenticação; contratos e consentimentos com acesso seletivo e prazo legal aplicável. Registros financeiros vinculados ao período e jurisdição apropriados.

## 12. Contratos de API — baseline

Base versionada `/api/v1`; erros comuns `{code, message, details?, correlation_id}`; paginação cursor ou page/per_page padronizada, limites, sorting e `ETag`/versionamento quando necessário. Mutations externas exigem `Idempotency-Key`.

| Endpoint | Métodos | Escopo / comportamento |
|---|---|---|
| `/organizations` | GET, POST | listagem e criação autorizadas |
| `/organizations/:id/members` | GET, POST, PATCH, DELETE | convites, roles e revogações |
| `/influencers` | GET, POST | listagem e draft |
| `/influencers/:id` | GET, PATCH | detalhe, controle de versão |
| `/influencers/:id/transition` | POST | transição validada de estado |
| `/influencers/:id/personas` | GET, POST | versões da Bíblia |
| `/influencers/:id/contracts` | GET, POST | contratos e direitos |
| `/accounts` | GET, POST | inventário e solicitação |
| `/accounts/:id/connect` | POST | início de autorização oficial |
| `/integrations/callback/:provider` | GET/POST | OAuth oficial, state/PKCE/csrf |
| `/accounts/:id/capabilities` | GET | capacidades verificadas |
| `/contents` | GET, POST | pautas/conteúdo |
| `/contents/:id/versions` | GET, POST | versões imutáveis |
| `/contents/:id/approvals` | POST | aprovação/rejeição versionada |
| `/publications` | GET, POST | agendar publicação autorizada |
| `/publications/:id/cancel` | POST | cancela se possível |
| `/agent-runs` | GET, POST | comando idempotente, status |
| `/conversations` | GET | Inbox com escopo |
| `/conversations/:id/messages` | GET, POST | leitura/envio autorizado |
| `/consents` | GET, POST | provas/retirada |
| `/webhooks/:provider` | POST | assinatura, dedupe, confirmação rápida |
| `/analytics/overview` | GET | agregado e frescor |
| `/audit` | GET | auditoria permissionada |
| `/health/live`, `/health/ready` | GET | sinais operacionais sem segredos |

Documentar cada endpoint em OpenAPI 3.1 com schema de request/response, códigos 400/401/403/404/409/422/429/5xx, limites e testes de tenant.

## 13. Telas e componentes compartilhados

### 13.1. Navegação
Sidebar por domínio; seletor organização/influenciador; breadcrumbs; Command Search; alerts; usuário. Recursos em desktop e mobile-first. Suporte PT-BR, EN e ES; timezone nos horários, indicação de horário agendado e UTC interno.

### 13.2. Design system funcional
`Button`, `Input`, `Select`, `Combobox`, `Textarea`, `MultiSelect`, `Upload`, `DataTable`, `FilterBar`, `StatusChip`, `Timeline`, `ActivityLog`, `PermissionGate`, `ApprovalPanel`, `VersionDiff`, `ConfirmDialog`, `FormWizard`, `AsyncJobMonitor`, `FilePreview`, `RichEditor`, `MediaPicker`, `CostIndicator`, `AuditDrawer`, `ErrorBanner`. Layout responsivo, WCAG 2.2 AA como meta e confirmação de ações destrutivas.

### 13.3. Estados universais
`loading`, `empty`, `error`, `permission_denied`, `offline/connection_lost`, `partial_sync`, `stale`, `success`, `blocked`, `pending_approval`. Erros mantêm contexto, oferecem retry seguro e exibem correlation ID para suporte.

## 14. Qualidade, segurança e definição de pronto

### 14.1. Testes mandatórios
- Unitários: guardas de transição, RBAC, validação, cálculo de métricas/custos.
- Integração: banco/migrations/RLS, callbacks OAuth simulados, dedupe de webhook, filas, outbox e storage.
- E2E: criar humano/virtual/híbrido, aprovar, vincular conta de teste, gerar, revisar, agendar e acompanhar falha/êxito.
- Segurança: cross-tenant, IDOR, SSRF em fontes de pesquisa, XSS em conteúdo, CSRF, replay de webhook, prompt injection, secrets leakage.
- Resiliência: API externa 429/5xx, token revogado, job duplicado, n8n offline, Redis temporariamente offline, media inválida.
- Infra: restauração de PostgreSQL **e Storage**, deploy e rollback, teste de controle de redes.

### 14.2. Critérios globais
1. Criar organização e membro com MFA privilegiado.
2. Cadastrar 3 tipos de identidade com documentos corretos.
3. Bloquear ativação sem requisitos de direitos e aprovação.
4. Vincular conta por processo legítimo, armazenando escopos e segredo em cofre.
5. Impedir publicação sem versão exata aprovada.
6. Publicar via ao menos um conector de testes autorizado, com ID externo e auditoria.
7. Evitar duplicidade em retry.
8. Suspender uma identidade sem afetar outra.
9. Enxergar custos e falhas por influenciador.
10. Registrar mensagens/consentimentos no módulo habilitado.
11. Bloquear acesso cross-tenant em API e Storage.
12. Restaurar dados e mídias de backup em staging.

### 14.3. Métricas de lançamento
Metas propostas, não fatos de infraestrutura: p95 API comum <800ms (sem terceiros), 99,5% de disponibilidade do app, dashboards marcando frescor das fontes, backlog de jobs visível, zero segredos em logs, 100% dos jobs externos rastreáveis. Definir carga concreta na homologação.

## 15. Roadmap por entregas, dependências e gates

| Fase | Entregáveis | Dependências | Gate de conclusão |
|---|---|---|---|
| 0 Infra | Compose verificado, rede, Auth, DB, Storage, backup, monitor | `dim-dev-doc.md`, VPS | restauração e smoke test |
| 1 Core | organizações, RBAC, Identity Manager, contratos, auditoria | Fase 0 | e2e + cross-tenant |
| 2 Canais | inventário, provisionamento, OAuth, CMS/e-mail e 1 rede | Fase 1, contas dev | reconectar/revogar/testar |
| 3 Editorial | persona, agente, studio, aprovações, calendário, jobs, n8n | Fases 1–2 | publicar versão aprovada |
| 4 Relações | Inbox WhatsApp/Telegram, consentimentos, handoff | Fase 2, APIs aprovadas | webhooks/dedupe/opt-out |
| 5 Comercial | campanhas, métricas, custos, receitas, relatórios | Fases 3–4 | reconciliação/origem |
| 6 Escala | otimização, conectores extras, testes de carga | dados produção | SLO observado |

### 15.1. Backlog prioritário em épicos
`EP-00 Infra`, `EP-01 Access`, `EP-02 Identity`, `EP-03 Governance`, `EP-04 Accounts`, `EP-05 Onboarding`, `EP-06 AI/Editorial`, `EP-07 Publication`, `EP-08 Inbox`, `EP-09 Analytics/Revenue`, `EP-10 Observability/Security`. Cada história deve incluir: narrativa do usuário, critérios Given/When/Then, endpoint, tela, entidades, roles, logs, métricas e testes.

### 15.2. Decisões em aberto (não bloquear desenho lógico)
- **ENV-001:** valores exatos de VPS/Easypanel/Supabase existentes no `dim-dev-doc.md`.
- **ENV-002:** domínio de produção, subdomínios e DNS.
- **ENV-003:** SMTP/correio existente e API de provisionamento, se disponível.
- **PROD-001:** CMS padrão para blogs e modelo por influenciador.
- **INT-001:** contas Meta/X/WhatsApp desenvolvedor e escopos aprovados.
- **SEC-001:** solução e política de cofre, backup remoto e rotação de segredos.
- **BIZ-001:** modelo de propriedade/comissionamento e jurisdições contratuais.
- **FIN-001:** moedas, fusos e regras financeiras.

## 16. Sequência concreta para engenharia

1. Confirmar documento `dim-dev-doc.md` e inventário de serviços existentes, sem modificar servidores.
2. Gerar repositório `apps/web`, `apps/api`, `apps/worker`, `packages/ui`, `packages/contracts`, `packages/db`, `infra`, `n8n/workflows`.
3. Fechar ERD e migrations P0, seguido de política RLS testada com dois tenants.
4. Implementar auth, membership, RBAC e eventos auditáveis.
5. Implementar Identity Manager e onboarding versionado.
6. Implementar adaptador CMS/e-mail e um conector social oficial em ambiente de teste.
7. Implementar editor, aprovações e job de publicação com idempotência.
8. Incorporar agentes n8n sob autenticação de serviço e limites orçamentários.
9. Implementar módulos de relacionamento e comerciais segundo roadmap.

**Atenção:** este arquivo é o PRD-base para implementação. SQL completo executável, OpenAPI por endpoint, wireframes e workflows JSON constituem artefatos de engenharia subordinados a este documento; exigem confirmação das versões, infraestrutura e integrações reais antes do deploy em produção.

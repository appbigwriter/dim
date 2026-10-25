# PROJETO CONCEITUAL — DIGITAL INFLUENCER MANAGEMENT PLATFORM

**Versão:** 2.0  
**Classificação:** Documento-base para engenharia e elaboração do PRD  
**Infraestrutura:** VPS própria, Easypanel, Supabase Self-Hosted, n8n  
**Abrangência:** Influenciadores humanos e personagens virtuais  
**Idiomas de operação:** Português, inglês e espanhol  
**Estado:** Proposta conceitual para validação técnica e funcional

---

# 0. Visão executiva do projeto

## 0.1. Definição

A Digital Influencer Management Platform (DIM) será um sistema corporativo responsável por criar, organizar, representar, administrar e acompanhar influenciadores digitais humanos e virtuais, integrando seus ativos digitais e atividades de comunicação dentro de uma infraestrutura tecnológica centralizada.

Cada influenciador será uma unidade editorial e comercial independente, com identidade pública, personalidade, posicionamento, audiência, canais e histórico operacional próprios.

A plataforma permitirá que uma equipe humana, auxiliada por agentes de inteligência artificial, gerencie todo o ciclo de vida dessas identidades: concepção, aprovação, cadastro, provisionamento, publicação, relacionamento, monetização, auditoria, suspensão e encerramento.

## 0.2. Proposta de valor

**Transformar a administração de múltiplos influenciadores em um processo padronizado, seguro, auditável e escalável, reduzindo o trabalho operacional repetitivo sem perder o controle editorial e corporativo.**

O sistema deverá possibilitar:

- Criar e manter identidades digitais consistentes.
- Administrar influenciadores reais e virtuais no mesmo ambiente.
- Centralizar o inventário de contas e ativos digitais.
- Controlar titularidade, contratos e direitos de utilização.
- Produzir conteúdo por IA, personalizado para cada identidade.
- Adaptar e distribuir conteúdo por diferentes plataformas.
- Receber e organizar mensagens de audiência.
- Executar campanhas comerciais e acompanhar receitas.
- Controlar custos operacionais e consumo de APIs.
- Monitorar segurança, integrações e desempenho.
- Expandir a rede sem multiplicar proporcionalmente a equipe administrativa.

## 0.3. Objetivos de negócio

**OBJ-01 — Escalabilidade:** permitir a administração de dezenas de influenciadores por uma equipe central.

**OBJ-02 — Independência:** manter dados, estratégias e canais segregados logicamente por influenciador.

**OBJ-03 — Governança:** preservar a rastreabilidade de todas as ações administrativas, editoriais e comerciais.

**OBJ-04 — Produtividade:** automatizar tarefas repetitivas de produção, agendamento e análise.

**OBJ-05 — Continuidade:** impedir que a saída de um funcionário ou falhas em contas interrompam toda a operação.

**OBJ-06 — Monetização:** consolidar receitas, despesas, campanhas e oportunidades comerciais por influenciador.

**OBJ-07 — Conformidade:** respeitar políticas das plataformas, privacidade, contratos, direitos autorais e divulgações de conteúdo sintético.

## 0.4. Princípios obrigatórios

1. Uma identidade digital deve ter sempre um responsável humano identificável internamente.
2. Agentes de IA não são titulares legais de contas nem recebem privilégios administrativos irrestritos.
3. Cada ação externa deve ser autorizada, registrada e executada por integração legítima.
4. A segurança não depende de compartilhar senhas com operadores.
5. A aprovação editorial e a autorização para publicar são decisões distintas.
6. Falhas em um influenciador não podem comprometer as demais identidades.
7. Nenhuma automação deve simular engajamento orgânico inexistente.
8. O histórico crítico deve continuar disponível após a desativação de uma identidade, conforme regras de retenção.
9. O sistema deve ser preparado para receber novos canais por meio de conectores.
10. A operação pública deve deixar clara a natureza virtual de personagens sintéticos quando necessário, sem recorrer a identidades pessoais falsas.

## 0.5. Usuários do sistema

A plataforma terá quatro categorias de usuários:

- **Administradores corporativos:** proprietários e gestores da infraestrutura e das operações.
- **Equipe operacional:** editores, gestores de contas, social media, designers, comerciais e atendimento.
- **Influenciadores humanos:** indivíduos autorizados a consultar e administrar parte de suas atividades.
- **Agentes de IA:** identidades técnicas restritas que executam tarefas permitidas mediante políticas e autorizações.

O público consumidor final não deverá acessar o painel administrativo. Sua interação será realizada por blogs, redes sociais e canais de comunicação.

---

# 1. Arquitetura geral do sistema

## 1.1. Definição arquitetural

A aplicação utilizará uma arquitetura de **monólito modular no núcleo de negócios, com workers e conectores especializados**.

Essa escolha reduz a complexidade inicial de implantação em uma VPS própria, mas preserva fronteiras funcionais que permitem separar serviços no futuro.

O monólito modular será responsável por usuários, influenciadores, permissões, conteúdo, autorizações, campanhas, contatos e auditoria.

Os processos de maior duração — geração de mídia, publicação, coleta de métricas, envio de mensagens e automações — serão executados por workers e workflows assíncronos.

## 1.2. Camadas da plataforma

### Camada A — Experiência do usuário

Aplicação web responsiva, mobile-first, com:

- Dashboard corporativo.
- Dashboard individual do influenciador.
- Gestão de identidades.
- Gestão de contas e integrações.
- Calendário editorial.
- Studio de produção.
- Central de aprovação.
- Inbox de relacionamento.
- Analytics e monetização.
- Administração de usuários.
- Configurações e auditoria.

### Camada B — API e regras de negócio

Backend responsável por:

- Autenticação e autorização.
- Validação de dados.
- Regras de transição de estado.
- Isolamento entre organizações.
- Gestão de identidades e contas.
- Políticas editoriais.
- Criação de tarefas.
- Governança de ações automatizadas.
- Emissão de eventos.
- Registro de auditoria.

### Camada C — Orquestração

n8n executará os workflows de negócios:

- Onboarding.
- Provisionamento.
- Pesquisa editorial.
- Geração de conteúdo.
- Transformação de mídia.
- Publicação.
- Coleta de métricas.
- Atendimento assistido.
- Alertas e manutenção.

### Camada D — Persistência

Supabase Self-Hosted fornecerá:

- PostgreSQL.
- Supabase Auth.
- Storage.
- APIs de dados.
- Realtime, quando necessário.
- Políticas RLS.

### Camada E — Integrações

Conectores independentes para:

- Meta.
- X.
- WhatsApp.
- Telegram.
- WordPress ou CMS próprio.
- Serviços de e-mail.
- Modelos de IA.
- Serviços externos de mídia.
- Plataformas comerciais e analíticas.

## 1.3. Estratégia multi-organização

O sistema deverá permitir a existência de mais de uma organização gestora, embora o lançamento inicial possa utilizar uma única empresa.

Uma organização poderá ter vários influenciadores, operadores, equipes e campanhas.

**Regras:**

- `organization_id` será a principal chave de isolamento lógico.
- Todos os recursos administrados terão organização proprietária.
- Um usuário poderá integrar várias organizações, com permissões diferentes.
- Um influenciador terá uma organização gestora principal e poderá possuir contratos de colaboração com outras entidades.
- Compartilhamentos entre organizações deverão ser explícitos, versionados e auditados.
- A interface deverá apresentar claramente o contexto organizacional ativo.

## 1.4. Catálogo de telas gerais

| ID | Rota proposta | Tela | Função |
|---|---|---|---|
| UI-001 | `/login` | Login | Autenticação e MFA |
| UI-002 | `/dashboard` | Dashboard geral | Visão da operação |
| UI-003 | `/organizations` | Organizações | Gestão corporativa |
| UI-004 | `/influencers` | Influenciadores | Listagem e pesquisa |
| UI-005 | `/accounts` | Contas digitais | Inventário multicanal |
| UI-006 | `/editorial` | Editorial | Pautas e calendário |
| UI-007 | `/studio` | Content Studio | Criação e produção |
| UI-008 | `/approvals` | Aprovações | Decisões pendentes |
| UI-009 | `/inbox` | Relacionamento | Conversas |
| UI-010 | `/analytics` | Analytics | Indicadores |
| UI-011 | `/campaigns` | Campanhas | Projetos comerciais |
| UI-012 | `/security` | Segurança | Eventos e controles |
| UI-013 | `/settings` | Configurações | Parâmetros do sistema |

## 1.5. Dashboard principal

### Componentes obrigatórios

**Cabeçalho:** organização ativa, busca universal, notificações, perfil e seleção de idioma.

**Navegação:** menu lateral com módulos, indicadores de pendências e opções condicionadas às permissões.

**Resumo operacional:**

- Influenciadores ativos, em preparação e suspensos.
- Contas conectadas, desconectadas e com erros.
- Publicações previstas para hoje.
- Conteúdos aguardando aprovação.
- Mensagens aguardando atendimento.
- Workflows com falhas.
- Custos de IA e integrações.
- Receitas e desempenho por período.

**Painel de alertas:** contas com risco, contratos próximos do vencimento, tokens expirando e falhas de publicação.

**Feed de atividades:** últimas ações registradas, com usuário, recurso, resultado e data.

**Ações rápidas:** criar influenciador, criar pauta, iniciar campanha, aprovar conteúdo e verificar contas.

### Filtros

- Organização.
- Influenciador.
- Tipo humano ou virtual.
- Plataforma.
- Período.
- Estado operacional.
- Responsável.

## 1.6. Requisitos funcionais

**REQ-ARQ-001:** o sistema deve apresentar todos os influenciadores pertencentes à organização autorizada.

**REQ-ARQ-002:** permitir dashboards individuais sem alterar o contexto das demais identidades.

**REQ-ARQ-003:** atualizar indicadores por eventos e processamento assíncrono.

**REQ-ARQ-004:** permitir busca por nome, username, ID, plataforma, status e categoria.

**REQ-ARQ-005:** suportar temas claro e escuro e layouts mobile-first.

**REQ-ARQ-006:** distinguir dados confirmados, estimados, indisponíveis e ainda não sincronizados.

## 1.7. Tabelas principais

`organizations`: id, name, slug, legal_name, country_code, timezone, default_locale, status, settings_json, created_at, updated_at.

`organization_members`: id, organization_id, user_id, role_id, status, invited_at, joined_at.

`organization_settings`: id, organization_id, module_key, settings_json, version.

`system_events`: id, organization_id, event_type, resource_type, resource_id, payload_json, occurred_at, processing_status.

`notifications`: id, organization_id, recipient_user_id, category, title, body, severity, read_at, created_at.

## 1.8. Fluxo de dados fundamental

Usuário autenticado → Frontend → API de negócio → Validação de sessão e permissões → PostgreSQL → Registro de evento → Fila ou n8n, quando aplicável → Atualização do estado → Notificação e dashboard.

As tarefas assíncronas não deverão manter uma transação de banco aberta enquanto aguardam serviços externos.

---

# 2. Modelo de governança: humanos versus virtuais

## 2.1. Tipos de influenciador

### Humano

Pessoa natural que atua publicamente com sua própria identidade ou pseudônimo legítimo, podendo autorizar a empresa a administrar determinados canais.

### Virtual

Personagem digital desenvolvido ou licenciado pela empresa, com aparência, voz, personalidade e presença pública próprias, sem ser apresentado de maneira enganosa como uma pessoa natural independente.

### Híbrido

Identidade baseada em uma pessoa real que utiliza avatar, voz sintética ou representação digital autorizada.

O sistema terá três classificações: `human`, `virtual` e `hybrid`.

O tipo híbrido deverá ser tratado como humano nos requisitos de consentimento, direitos de imagem e proteção de identidade.

## 2.2. Governança de influenciadores humanos

Cada influenciador humano deverá possuir:

- Cadastro administrativo privado.
- Contrato de representação ou prestação de serviços.
- Escopo de canais autorizados.
- Termo de utilização de imagem e voz.
- Regras de aprovação de conteúdo.
- Definição de receita e comissionamento.
- Regras de acesso e recuperação.
- Prazo de vigência.
- Procedimento de desligamento.
- Definição de titularidade dos ativos.

Não se deve assumir que uma conta pessoal pertença à empresa apenas porque é administrada pela plataforma.

## 2.3. Governança de influenciadores virtuais

Cada personagem virtual deverá possuir uma **Bíblia de Identidade**, documento estruturado contendo:

**Identidade:** nome, pseudônimo, categoria, idiomas, biografia pública e origem conceitual.

**Aparência:** referências visuais, características permanentes, roupas recorrentes, regras de representação e versões aprovadas.

**Personalidade:** valores, temperamento, estilo de comunicação, interesses, linguagem e limites.

**Conhecimento:** temas de especialidade, fontes confiáveis e limites de competência.

**Editorial:** linha editorial, posicionamento, nicho, público, formatos e assuntos proibidos.

**Transparência:** forma de informar a natureza virtual, identificação de mídia sintética e proibição de fingir experiências reais inexistentes.

**Comportamento:** regras para responder a perguntas, lidar com críticas, reconhecer incerteza e encaminhar assuntos sensíveis.

**Continuidade:** histórico ficcional, fatos canônicos do personagem e mudanças autorizadas.

## 2.4. Gestão de identidade visual e voz

As imagens e vozes utilizadas devem estar associadas a registros de proveniência.

Cada ativo terá:

- Tipo e finalidade.
- Autor ou fornecedor.
- Origem e ferramenta utilizada.
- Licença.
- Data de geração ou aquisição.
- Versão.
- Influenciador relacionado.
- Restrições.
- Aprovação.
- Status de utilização.

Para humanos, a utilização de clonagem de voz, avatar fiel ou manipulação da aparência exigirá consentimento específico.

## 2.5. Telas do módulo

| ID | Tela | Recursos |
|---|---|---|
| GOV-001 | Classificação de identidade | Humano, virtual ou híbrido |
| GOV-002 | Contratos e direitos | Cadastro, versões e vigência |
| GOV-003 | Bíblia de Identidade | Editor estruturado |
| GOV-004 | Aparência e voz | Biblioteca e referências |
| GOV-005 | Políticas editoriais | Regras por identidade |
| GOV-006 | Transparência | Configuração de avisos |
| GOV-007 | Revisão de conformidade | Pendências e aprovações |
| GOV-008 | Desligamento | Encerramento assistido |

## 2.6. Formulário de governança

**Campos comuns:** influencer_id, type, owner_type, owner_reference, editorial_owner_id, default_approval_policy, legal_status.

**Para humanos:** nome legal, identificador contratual, jurisdição, consentimentos, contato privado, contrato, prazo e regras de uso.

**Para virtuais:** proprietário da marca, descrição da persona, versão da Bíblia, evidências de direitos, avisos de natureza sintética e responsáveis.

**Para híbridos:** todos os campos de pessoa real, além dos campos de autorização de avatar e voz.

Documentos com dados pessoais deverão ser privados, com acesso restrito e política de retenção específica.

## 2.7. Tabelas

`influencer_legal_profiles`: influencer_id, legal_owner_type, legal_reference, jurisdiction, verification_status, retention_policy_id.

`influencer_contracts`: id, influencer_id, organization_id, contract_type, version, storage_object_id, starts_at, ends_at, status, approved_by.

`identity_consents`: id, influencer_id, subject_id, consent_type, permitted_uses_json, evidence_object_id, granted_at, expires_at, revoked_at.

`influencer_personas`: id, influencer_id, version, tone_json, traits_json, allowed_topics_json, prohibited_topics_json, biography_json, status.

`persona_canon`: id, influencer_id, fact_key, fact_value, source_type, approved_by, valid_from, valid_to.

`identity_assets`: id, influencer_id, media_object_id, asset_type, license_id, provenance_json, approval_status.

`identity_disclosures`: id, influencer_id, platform_id, disclosure_type, disclosure_text, policy_version, enabled.

## 2.8. Regras de negócio

**GOV-R01:** influenciadores humanos não poderão ser ativados sem os consentimentos e contratos exigidos para as operações selecionadas.

**GOV-R02:** personagens virtuais só poderão ser publicados após aprovação de identidade e proveniência dos ativos centrais.

**GOV-R03:** mudança significativa na aparência, voz ou personalidade exigirá nova versão aprovada.

**GOV-R04:** revogação de consentimento bloqueará os usos futuros afetados e iniciará uma revisão dos materiais já publicados.

**GOV-R05:** o agente não poderá alterar livremente fatos canônicos, contratos nem declarações obrigatórias.

**GOV-R06:** a desativação deverá considerar direitos, obrigações contratuais, retenção e transferência de ativos.

---

# 3. Matriz de criação e administração das contas

## 3.1. Conceito

O sistema terá um catálogo de plataformas, com conectores e procedimentos específicos para cada provedor.

Uma conta será representada por:

- Influenciador associado.
- Plataforma.
- Tipo de conta.
- Identificador oficial.
- Username.
- URL pública.
- Titular operacional.
- Responsável pela recuperação.
- Status de cadastro.
- Status de autenticação.
- Capacidades autorizadas.
- Última sincronização.
- Restrições conhecidas.

## 3.2. Estados de uma conta

`planned` → `provisioning` → `pending_verification` → `active`.

Estados alternativos:

- `action_required`
- `restricted`
- `suspended`
- `integration_expired`
- `disconnected`
- `archived`

O estado cadastral e o estado de integração deverão ser separados. Uma conta pode continuar ativa publicamente enquanto sua autorização de API estiver expirada.

## 3.3. Matriz operacional

| Canal | Objeto principal | Provisionamento | Publicação |
|---|---|---|---|
| Facebook | Página | Manual assistido | API oficial |
| Instagram | Conta profissional | Manual assistido | API oficial quando elegível |
| X | Conta individual | Manual assistido | API oficial |
| Blog | Site/CMS | Automatizável | API interna ou CMS |
| E-mail | Caixa corporativa | Automatizável se houver API administrativa | SMTP/API |
| WhatsApp | Conta/número Business | Assistido, com verificações | API quando autorizada |
| Telegram | Canal ou bot | Assistido | Bot API autorizada |
| YouTube, futuro | Canal | Manual assistido | API quando autorizada |

A autorização para ler métricas, publicar, responder mensagens ou gerir mídia será armazenada como capacidades independentes.

## 3.4. Tela: inventário de contas

A tela `/accounts` deverá apresentar:

- Logotipo da plataforma.
- Influenciador.
- Username e URL.
- Status da conta.
- Status da integração.
- Responsável.
- Capacidades concedidas.
- Data da última sincronização.
- Alertas.
- Ações disponíveis.

Filtros: plataforma, organização, influenciador, responsável, status, integração e data de vencimento.

Ações: visualizar, vincular, reconectar, testar, suspender automação, auditar e arquivar.

## 3.5. Tela: detalhes da conta

Abas:

**Resumo:** informações públicas e estado operacional.

**Integração:** provedor, escopos, autorização, validade e testes.

**Permissões:** pessoas, agentes e serviços autorizados.

**Publicações:** fila, histórico, erros e resultados.

**Segurança:** eventos de acesso e incidentes.

**Recuperação:** responsável, procedimentos e comprovação de controle — nunca exposição de senhas ou códigos de recuperação.

## 3.6. Assistente de vinculação

Etapas:

1. Selecionar influenciador.
2. Selecionar plataforma.
3. Escolher criar nova conta ou vincular existente.
4. Apresentar requisitos e checklist.
5. Registrar conclusão do cadastro oficial.
6. Iniciar OAuth ou autorização oficial aplicável.
7. Verificar o identificador devolvido pelo provedor.
8. Associar permissões e capacidades.
9. Executar teste seguro.
10. Confirmar ativação.

A interface deverá indicar explicitamente tarefas que precisam ocorrer fora da plataforma.

## 3.7. Formulários

**Conta:** influencer_id, platform_id, account_type, external_account_id, username, profile_url, owner_reference, status.

**Integração:** account_id, connector_id, authorization_type, granted_scopes, secret_reference, expires_at, last_refresh_at, health_status.

**Checklist:** account_id, task_type, description, assignee_id, due_at, completed_at, evidence_reference.

**Teste:** account_id, capability, requested_by, result, error_code, tested_at.

## 3.8. Tabelas

`platforms`: id, code, name, website_url, capabilities_json, enabled.

`social_accounts`: id, organization_id, influencer_id, platform_id, external_id, account_type, handle, url, account_status, owner_reference.

`account_integrations`: id, social_account_id, provider, auth_type, secret_reference, granted_scopes_json, expires_at, status.

`account_capabilities`: id, social_account_id, capability_code, available, checked_at, restriction_reason.

`account_permissions`: id, social_account_id, principal_type, principal_id, permission_code, granted_by, expires_at.

`account_provisioning_tasks`: id, social_account_id, task_key, assignee_id, status, evidence_object_id, completed_at.

`account_health_checks`: id, social_account_id, capability, status, response_code, checked_at.

## 3.9. Fluxo de dados

Identity Manager → Solicitação de conta → Checklist → Operador humano e provedor oficial → Autorização → Callback do conector → Backend → Verificação de titularidade e permissões → Registro no banco → Ativação da capacidade → Auditoria.

## 3.10. Requisitos

**ACC-001:** uma conta não poderá ser atribuída a duas identidades incompatíveis sem processo formal de compartilhamento.

**ACC-002:** somente contas ativas e integrações válidas poderão receber publicações automatizadas.

**ACC-003:** o sistema deverá detectar autorizações expiradas e bloquear novos jobs dependentes.

**ACC-004:** falhas de API deverão possuir códigos normalizados e mensagens compreensíveis.

**ACC-005:** nenhuma credencial sensível poderá ser exibida na interface comum.

**ACC-006:** o sistema deverá impedir tentativas de cadastro automatizado que contornem controles da plataforma.

**ACC-007:** cada conector deverá declarar as capacidades realmente verificadas para aquela conta, não somente as capacidades teóricas da plataforma.

---

# 4. Estrutura de governança corporativa

## 4.1. Modelo de acesso

Será utilizado RBAC com políticas contextuais.

RBAC define as funções do operador. Políticas contextuais complementam essas funções considerando:

- Organização.
- Influenciador.
- Conta.
- Recurso.
- Status de contrato.
- Natureza da ação.
- Necessidade de aprovação.
- Nível de risco.

## 4.2. Perfis

**Super Admin:** controla a plataforma e as configurações globais.

**Organization Admin:** administra usuários, recursos e políticas da sua organização.

**Identity Manager:** gerencia identidades, vínculos, contas e provisionamento.

**Editorial Director:** aprova linhas editoriais e publicações de maior risco.

**Editor:** cria, revisa e aprova conteúdo dentro de limites atribuídos.

**Social Media:** agenda, acompanha publicações e executa moderação autorizada.

**Commercial Manager:** administra campanhas, parceiros e resultados comerciais.

**Support Agent:** opera a caixa de entrada e encaminha solicitações.

**Influencer:** consulta e modifica recursos especificamente autorizados.

**Auditor:** consulta eventos e evidências sem editar registros operacionais.

**AI Service Principal:** identidade técnica de execução, com capacidades explícitas e sem acesso administrativo ao sistema.

## 4.3. Catálogo de permissões

As permissões deverão seguir o padrão:

`dominio.recurso.acao`

Exemplos:

- `identity.influencer.create`
- `identity.influencer.update`
- `identity.contract.approve`
- `account.social.connect`
- `account.social.revoke`
- `content.item.create`
- `content.item.approve`
- `content.publication.schedule`
- `content.publication.execute`
- `inbox.conversation.reply`
- `commercial.campaign.read`
- `security.audit.read`
- `security.role.assign`

Permissões sensíveis não poderão ser concedidas implicitamente por herança de funções editoriais.

## 4.4. Telas

`/settings/users`: usuários, convites e status.

`/settings/roles`: funções e permissões.

`/settings/teams`: equipes e influenciadores atribuídos.

`/settings/policies`: políticas organizacionais.

`/security/sessions`: sessões ativas e encerramento remoto.

`/security/audit`: logs, filtros e exportações.

`/security/incidents`: incidentes e resposta.

`/security/credentials`: estado dos segredos e integrações, sem revelar valores.

## 4.5. Formulários

**Convite:** e-mail, organização, função, influenciadores permitidos, validade.

**Permissão excepcional:** operador, ação, recurso, justificativa, solicitante, aprovador e expiração.

**Incidente:** tipo, gravidade, recurso afetado, descrição, responsável, medidas, evidências e encerramento.

**Política:** código, versão, organização, condição, ação permitida, aprovadores e vigência.

## 4.6. Tabelas

`user_profiles`: user_id, display_name, locale, timezone, status.

`roles`: id, organization_id, code, name, is_system.

`permissions`: id, code, description, risk_level.

`role_permissions`: role_id, permission_id.

`role_assignments`: id, user_id, organization_id, role_id, scope_type, scope_id, valid_until.

`teams`: id, organization_id, name, status.

`team_members`: team_id, user_id, assigned_at.

`approval_policies`: id, organization_id, resource_type, conditions_json, steps_json, enabled, version.

`audit_logs`: id, organization_id, actor_type, actor_id, action, resource_type, resource_id, before_json, after_json, correlation_id, occurred_at.

`security_incidents`: id, organization_id, severity, category, state, assigned_to, opened_at, resolved_at.

## 4.7. Controles

- MFA obrigatório para funções privilegiadas.
- Aprovação adicional para alterações de titularidade, credenciais e privilégios críticos.
- Tokens de serviço com escopo mínimo e rotação.
- Suspensão imediata de sessões e acessos após desligamento.
- Auditoria das alterações administrativas.
- Proteção contra escalonamento indevido de privilégios.
- Registro do autor real de ações feitas por agentes.
- Logs com dados sensíveis mascarados.
- Exportações controladas e registradas.

## 4.8. Fluxo de autorização

Operador → Autenticação → Identificação de organização → Verificação de função → Verificação de escopo → Verificação de política contextual → Aprovação adicional, quando necessária → Execução → Registro de auditoria.

Uma requisição negada deverá retornar mensagem apropriada sem expor dados de outra organização.

---

# 5. Módulo Identity Manager

## 5.1. Objetivo

Constituir o cadastro-mestre de cada influenciador e o principal ponto de entrada para a operação.

O Identity Manager será responsável pelo ciclo de vida de uma identidade, mas não executará diretamente todas as tarefas de publicação e relacionamento.

## 5.2. Tela: diretório de influenciadores

Layout em cards ou tabela, alternável pelo usuário.

Cada registro apresentará:

- Foto ou avatar.
- Nome público.
- Código interno.
- Tipo.
- Nicho.
- Idioma.
- Organização.
- Responsável.
- Status.
- Quantidade de canais.
- Alertas.
- Indicador resumido de atividade.

Ações em lote deverão ser limitadas a funções seguras, como atribuição de responsáveis, tags, relatórios e arquivamento assistido. Não haverá criação em massa de contas sociais por scripts.

## 5.3. Tela: ficha completa

A ficha terá abas:

**Visão geral:** identidade, resumo, status, canais e indicadores.

**Perfil:** nomes, biografia, público, idiomas, tags e posicionamento.

**Persona:** tom de voz, personalidade, valores e limites.

**Mídia:** imagens, vídeos, voz, identidade visual e licenças.

**Canais:** contas e integrações.

**Editorial:** calendário, pautas e materiais.

**Agentes:** configurações da IA e histórico de execuções.

**Relacionamento:** contatos e atendimentos autorizados.

**Comercial:** campanhas, contratos, receitas e custos.

**Governança:** responsáveis, contratos, permissões e incidentes.

**Histórico:** alterações e eventos.

## 5.4. Formulário principal de identidade

### Grupo A — Dados básicos

- Nome público — obrigatório.
- Nome interno — obrigatório.
- Slug exclusivo na organização — obrigatório.
- Código automático.
- Tipo: humano, virtual ou híbrido.
- Status inicial: rascunho.
- País e timezone operacional.
- Idioma principal.
- Idiomas adicionais.
- Nicho principal e secundários.
- Tags livres.
- Descrição breve.

### Grupo B — Posicionamento

- Proposta de valor.
- Público-alvo.
- Faixa etária da audiência desejada.
- Região geográfica de atuação.
- Assuntos prioritários.
- Diferenciais.
- Objetivos de comunicação.
- Limites de posicionamento editorial.

### Grupo C — Identidade pública

- Nome de exibição.
- Nome de usuário preferencial.
- Biografia curta.
- Biografia longa.
- Imagem principal.
- Imagem de capa.
- Paleta.
- Tipografia.
- Tom de voz.
- Website principal.
- Informações públicas de transparência.

### Grupo D — Operação

- Gestor responsável.
- Editor responsável.
- Equipe atribuída.
- Fluxo de aprovação.
- Frequência editorial desejada.
- Canais pretendidos.
- Orçamento operacional.
- Status de governança.

### Grupo E — Recursos de IA

- Agente ativo ou inativo.
- Modelo de IA preferencial.
- Fallback autorizado.
- Idiomas de produção.
- Temperatura ou criatividade, quando suportada.
- Limite de custo.
- Limite de execução.
- Base de conhecimento.
- Instruções especiais.
- Necessidade de revisão humana.

## 5.5. Bíblia de Identidade

Será composta por blocos estruturados, permitindo reutilização por agentes:

1. Identidade essencial.
2. História e contexto.
3. Personalidade.
4. Estilo de linguagem.
5. Conhecimento e especialidades.
6. Audiência.
7. Valores e limites.
8. Preferências editoriais.
9. Aparência e voz.
10. Continuidade e fatos canônicos.
11. Regras de relacionamento.
12. Restrições de conteúdo.
13. Instruções de transparência.
14. Exemplos aprovados de comunicação.
15. Versão e responsável.

A Bíblia deverá permitir rascunhos, comparação entre versões, aprovação e rollback controlado.

## 5.6. Estados do influenciador

`draft` → `under_review` → `approved` → `provisioning` → `ready` → `active`.

Estados adicionais: `paused`, `restricted`, `offboarding`, `archived`.

As transições dependerão de pré-requisitos explícitos.

## 5.7. Tabelas

`influencers`: id, organization_id, code, type, public_name, internal_name, slug, primary_language, timezone, niche_id, owner_user_id, status, created_at, updated_at.

`influencer_profiles`: influencer_id, biography_short, biography_long, value_proposition, audience_json, positioning_json, appearance_settings_json.

`influencer_personas`: id, influencer_id, version, traits_json, style_json, knowledge_json, boundaries_json, approved_at.

`influencer_languages`: influencer_id, language_code, proficiency_type, enabled.

`influencer_tags`: influencer_id, tag_id.

`influencer_assignments`: id, influencer_id, user_id, responsibility, starts_at, ends_at.

`influencer_assets`: id, influencer_id, object_id, category, status, metadata_json.

`influencer_status_history`: id, influencer_id, old_status, new_status, reason, changed_by, changed_at.

`influencer_goals`: id, influencer_id, metric_code, target_value, period_start, period_end.

## 5.8. Fluxo de dados

Formulário → Validação → Criação da identidade em rascunho → Registro das configurações → Associação de equipe → Solicitação de aprovação → Aprovação da Bíblia e governança → Emissão de evento → Início do provisionamento.

Nenhuma identidade será considerada operacional simplesmente porque o formulário de criação foi concluído.

## 5.9. Features adicionais

- Duplicar estrutura editorial sem copiar identidade pessoal ou contas.
- Templates de persona.
- Pré-visualização de biografias por plataforma.
- Validador de campos obrigatórios.
- Histórico de versões.
- Upload de documentos.
- Checklist de ativação.
- Exportação da ficha.
- Busca universal.
- Arquivamento com retenção.
- Indicadores de completude.
- Identificação de conflitos de nomes e marcas.

---

# 6. Automação editorial e operação dos agentes de IA

## 6.1. Objetivo

Permitir que cada influenciador opere com uma identidade editorial própria, utilizando agentes especializados e workflows n8n para produzir, adaptar, revisar, distribuir e analisar conteúdo.

Os agentes serão **assistentes operacionais com capacidade limitada por políticas**, não usuários com acesso irrestrito às plataformas.

## 6.2. Arquitetura dos agentes

### Agente A — Pesquisador

Identifica pautas, analisa fontes, reúne referências e sugere oportunidades editoriais.

### Agente B — Estrategista

Relaciona pautas ao público, objetivos, canais e calendário do influenciador.

### Agente C — Redator

Cria textos originais conforme a Bíblia de Identidade.

### Agente D — Adaptador

Transforma conteúdo para formatos e canais autorizados.

### Agente E — Designer/Media Planner

Produz briefings e solicita imagens, vídeos, áudios e elementos gráficos aos serviços apropriados.

### Agente F — Verificador

Analisa afirmações factuais, referências, potenciais conflitos de direitos e inconsistências.

### Agente G — Compliance

Verifica políticas editoriais, transparência de IA e divulgações comerciais.

### Agente H — Publicador

Prepara publicações e solicita execução ao serviço de distribuição, respeitando aprovações e capacidades.

### Agente I — Analista

Interpreta resultados e recomenda ajustes futuros.

## 6.3. Princípio de orquestração

Um único n8n central poderá executar os workflows de todos os influenciadores, recebendo contexto por identificadores.

Cada execução deverá incluir:

- organization_id.
- influencer_id.
- workflow_run_id.
- tarefa solicitada.
- política aplicável.
- versão da persona.
- versão do conteúdo.
- prazo.
- limites de orçamento.
- identidade técnica solicitante.
- correlation_id.

O workflow não poderá confiar cegamente em campos enviados pelo frontend. Contexto e autorização deverão ser validados no backend.

## 6.4. Tela: AI Content Studio

A interface terá quatro áreas principais.

**Barra de contexto:** influenciador ativo, idiomas, campanha e configurações do agente.

**Área de briefing:** assunto, objetivo, público, canais, referências e instruções.

**Área de produção:** versões, textos, anexos, mídias e resultados da IA.

**Painel de avaliação:** conformidade, revisão, aprovação, custos e histórico.

## 6.5. Formulário: nova produção

- Influenciador.
- Tipo de conteúdo.
- Tema.
- Objetivo.
- Público.
- Idioma.
- Plataformas.
- Formatos.
- Linha editorial.
- Palavras-chave.
- Referências.
- Fonte de informação.
- Chamada para ação.
- Campanha associada.
- Data desejada.
- Grau de autonomia.
- Exigência de aprovação.
- Orçamento máximo.

## 6.6. Tipos de conteúdo

- Artigo completo.
- Nota curta.
- Análise contextual.
- Entrevista.
- Tutorial.
- Lista editorial.
- Carrossel.
- Publicação social.
- Roteiro de vídeo curto.
- Roteiro de vídeo longo.
- Newsletter.
- Podcast.
- Infográfico.
- Comunicado comercial.
- Mensagem de comunidade.

Cada tipo terá um template de requisitos e estrutura de saída.

## 6.7. Calendário editorial

A tela `/editorial/calendar` deverá disponibilizar visualizações mensal, semanal, diária e lista.

Cada item mostrará:

- Influenciador.
- Conteúdo.
- Canal.
- Responsável.
- Data e timezone.
- Estado.
- Campanha.
- Pendências.
- Histórico de alterações.

Funções:

- Arrastar e reagendar.
- Filtrar por canal ou influenciador.
- Detectar conflitos.
- Criar conteúdos recorrentes.
- Aplicar limites de frequência.
- Pausar campanhas.
- Solicitar aprovação.
- Abrir conteúdo associado.

## 6.8. Fluxo editorial

`idea` → `researching` → `drafting` → `review_required` → `approved` → `scheduled` → `publishing` → `published`.

Estados alternativos:

- `rejected`
- `changes_requested`
- `blocked`
- `failed`
- `cancelled`

A revisão poderá devolver conteúdo ao estado de rascunho preservando as versões anteriores.

## 6.9. Aprovações

A aprovação será vinculada a uma versão específica do conteúdo.

Mudanças substanciais após aprovação invalidarão a autorização anterior.

As regras poderão variar por:

- Influenciador.
- Tipo de mídia.
- Plataforma.
- Tema.
- Conteúdo patrocinado.
- Risco reputacional.
- Uso de imagem ou voz humana.
- Declarações técnicas ou sensíveis.

Publicações críticas sempre exigirão aprovação humana.

## 6.10. Serviço de publicação

Receberá somente jobs autorizados.

Um job deverá conter:

- account_id.
- content_version_id.
- media_assets.
- scheduled_at.
- locale.
- approval_reference.
- idempotency_key.
- policy_version.
- execution_status.

O serviço deverá validar permissões, integridade da aprovação, limitações do provedor e estado da conta antes de transmitir qualquer publicação.

## 6.11. Tratamento de falhas

Falhas temporárias receberão novas tentativas com espera progressiva.

Falhas permanentes deverão bloquear a execução e gerar tarefas de intervenção.

Falhas de autorização deverão suspender a integração.

Reenvios não poderão produzir publicações duplicadas: quando houver incerteza sobre a resposta do provedor, o sistema deverá consultar o estado externo quando possível antes de repetir.

## 6.12. Tabelas

`agent_definitions`: id, code, name, purpose, capabilities_json, status.

`agent_assignments`: id, influencer_id, agent_id, model_config_id, policy_id, enabled.

`ai_model_configs`: id, organization_id, provider, model_id, parameters_json, cost_policy_json, status.

`knowledge_sources`: id, influencer_id, source_type, uri, status, last_indexed_at.

`editorial_topics`: id, organization_id, title, category_id, research_status, source_set_id.

`content_items`: id, organization_id, influencer_id, title, content_type, objective, state, created_by.

`content_versions`: id, content_id, version_number, language, format, body_json, body_text, created_by, created_at.

`content_sources`: id, content_id, source_url, publisher, captured_at, claim_notes_json.

`content_assets`: id, content_version_id, media_object_id, role, license_status.

`content_approvals`: id, content_version_id, approver_id, decision, rationale, policy_version, decided_at.

`publication_jobs`: id, organization_id, account_id, content_version_id, scheduled_at, status, idempotency_key, attempt_count.

`publication_attempts`: id, job_id, attempted_at, outcome, provider_response_reference, error_code.

`published_posts`: id, job_id, external_post_id, external_url, published_at, state.

`publication_metrics`: id, published_post_id, metric_code, metric_value, observed_at, provenance.

`agent_runs`: id, agent_id, influencer_id, task_type, model_id, input_reference, output_reference, token_usage_json, cost, status.

## 6.13. Fluxo de dados

Pauta → Pesquisa → Fontes → Contexto da persona → Agente redator → Adaptação por canal → Verificação → Aprovação → Job de publicação → Conector oficial → Resultado → Métricas → Analytics → Recomendações editoriais.

Recomendações automáticas não poderão modificar retroativamente publicações já aprovadas.

---

# 7. WhatsApp, Telegram e relacionamento

## 7.1. Objetivo

Centralizar contatos e conversas provenientes dos canais autorizados, possibilitando atendimento humano, triagem por IA, segmentação de audiência e relacionamento comercial legítimo.

Não será desenvolvido um sistema de disparos não solicitados.

## 7.2. Modelo de relacionamento

Um contato poderá ter múltiplas identidades externas, como telefone, Telegram ID, e-mail e outros identificadores permitidos.

O sistema deverá distinguir:

- Identidade externa.
- Contato consolidado.
- Canal.
- Consentimento por finalidade.
- Conversa.
- Mensagem.
- Atendimento.
- Histórico de interação.
- Campanha e origem.

A associação de identidades somente ocorrerá quando houver fundamento válido e evidência suficiente. Mesmo nome ou fotografia não autoriza fusão automática de contatos.

## 7.3. WhatsApp

A integração principal proposta é a WhatsApp Business Platform, mediante configuração empresarial válida.

Funcionalidades:

- Receber webhooks.
- Identificar número/canal.
- Registrar mensagens autorizadas.
- Distribuir atendimentos.
- Aplicar templates aprovados quando necessários.
- Verificar janelas de atendimento e elegibilidade.
- Gerenciar consentimentos.
- Registrar envio, entrega, leitura e falha quando esses eventos forem disponibilizados.
- Transferir atendimento para operador.
- Interromper comunicações a pedido do usuário.

As regras de templates, janelas e categorias deverão ser tratadas como configurações verificadas da API, não constantes presumidas.

## 7.4. Telegram

A integração deverá diferenciar:

**Canal:** distribuição de conteúdo e comunicados.

**Grupo:** comunidade e moderação.

**Bot:** interface programática para interações autorizadas.

O sistema poderá:

- Publicar em canais onde o bot tenha autorização adequada.
- Receber atualizações por webhook.
- Responder interações iniciadas ou permitidas.
- Aplicar regras de moderação.
- Registrar comandos.
- Acompanhar membros e estatísticas disponibilizadas.
- Administrar filas de atendimento.

## 7.5. Inbox unificada

A tela `/inbox` terá três colunas:

**Coluna esquerda:** lista de conversas, busca, filtros, tags, não lidas, SLA e responsáveis.

**Coluna central:** histórico de mensagens, anexos, contexto, estado e editor de respostas.

**Coluna direita:** contato, influenciador, canal, consentimentos, tags, campanhas relacionadas e ações permitidas.

Recursos:

- Resposta manual.
- Respostas sugeridas por IA.
- Encaminhamento.
- Atribuição a operador.
- Notas internas.
- Etiquetas.
- Priorização.
- Busca em histórico autorizado.
- Mensagens predefinidas.
- Escalonamento.
- Encerramento.
- Bloqueio e opt-out.

## 7.6. Formulário de contato

- Nome de exibição.
- Identificadores por canal.
- Idioma.
- Região, se fornecida.
- Origem do contato.
- Influenciadores relacionados.
- Tags.
- Consentimentos.
- Preferências de comunicação.
- Observações internas.
- Política de retenção.

## 7.7. Formulário de resposta automatizada

- Canal.
- Influenciador.
- Tipo de interação.
- Evento de disparo.
- Finalidade autorizada.
- Modelo de resposta.
- Agente responsável.
- Limite de autonomia.
- Condições de transferência humana.
- Horário de funcionamento.
- Regras de opt-out.
- Status.

## 7.8. Tabelas

`contacts`: id, organization_id, display_name, locale, status, created_at.

`contact_identities`: id, contact_id, platform_id, external_identifier_hash, encrypted_reference, verification_status.

`contact_influencers`: contact_id, influencer_id, relationship_status, created_at.

`consent_records`: id, contact_id, channel, purpose, lawful_basis, evidence_reference, granted_at, revoked_at, expires_at.

`conversations`: id, organization_id, influencer_id, contact_id, account_id, external_thread_id, status, assigned_to, opened_at.

`messages`: id, conversation_id, provider_message_id, direction, message_type, body_reference, status, occurred_at.

`message_attachments`: id, message_id, media_object_id, mime_type, retention_until.

`conversation_assignments`: id, conversation_id, user_id, assigned_at, unassigned_at.

`conversation_notes`: id, conversation_id, author_id, note_body, created_at.

`automated_response_rules`: id, organization_id, account_id, trigger_json, policy_json, template_id, enabled.

`message_templates`: id, provider, provider_template_id, language, category, content_json, approval_status.

`webhook_events`: id, provider, event_id, signature_status, payload_reference, received_at, processing_state.

## 7.9. Fluxo de dados

Mensagem externa → Webhook oficial → Verificação de autenticidade → Deduplicação → Normalização → Associação ao canal e influenciador → Verificação de consentimento → Registro da conversa → Classificação → Atendimento humano ou sugestão de IA → Validação de política → Resposta autorizada → Registro de resultado.

Dados externos nunca deverão ser interpretados automaticamente como instruções administrativas confiáveis.

## 7.10. Requisitos de segurança e privacidade

- Verificar assinaturas e segredos de webhooks.
- Proteger telefones e dados pessoais.
- Aplicar retenção por categoria.
- Implementar solicitações de acesso, correção e exclusão quando aplicáveis.
- Não treinar modelos com mensagens privadas sem fundamento e autorização apropriados.
- Restringir respostas automatizadas em assuntos sensíveis.
- Exibir claramente quando um assistente de IA estiver atendendo.
- Preservar trilha de atendimento e transferência humana.
- Bloquear mensagens em massa sem consentimento apropriado.

---

# 8. Stack tecnológica, Supabase Self-Hosted e deploy no Easypanel

## 8.1. Diretriz

A operação será instalada em infraestrutura própria, usando uma VPS Ubuntu com Docker e Easypanel.

A solução deverá continuar funcional sem depender da versão gerenciada do Supabase.

## 8.2. Componentes

**Frontend:** Next.js, React, TypeScript e Tailwind CSS.

**Backend:** API Node.js/TypeScript, organizada por módulos funcionais.

**Validação:** esquemas tipados de entrada e saída, com validação no servidor.

**Banco:** PostgreSQL fornecido pelo Supabase Self-Hosted.

**Autenticação:** Supabase Auth.

**Arquivos:** Supabase Storage com volumes persistentes ou backend de objetos compatível.

**Automação:** n8n central.

**Filas:** Redis + BullMQ, com workers independentes.

**IA:** camada de provedores configurável, incluindo OpenRouter.

**Observabilidade:** logs estruturados, métricas, traces e alertas.

**Segredos:** serviço de gestão de segredos ou cofre corporativo.

**Proxy:** camada HTTPS administrada no Easypanel, conforme compatibilidade do serviço.

**E-mail:** SMTP corporativo configurado para autenticação, avisos e caixas operacionais.

## 8.3. Topologia de implantação

Serviços propostos:

- `dim-web`: frontend.
- `dim-api`: backend e políticas.
- `dim-worker`: processamento assíncrono.
- `dim-redis`: filas e coordenação.
- `dim-n8n`: automação.
- `dim-supabase`: stack oficial do Supabase.
- `dim-secrets`: serviço de segredos, se adotado.
- `dim-monitor`: monitoramento e alertas.
- `dim-backup`: rotina e coordenação de backups.

A stack Supabase deverá utilizar uma distribuição oficial versionada em Docker Compose. O Easypanel poderá gerenciar serviços Compose, desde que volumes, redes, rotas e variáveis sejam ajustados à configuração testada.

## 8.4. Segmentação de rede

### Rede pública

Expor somente os pontos necessários:

- Frontend HTTPS.
- API HTTPS.
- Gateway público do Supabase, para rotas realmente necessárias.
- Endpoints de webhook estritamente autorizados.

### Rede privada de aplicação

- Workers.
- Redis.
- Serviços internos do n8n.
- Backend de segredos.
- Comunicação entre serviços.

### Rede de dados

- PostgreSQL.
- Interfaces administrativas internas.
- Processos de backup.

PostgreSQL e Redis não deverão ter portas públicas abertas.

O acesso ao Supabase Studio, n8n administrativo e Easypanel deverá usar controles reforçados, idealmente VPN ou rede privada administrativa, além de autenticação forte.

## 8.5. Subdomínios de referência

Como o domínio definitivo não foi escolhido, a implantação poderá seguir este padrão:

- `app.<dominio>` — dashboard.
- `api.<dominio>` — API.
- `auth.<dominio>` — serviços de autenticação, conforme roteamento.
- `hooks.<dominio>` — webhooks.
- `db-admin.<dominio>` — Studio, com acesso privado.
- `automation-admin.<dominio>` — n8n, com acesso privado.

Os nomes são exemplos e devem ser definidos no PRD de implantação.

## 8.6. Requisitos do Supabase Self-Hosted

O time deverá:

1. Fixar versões de imagens e dependências.
2. Criar segredos exclusivos por ambiente.
3. Configurar Auth, URLs e redirecionamentos seguros.
4. Integrar SMTP de produção.
5. Configurar RLS em tabelas expostas.
6. Separar schemas públicos, privados e operacionais.
7. Criar migrações versionadas.
8. Definir políticas de Storage.
9. Restringir chaves privilegiadas ao backend.
10. Configurar backups e restauração.
11. Monitorar conexões e consumo de recursos.
12. Testar atualizações em homologação.
13. Documentar procedimentos de emergência.

O Supabase Self-Hosted é uma instância técnica única. O suporte a várias organizações será implementado pelo modelo de dados e pelas regras da aplicação, não por criação automática de projetos gerenciados no Studio.

## 8.7. Modelo de schemas

**`public`:** dados necessários às APIs expostas com RLS.

**`private`:** dados administrativos, contratos e informações restritas, acessados por backend autorizado.

**`ops`:** eventos de execução, filas lógicas, integrações e auditoria técnica.

**`analytics`:** agregados, indicadores e relatórios.

Os schemas deverão ser criados com papéis, privilégios e políticas explícitos, evitando que uma configuração genérica exponha dados privados.

## 8.8. Backups

O plano deverá contemplar separadamente:

- PostgreSQL.
- Storage.
- Configurações de aplicação.
- Configurações dos workflows n8n.
- Dados persistentes do n8n.
- Metadados de integrações.
- Segredos criptografados, com gestão independente das chaves.
- Manifesto de versões implantadas.

Parâmetros iniciais sugeridos:

**RPO-alvo:** até 24 horas no MVP, com estudo de redução para até 1 hora quando a operação exigir.

**RTO-alvo:** até 8 horas no MVP, condicionado a infraestrutura reserva, automação de restauração e testes.

Os objetivos não são garantias. Precisarão ser demonstrados em exercícios reais.

Os backups deverão possuir cópia externa à VPS, criptografia, política de retenção, monitoramento e testes periódicos de restauração.

## 8.9. Continuidade operacional

Falha do n8n não deverá impedir acesso aos registros administrativos.

Falha de um conector não deverá bloquear publicações de outros conectores.

Falha no provedor de IA deverá permitir troca de modelo, uso de fallback autorizado ou encaminhamento humano.

Falha de Storage deverá suspender publicações dependentes de mídia sem perder os registros de conteúdo.

## 8.10. Capacidade e dimensionamento

O dimensionamento não poderá ser baseado exclusivamente na quantidade de influenciadores.

Métricas necessárias:

- Operadores simultâneos.
- Publicações diárias.
- Jobs por minuto.
- Tamanho de mídia.
- Arquivos armazenados.
- Mensagens recebidas.
- Eventos de webhook.
- Execuções n8n.
- Uso de IA.
- Volume de logs.
- Crescimento do PostgreSQL.

Antes da produção, serão realizados testes de carga e definidos limites de concorrência por serviço.

## 8.11. Ambientes

**Development:** testes locais e desenvolvimento.

**Staging:** homologação isolada, com serviços e credenciais independentes.

**Production:** ambiente real, com políticas de segurança e observabilidade.

Nunca reutilizar tokens produtivos, dados pessoais reais ou webhooks de produção indiscriminadamente em desenvolvimento.

## 8.12. CI/CD

Fluxo proposto:

Commit → Lint e testes → Análise de dependências → Build → Imagem versionada → Deploy em staging → Migrações compatíveis → Testes → Aprovação → Deploy em produção → Health checks → Observação de erros.

Rollbacks deverão ser planejados para aplicação e banco. Migrações destrutivas exigirão procedimento especial.

---

# 9. Fluxo de criação de um novo influenciador

## 9.1. Conceito

O onboarding será um assistente transacional, com etapas independentes, checkpoints e retomada de progresso.

Deverá permitir criar identidades sem obrigar o usuário a configurar imediatamente todas as plataformas.

## 9.2. Etapa 1 — Identidade

Formulários:

- Nome e tipo.
- Nicho e público.
- Idiomas e região.
- Biografia.
- Responsáveis.

Resultado: influenciador em `draft`.

## 9.3. Etapa 2 — Persona e governança

Para humanos:

- Contrato.
- Direitos e consentimentos.
- Regras de aprovação.

Para virtuais:

- Bíblia de Identidade.
- Aparência e voz.
- Transparência.
- Proveniência dos ativos.

Resultado: identidade pronta para revisão.

## 9.4. Etapa 3 — Aprovação

O gestor deverá verificar:

- Completude.
- Contratos.
- Identidade.
- Direitos de mídia.
- Políticas.
- Responsáveis.
- Orçamento.
- Riscos conhecidos.

Resultado: `approved` ou `changes_required`.

## 9.5. Etapa 4 — Infraestrutura digital

Criar ou configurar:

- Caixa de e-mail.
- Domínio ou subdomínio.
- Blog.
- Identidade visual.
- Estrutura de armazenamento.
- Equipe.
- Configuração do agente.

Tarefas automatizáveis serão executadas por integrações administrativas legítimas.

## 9.6. Etapa 5 — Contas sociais

Para cada plataforma selecionada:

- Verificar pré-requisitos.
- Designar operador.
- Executar cadastro oficial.
- Registrar dados não sensíveis.
- Conectar API, quando permitida.
- Validar capacidades.
- Documentar recuperação.
- Verificar status.

## 9.7. Etapa 6 — Configuração editorial

- Calendário.
- Frequência por canal.
- Categorias.
- Personas.
- Fontes.
- Templates.
- Agentes.
- Aprovações.
- Limites operacionais.

## 9.8. Etapa 7 — Testes

Testes obrigatórios:

- Autenticação.
- Permissões.
- Integração de conta.
- Publicação controlada, quando autorizada.
- Tratamento de erro.
- Registro de auditoria.
- Alertas.
- Armazenamento.
- Visibilidade correta dos conteúdos.

## 9.9. Etapa 8 — Ativação

A ativação exigirá:

- Identidade aprovada.
- Responsável operacional definido.
- Pelo menos um canal funcional, conforme escopo.
- Política editorial aprovada.
- Controles de segurança mínimos válidos.
- Testes concluídos.
- Ausência de bloqueios críticos.

O resultado será `active`.

## 9.10. Interface do assistente

A tela `/influencers/new` deverá apresentar:

**Cabeçalho:** nome provisório, status, progresso e última alteração.

**Navegação:** etapas numeradas, pendências e condições de avanço.

**Área central:** formulário dinâmico.

**Painel lateral:** checklist, orientações, validações e responsáveis.

**Rodapé:** salvar rascunho, voltar, avançar e solicitar aprovação.

O usuário poderá sair e continuar posteriormente.

## 9.11. Tabelas

`onboarding_sessions`: id, organization_id, influencer_id, current_step, status, initiated_by, started_at, completed_at.

`onboarding_steps`: id, session_id, step_code, data_json, status, completed_by, completed_at.

`onboarding_tasks`: id, session_id, task_code, assignee_id, due_at, status, evidence_reference.

`onboarding_approvals`: id, session_id, approval_type, reviewer_id, decision, comments, decided_at.

`onboarding_events`: id, session_id, event_type, payload_json, occurred_at.

## 9.12. Fluxo de dados

Novo influenciador → Sessão de onboarding → Validação de cada etapa → Registro incremental → Tarefas humanas e automáticas → Revisão → Provisionamento → Integrações → Testes → Ativação → Dashboard operacional.

Se uma etapa falhar, o restante dos dados deverá permanecer preservado.

---

# 10. Plano de implementação por fases

## 10.1. Estratégia de desenvolvimento

A implantação será incremental, com entregas utilizáveis, testes e critérios objetivos para avançar.

Não será necessário implementar todas as redes sociais e recursos de IA antes da primeira operação funcional.

## Fase 0 — Preparação e infraestrutura

**Entregas:**

- Repositório e estrutura de projetos.
- Ambientes development, staging e production.
- Easypanel.
- Supabase Self-Hosted.
- Banco inicial.
- Auth.
- Segredos.
- Redes privadas.
- Backups.
- Observabilidade.
- Pipeline de deploy.

**Critérios de conclusão:**

- Login autenticado funcionando.
- Banco inacessível publicamente.
- Segredos isolados.
- Backup e restauração testados.
- Aplicação e API com health checks.

## Fase 1 — Núcleo corporativo e Identity Manager

**Entregas:**

- Organizações.
- Usuários.
- RBAC.
- Cadastro de influenciadores.
- Personas.
- Governança de direitos.
- Biblioteca de ativos.
- Auditoria.
- Dashboard básico.

**Critérios de conclusão:**

- Criação de influenciadores humanos, virtuais e híbridos.
- Isolamento entre organizações validado.
- Permissões testadas.
- Histórico de alterações disponível.
- Estados de identidade funcionando.

## Fase 2 — Provisionamento e contas digitais

**Entregas:**

- Catálogo de plataformas.
- Cadastro de contas.
- Assistente de provisionamento.
- OAuth e conectores iniciais.
- Integração com blog.
- Integração de e-mail.
- Monitor de saúde das contas.
- Inventário de integrações.

**Critérios de conclusão:**

- Registro de conta externa.
- Autorização validada.
- Teste de integração.
- Tratamento de autorização expirada.
- Auditoria das conexões e revogações.

## Fase 3 — Produção editorial e IA

**Entregas:**

- AI Content Studio.
- Bíblia de Identidade operacional.
- Biblioteca de prompts.
- Pesquisa editorial.
- Conteúdo versionado.
- Adaptação multicanal.
- Calendário.
- Workflows n8n.
- Políticas de aprovação.

**Critérios de conclusão:**

- Produção usando persona correta.
- Geração de conteúdo em formatos diferentes.
- Revisão de conteúdo.
- Publicação controlada por conector autorizado.
- Registro de custos e execuções.

## Fase 4 — Relacionamento

**Entregas:**

- Inbox central.
- Contatos e consentimentos.
- WhatsApp Business Platform.
- Telegram.
- Encaminhamento a operadores.
- Sugestões de respostas.
- Histórico de atendimentos.

**Critérios de conclusão:**

- Webhooks seguros.
- Mensagens deduplicadas.
- Respeito a consentimentos.
- Transferência humana.
- Tratamento de falhas.

## Fase 5 — Analytics e monetização

**Entregas:**

- Métricas por canal.
- Indicadores por influenciador.
- Comparação temporal.
- Relatórios de desempenho.
- Campanhas comerciais.
- Receitas e custos.
- Afiliados.
- Exportações.

**Critérios de conclusão:**

- Métricas com origem identificada.
- Consolidação por período.
- Custos rastreados.
- Visão financeira por influenciador.
- Relatórios auditáveis.

## Fase 6 — Otimização e escala

**Entregas:**

- Políticas avançadas de automação.
- Recomendações editoriais.
- Otimização de processamento.
- Bibliotecas de templates.
- Aprimoramento de agentes.
- Expansão de conectores.
- Testes de carga.
- Painel de custos e eficiência.

**Critérios de conclusão:**

- Operação estável dentro dos limites definidos.
- Falhas isoladas por conector e identidade.
- Alertas funcionando.
- Rotinas de recuperação documentadas.
- Capacidade de expansão validada.

---

# 11. Requisitos não funcionais gerais

## 11.1. Segurança

**NFR-SEC-001:** autenticação obrigatória para todas as áreas administrativas.

**NFR-SEC-002:** MFA para funções críticas.

**NFR-SEC-003:** TLS em conexões externas.

**NFR-SEC-004:** segredos fora do código-fonte e de tabelas de aplicação.

**NFR-SEC-005:** RLS e validação contextual no backend.

**NFR-SEC-006:** auditoria de alterações privilegiadas.

**NFR-SEC-007:** prevenção de vazamento de dados entre organizações.

**NFR-SEC-008:** validação e sanitização de entradas.

**NFR-SEC-009:** proteção contra abusos, CSRF e execução indevida de ações.

**NFR-SEC-010:** segregação de identidades técnicas e humanas.

## 11.2. Desempenho

Metas iniciais para testes de aceitação, sujeitas a dimensionamento:

- p95 das respostas de API comuns inferior a 800 ms, excluindo provedores externos.
- p95 da navegação administrativa principal inferior a 2,5 s em condições de teste definidas.
- Tarefas de mídia e IA sempre assíncronas.
- Paginação para listas extensas.
- Limites de concorrência configuráveis.
- Interfaces responsivas em dispositivos móveis.

## 11.3. Disponibilidade

- Meta inicial de 99,5% de disponibilidade mensal da aplicação, excluindo indisponibilidade de terceiros e observadas as condições de infraestrutura.
- Health checks de serviços.
- Alertas de indisponibilidade.
- Reinício controlado de workers.
- Rotinas de recuperação.
- Backups externos.
- Documentação de incidentes.

Uma única VPS representa ponto único de falha. Alta disponibilidade real exigirá infraestrutura adicional.

## 11.4. Privacidade

- Minimização de dados.
- Classificação de informações pessoais.
- Controle de acesso.
- Consentimentos por finalidade, quando apropriados.
- Retenção definida.
- Exclusão ou anonimização conforme obrigação aplicável.
- Registro de solicitações de titulares.
- Acesso restrito a documentos.
- Avaliação das obrigações legais dos territórios envolvidos, incluindo LGPD e outras legislações aplicáveis.

## 11.5. Internacionalização

A interface deverá utilizar chaves de tradução para PT-BR, EN e ES.

Conteúdo editorial deverá armazenar idioma separadamente.

Timezones deverão ser associados a organizações, usuários, influenciadores e jobs quando necessário.

Datas serão persistidas de forma consistente, preferencialmente UTC, com conversão de apresentação.

## 11.6. Observabilidade

Cada tarefa deverá produzir identificadores de correlação.

Logs deverão incluir:

- Serviço.
- Evento.
- Organização.
- Influenciador, quando aplicável.
- Identificador da execução.
- Resultado.
- Duração.
- Código de erro.
- Tentativas.

Informações sensíveis deverão ser mascaradas.

---

# 12. Critérios globais de aceitação do produto

O sistema será considerado funcional quando for possível:

1. Criar uma organização e conceder acesso seguro aos operadores.
2. Cadastrar um influenciador humano, com direitos e contratos.
3. Cadastrar um influenciador virtual, com Bíblia de Identidade.
4. Criar um influenciador híbrido, com autorizações específicas.
5. Executar onboarding e aprovar uma identidade.
6. Registrar e vincular contas oficiais permitidas.
7. Identificar claramente contas desconectadas ou restritas.
8. Configurar agentes específicos para cada identidade.
9. Produzir conteúdo com base nas instruções corretas.
10. Revisar e aprovar uma versão de conteúdo.
11. Agendar e publicar por uma integração autorizada.
12. Detectar e registrar falhas de publicação.
13. Receber mensagens dos canais configurados.
14. Responder ou encaminhar mensagens conforme consentimento.
15. Consultar métricas e custos identificando suas fontes.
16. Bloquear acessos indevidos entre organizações.
17. Suspender uma identidade sem afetar as demais.
18. Revogar acesso de um operador.
19. Restaurar dados após um procedimento de backup.
20. Consultar trilha de auditoria das operações críticas.

---

# 13. Premissas, dependências e riscos

## Premissas

- A empresa manterá responsabilidade administrativa pela infraestrutura.
- As contas das plataformas serão criadas e autorizadas por responsáveis legítimos.
- A monetização dependerá das regras e elegibilidade de cada provedor.
- A automação será restrita às capacidades oficialmente disponíveis.
- A operação contará com equipe humana para assuntos administrativos e editoriais sensíveis.

## Dependências

- VPS dimensionada e segura.
- DNS e certificados.
- Credenciais de desenvolvedor.
- Aprovação de integrações externas.
- Provedor de e-mail.
- Provedor de IA.
- Sistema de backup.
- Operadores e políticas internas.
- Contratos e direitos.

## Riscos prioritários

| Risco | Impacto | Mitigação |
|---|---|---|
| Bloqueio de conta | Alto | Compliance e operação oficial |
| Perda de credenciais | Crítico | Cofre, MFA e recuperação |
| Falha da VPS | Crítico | Backup externo e restauração |
| Uso indevido de IA | Alto | Políticas e aprovação |
| Conteúdo com direitos indevidos | Alto | Proveniência e revisão |
| Vazamento de contatos | Crítico | Isolamento e privacidade |
| Falha de automação | Médio/alto | Filas, retry e auditoria |
| Mudança de API | Alto | Conectores desacoplados |
| Custo excessivo de IA | Médio | Limites, métricas e fallback |
| Disputa de titularidade | Alto | Contratos e inventário |

---

# 14. Transição do Projeto Conceitual para o PRD

O presente documento define **o que a plataforma deverá fazer, por que cada módulo existe, quais informações serão administradas e como os fluxos deverão funcionar**.

O PRD técnico subsequente deverá converter essas definições em especificações implementáveis.

## Entregáveis obrigatórios do PRD

**PRD-A — Produto e UX**
- Sitemap definitivo.
- Fluxos de navegação.
- Wireframes de todas as telas.
- Estados de loading, vazio, erro e sucesso.
- Design system.
- Componentes reutilizáveis.
- Acessibilidade e responsividade.

**PRD-B — Dados**
- Modelo entidade-relacionamento.
- SQL de criação de todas as tabelas.
- Constraints e índices.
- Chaves estrangeiras.
- Enums.
- Triggers necessários.
- Políticas RLS.
- Migrações.
- Seeds e dados de teste.

**PRD-C — Backend**
- Contratos REST e eventos.
- Payloads.
- Validações.
- Autorização.
- Tratamento de erros.
- Serviços por domínio.
- Rate limiting.
- Idempotência.

**PRD-D — Automação**
- Especificação de cada workflow n8n.
- Entradas e saídas.
- Credenciais e permissões.
- Regras de retries.
- Filas.
- Timeouts.
- Estados de execução.
- Alertas.

**PRD-E — Integrações**
- Conectores.
- OAuth.
- Webhooks.
- Capacidades.
- Erros.
- Versões de API.
- Requisitos de aprovação dos provedores.

**PRD-F — Infraestrutura**
- Diagramas de rede.
- Serviços Docker.
- Configuração Easypanel.
- Supabase Self-Hosted.
- Volumes.
- Segredos.
- Backup.
- Observabilidade.
- CI/CD.
- Segurança e disaster recovery.

**PRD-G — Qualidade**
- Casos de teste.
- Testes unitários e integrados.
- E2E.
- Segurança.
- Testes de carga.
- Critérios de aceite.
- Estratégia de homologação.

## Ordem de construção recomendada

Infraestrutura → Autenticação → Governança → Identity Manager → Cadastro e integração de contas → Conteúdo → Aprovações → Automação → Relacionamento → Analytics → Monetização.

**Decisão arquitetural final:** o Identity Manager será o sistema de registro das identidades; o backend será a autoridade de negócio e autorização; o Supabase Self-Hosted será a infraestrutura de dados e autenticação; o n8n será o executor de automações; os conectores oficiais serão os únicos responsáveis pelas ações programáticas nas plataformas externas.

Essa separação será obrigatória no PRD e no desenvolvimento.

---

**Fim do Projeto Conceitual — Versão 2.0**

**Documento-base para a próxima etapa: PRD completo de desenvolvimento da Digital Influencer Management Platform.**
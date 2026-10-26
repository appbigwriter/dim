# DIM — Plano de Ação por Sprints e User Stories

**Base:** `DIM-PRD-v1.0.md`, 24/10/2026.  
**Banco:** Supabase Self-Hosted, schema `custom_dim`. **Deploy:** VPS/Easypanel.  
**Cadência proposta:** 10 sprints de duas semanas (20 semanas), sujeito à capacidade do time e permissões externas. Não constitui prazo contratual.  
**Estimativa:** pontos Fibonacci aproximados, para refinamento em planning.  
**Regra:** nenhuma sprint autoriza publicar por API sem permissão efetiva da plataforma.

## Esclarecimento do escopo aprovado — 25/10/2026

O produto deve contemplar **Blogs, Instagram, Facebook, X, WhatsApp, Telegram, E-mail, YouTube e CRM para todos os influenciadores**, respeitando titularidade e permissões próprias. O recorte de MVP com um conector social não substitui esse escopo integral. Uma identidade ativa e um canal conectado não comprovam a entrega da operação completa.

A conferência em `docs/channel-coverage.md` identifica código ausente para Blogs, Instagram, Facebook, E-mail e YouTube. Cadastro no catálogo não conta como integração entregue. O CRM é módulo interno e não exige uma conta social externa; seus fluxos precisam estar funcionais por identidade.

O aceite integral exige, por canal: cadastro/titularidade legítimos; vínculo à identidade; integração oficial; capacidades mínimas verificadas; criação e entrega do formato correspondente; status/erros auditados; e homologação real. A matriz de canais da ficha mostra cada pendência e não declara prontidão integral enquanto essas condições não forem comprovadas.

## Critérios de pronto globais

História entregue somente após PR revisado, migration reversível ou expand/contract documentado, API tipada e validada, autenticação/RBAC, checagem de tenant, logging com correlation_id, testes unitários/integrados, casos de erro, atualização do runbook e homologação de produto. Alteração em conta externa exige idempotência e auditoria. As histórias de segurança exigem teste negativo cross-tenant. O backend não deve aceitar `organization_id` do cliente como autoridade.

## Os 10 itens do PRD → sprints

| Item | Tema solicitado | Sprints principais | Épico |
|---:|---|---|---|
| 1 | Arquitetura geral do sistema | S00, S01, S09 | EP-00 / EP-01 |
| 2 | Modelo de governança humanos/virtuais | S02 | EP-03 |
| 3 | Matriz de criação/administração das contas | S04 | EP-04 |
| 4 | Estrutura de governança corporativa | S01 | EP-01 / EP-10 |
| 5 | Identity Manager | S03 | EP-02 |
| 6 | Automação editorial e agentes | S06, S07 | EP-06 / EP-07 |
| 7 | WhatsApp, Telegram e relacionamento | S08 | EP-08 |
| 8 | Stack, Supabase e deploy Easypanel | S00, S09 | EP-00 |
| 9 | Fluxo de criação de influenciador | S05 | EP-05 |
| 10 | Plano de implementação por fases | S00–S09, gates abaixo | EP-PM |

## Backlog ordenado


### S00 — Infraestrutura e decisões técnicas

**Alinhamento:** Arquitetura geral + Stack / deploy. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 29.


**ST-001 — Inventariar infraestrutura atual** (5 SP)  
História: Como DevOps, quero mapear Easypanel, Supabase e n8n já instalados.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: Inventário assinado; nenhuma alteração em produção; divergências e TBD-ENV catalogados.  
**Artefatos:** infra; docker; runbook.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-002 — Provisionar ambientes e segredos** (8 SP)  
História: Como DevOps, quero ambientes isolados e segredos gerenciados.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: staging e produção separados; DB/Redis não expostos; TLS ativo; chaves únicas.  
**Artefatos:** compose; secrets; smoke tests.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-003 — Validar backup e recuperação** (8 SP)  
História: Como administrador, quero restaurar Postgres e Storage.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: restauração em staging comprovada; resultados RPO/RTO registrados.  
**Artefatos:** runbook; testes restore.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-004 — CI/CD, health e observabilidade** (8 SP)  
História: Como desenvolvedor, quero deploy seguro e rastreável.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: pipeline lint/test/build; /health; rollback documentado; alertas básicos.  
**Artefatos:** pipeline; dashboards.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S01 — Núcleo corporativo e RBAC

**Alinhamento:** Arquitetura geral + Governança corporativa. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 32.


**ST-005 — Migrar schema custom_dim** (8 SP)  
História: Como engenheiro, quero schema versionado e isolado.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: migration idempotente em banco limpo; 79 tabelas; FKs e índices verificados.  
**Artefatos:** migration 0001; testes schema.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-006 — Auth e MFA administrativo** (8 SP)  
História: Como administrador, quero entrar com MFA e organização ativa.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: sessão expirada não acessa API; admin exige MFA; trilha de login.  
**Artefatos:** /login; Auth API; testes.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-007 — Membership e papéis** (8 SP)  
História: Como gerente, quero conceder acessos por função e escopo.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: membro revogado não executa; escopo influencer/account aplicado; matriz testada.  
**Artefatos:** /settings/users; /roles; endpoints.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-008 — Auditoria e segurança multitenant** (8 SP)  
História: Como auditor, quero histórico sem vazamento entre tenants.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: tentativas cross-tenant negadas; logs sem segredos; alterações críticas auditadas.  
**Artefatos:** /security/audit; testes RLS.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S02 — Governança de humanos e virtuais

**Alinhamento:** Modelo de governança: humanos versus virtuais. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 29.


**ST-009 — Cadastro jurídico e contratos** (8 SP)  
História: Como gestor, quero guardar titularidade e contratos.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: contrato vinculado à identidade; vencimento exibido; Storage privado.  
**Artefatos:** /contracts; contratos API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-010 — Consentimento de imagem/voz** (5 SP)  
História: Como gestor, quero registrar usos autorizados.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: revogação bloqueia uso futuro; evidência preservada por política.  
**Artefatos:** /governance; consent API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-011 — Bíblia de identidade versionada** (8 SP)  
História: Como editor, quero manter persona e fatos canônicos.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: nova versão não altera versão aprovada; comparação disponível.  
**Artefatos:** /persona; versionamento.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-012 — Transparência e direitos de mídia** (8 SP)  
História: Como compliance, quero sinalizar personagem sintético.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: disclosure por canal; asset sem licença válida bloqueia aprovação.  
**Artefatos:** /disclosures; /assets.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S03 — Identity Manager

**Alinhamento:** Módulo Identity Manager. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 26.


**ST-013 — Diretório e busca** (5 SP)  
História: Como operador, quero localizar influenciadores.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: filtros tipo/status/nicho; paginação; escopo org validado.  
**Artefatos:** /influencers; GET API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-014 — Ficha de identidade e perfil** (8 SP)  
História: Como gestor, quero editar perfil e público.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: slug único por organização; campos por tipo; versão concorrente protegida.  
**Artefatos:** /influencers/:id; PATCH API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-015 — Estados e guardas** (8 SP)  
História: Como gestor, quero mudar status com regras.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: não ativar sem direitos/pessoa responsável; evento e histórico registrado.  
**Artefatos:** transition API; status history.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-016 — Mídia e histórico** (5 SP)  
História: Como editor, quero assets com licença e comparação.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: upload privado; metadados; rollback apenas por nova versão.  
**Artefatos:** media tabs; storage.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S04 — Contas digitais e conectores

**Alinhamento:** Matriz de criação e administração das contas. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 32.


**ST-017 — Catálogo e inventário** (8 SP)  
História: Como gestor, quero ver cada conta e seu estado.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: status de cadastro separado de integração; pesquisa e filtros.  
**Artefatos:** /accounts; /connectors.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-018 — Wizard de conta oficial** (8 SP)  
História: Como operador, quero checklist para criar/vincular canal.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: sem automação de cadastro social; responsáveis; evidências auditadas.  
**Artefatos:** /accounts/new; task API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-019 — OAuth e vault refs** (8 SP)  
História: Como administrador, quero conectar conta sem divulgar token.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: state/PKCE quando suportado; scopes registrados; segredo só no cofre.  
**Artefatos:** callback; vault adapter.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-020 — Saúde e capacidades reais** (8 SP)  
História: Como social media, quero saber se posso publicar.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: capabilities verificadas; expiração gera bloqueio; reconectar funciona.  
**Artefatos:** /accounts/:id/health.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S05 — Onboarding de ponta a ponta

**Alinhamento:** Fluxo de criação de um novo influenciador. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 32.


**ST-021 — Wizard 8 etapas com autosave** (8 SP)  
História: Como gestor, quero criar uma identidade em partes.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: retomada de etapa; erros sem perda; formulários condicionais.  
**Artefatos:** /influencers/new.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-022 — Tarefas e aprovação** (8 SP)  
História: Como gestor, quero delegar etapas e validar requisitos.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: tarefas atribuídas; decisão registrada; bloqueadores visíveis.  
**Artefatos:** onboarding task + approval API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-023 — Infraestrutura digital assistida** (8 SP)  
História: Como operador, quero provisionar blog/e-mail legitimamente.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: integração administrativa quando disponível; fallback checklist humano.  
**Artefatos:** n8n identity.onboard.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-024 — Ativação e offboarding** (8 SP)  
História: Como gestor, quero ativar e desligar com segurança.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: pré-condições verificadas; jobs suspensos; relatório final gerado.  
**Artefatos:** /transition; workflow offboard.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S06 — Editorial e agentes

**Alinhamento:** Automação editorial: agentes e fluxos. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 32.


**ST-025 — Pautas e briefing** (8 SP)  
História: Como editor, quero criar briefing com fontes e objetivo.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: campos validados; tema com origem; associação de persona.  
**Artefatos:** /editorial/topics; /studio/new.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-026 — Modelos e agentes restritos** (8 SP)  
História: Como admin, quero agentes por influenciador com limites.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: custo/tokens rastreados; nenhuma credencial de rede para agente.  
**Artefatos:** /agents; n8n content.generate.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-027 — Conteúdo e versões** (8 SP)  
História: Como editor, quero versões imutáveis por idioma/canal.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: hash calculado; diff; links para fontes e mídia.  
**Artefatos:** /studio/:id; versions API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-028 — Verificação e compliance** (8 SP)  
História: Como revisor, quero avaliar fontes e políticas.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: falha crítica bloqueia publicação; decisão explicável.  
**Artefatos:** content.verify; compliance workflow.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S07 — Aprovação, publicação e calendário

**Alinhamento:** Automação editorial + contas. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 37.


**ST-029 — Central de aprovações** (8 SP)  
História: Como diretor editorial, quero aprovar versão exata.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: hash e policy version associados; mudanças invalidam aprovação.  
**Artefatos:** /approvals; approvals API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-030 — Calendário e agendamento** (8 SP)  
História: Como editor, quero planejar publicação por canal.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: timezone tratado; bloqueio em conta inválida; visual mês/semana.  
**Artefatos:** /editorial/calendar.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-031 — Workers e conector autorizado** (13 SP)  
História: Como operador, quero publicar sem duplicidade.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: idempotency key; backoff; rate limit; external ID quando sucesso.  
**Artefatos:** BullMQ; social.publish.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-032 — Erros e DLQ** (8 SP)  
História: Como suporte, quero corrigir falhas de publicação.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: erro classificável; retry seguro; reconciliação de resultado incerto.  
**Artefatos:** /publications; dashboards.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S08 — Inbox: WhatsApp e Telegram

**Alinhamento:** WhatsApp, Telegram e relacionamento. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 42.


**ST-033 — Webhooks autenticados e deduplicação** (8 SP)  
História: Como operador, quero mensagens confiáveis no sistema.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: replay negado; hash/event ID deduplicado; fila assíncrona.  
**Artefatos:** /webhooks; webhook_events.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-034 — CRM e consentimentos** (8 SP)  
História: Como atendimento, quero ver contato e preferências.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: opt-out bloqueia marketing; associação de pessoas sem fusão automática.  
**Artefatos:** /contacts; /consents.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-035 — Inbox e handoff** (13 SP)  
História: Como atendente, quero assumir e transferir conversa.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: escopo org/influencer; histórico; notas internas; SLA.  
**Artefatos:** /inbox; conversations API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-036 — Telegram e WhatsApp oficiais** (13 SP)  
História: Como operador, quero usar bots/canais e Business Platform.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: config validada por provedor; templates/janelas checados; logs.  
**Artefatos:** adapters; inbox.triage.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


### S09 — Monetização, métricas e escala

**Alinhamento:** Arquitetura + Plano por fases. **Meta:** concluir um incremento demonstrável. **Pontos sugeridos:** 37.


**ST-037 — Métricas de publicações** (8 SP)  
História: Como gestor, quero dados com origem e frescor.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: amostras imutáveis; falha marcada stale; comparações por período.  
**Artefatos:** /analytics; social.metrics.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-038 — Campanhas e entregáveis** (8 SP)  
História: Como comercial, quero acompanhar patrocínios.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: escopos por identidade; entregáveis e vencimentos.  
**Artefatos:** /campaigns; campaign API.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-039 — Receitas/custos e relatórios** (8 SP)  
História: Como gestor, quero resultados rastreáveis.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: moeda explícita; custos IA conciliáveis; exportações autorizadas.  
**Artefatos:** revenue/cost API; dashboard.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**ST-040 — Teste de escala e operação** (13 SP)  
História: Como DevOps, quero validar carga e recuperação.  
**Aceite (Given/When/Then):** Dado o contexto e as permissões válidas, quando o fluxo da história for executado, então: 10/50/100 influencers em cenários; restore mídia/DB; alertas.  
**Artefatos:** load report; runbooks.  
**Testes mínimos:** cenário positivo, validação inválida, falta de permissão, isolamento organizacional (quando aplicável) e falha externa simulada.


**Gate de sprint:** demonstração end-to-end, QA e segurança aprovados; débitos e bloqueadores registrados.


## Marcos de release e dependências

| Release | Sprints | Capacidade disponível | Critério de passagem |
|---|---|---|---|
| R0 — Infra segura | S00 | ambientes, Auth base, backup | restore real e serviços privados |
| R1 — P0 Operação de identidades | S01–S05 | organizações, RBAC, tipos, contratos, contas e onboarding | ativar identidade sob políticas e separar tenants |
| R2 — P1 Editorial | S06–S07 | Studio, agentes, aprovação, calendário, publicação autorizada | uma publicação teste com auditoria e retry seguro |
| R3 — P2 Relacionamento e comercial | S08–S09 | inbox, métricas, campanhas, custos | opt-out, webhook dedupe e reconciliação |

### Caminho crítico

Inventário real da VPS → validação do Supabase → migration e Auth → RBAC/RLS → Identity Manager → direitos → contas → onboarding → publicação aprovada. WhatsApp/Telegram e integrações sociais precisam de credenciais e permissões oficiais, podendo ficar sob feature flag sem bloquear os demais módulos.

### Dependências externas e bloqueadores

- `prd/dim-dev-doc.md` localizado na implementação: domínio, serviço e Supabase central documentados; rede, volumes, versões e credenciais ainda exigem inventário remoto.
- Plataforma CMS de blogs ainda a definir.
- Definir cofre de segredos, backup fora da VPS e SMTP.
- Confirmar permissões de Meta/X/WhatsApp e responsabilidades por dados pessoais.
- Definir política financeira por moeda e região.

## Rotina de execução

Planejamento no primeiro dia da sprint; daily de 15 minutos; refinamento na metade; review funcional; retrospectiva e atualização da matriz de riscos. Story só entra em desenvolvimento quando estão definidos critérios Given/When/Then, design, contrato de dados/API, responsável e dependências. Bugs de isolamento e perda de dados bloqueiam release.

## Checklist de verificação SQL (antes de produção)

1. Fazer backup da instância e confirmar versão Postgres/Supabase; executar apenas em staging inicialmente.
2. Confirmar existência de `auth.users` e papéis `service_role`, `authenticated`, `anon`.
3. Aplicar `DIM-custom_dim-0001.sql` num banco staging limpo, via migration controlada e papel administrador.
4. Verificar contagem de tabelas, constraints, FKs, índices, triggers e RLS.
5. Executar testes insert cross-tenant com organização A referenciando registro da B: deve falhar.
6. Confirmar que `anon` e `authenticated` não recebem acesso direto às tabelas do schema.
7. Exercitar Auth, RBAC e serviços pelo backend e revisar a possibilidade de uso de `service_role` apenas no servidor.
8. Testar append-only da auditoria, deduplicação de webhook e idempotência de publicação.
9. Verificar backup/restore PostgreSQL + objetos Storage e as permissões dos buckets.
10. Aplicar a produção somente após revisão das diferenças de versão e aprovação da equipe responsável.

**Observação de segurança:** O SQL entregue é uma migration-base de estrutura, não uma autorização direta ao navegador para acessar todas as tabelas. O isolamento nas rotas da API e as políticas RLS especializadas devem ser validados com testes; o `service_role` ignora RLS no Supabase. A auditoria crítica idealmente terá um papel SQL de escrita somente por procedimento dedicado, a ser refinado antes da produção.

## Registro da implementação — 24/10/2026

Código implementado na raiz deste projeto em `apps/`, `packages/`, `supabase/`, `infra/`, `n8n/` e `tests/`. As 40 Stories foram rastreadas individualmente em [docs/implementation-status.md](../docs/implementation-status.md), com evidências, lacunas e dependências externas. Execute `npm run check` para validação local e consulte [README.md](../README.md) e [runbook](../docs/runbook.md) para configurar o ambiente.

Os testes locais não encerram automaticamente os gates acima. Deploy, publicação oficial, restauração remota, PR revisado e homologação continuam condicionados às evidências e permissões reais do ambiente. As Stories parcialmente implementadas estão explicitamente identificadas na matriz; não foram marcadas como concluídas por haver apenas scaffolding ou configuração de exemplo.

## Integração obrigatória Audience Builder → executor DIM — 25/10/2026

O Audience Builder gere persona, trajetória de autoridade e gestão editorial do blog. O DIM executa as ações aprovadas e devolve resultados. Preservar origem canônica no Authority Engine, contexto por tenant/projeto/persona e governança por versão/hash. A implementação não pode duplicar a gestão da persona ou do blog.

| Item | Aceite | Estado verificado |
| --- | --- | --- |
| ABDIM-001 — Contexto e vínculo por identidade | Pacote aprovado compatível com a origem, tenant/projeto, hashes, histórico, idempotência, persona somente leitura, invalidação de conteúdo e testes negativos | Local nos dois projetos; readback produtivo Authority exige configuração real |
| ABDIM-002 — Export persistido no Audience | API oficial autenticada, readback real e contexto completo por tenant/projeto | Local JSON/Supabase append-only; smoke HTTP passou; domínio estratégico legado ainda não alimenta automaticamente o read model |
| ABDIM-003 — Pedidos aprovados e execução DIM | Ação/canal/destino concretos, aprovação exata, contexto vigente, idempotência, guards e adaptador operacional para cada canal do escopo | Publicações implementadas com executor separado e revisão local; contratos específicos de conversa/CRM e formatos adicionais pendentes |
| ABDIM-004 — Resultados de volta ao Audience | Receipt idempotente, IDs externos/evidências, custos, erros e métricas; `uncertain` sem reenvio cego | Recibos básicos/receptor/outbox/backoff locais; custos/métricas completos e homologação pendentes |
| ABDIM-005 — Blog e homologação ponta a ponta | Audience gere editorial/blog; DIM executa ação aprovada via runtime oficial; testar mudança/revogação e retorno para todos os canais | Gateway WordPress na origem com intent/replay/revogação testados; provisionamento e homologação real pendentes |

Especificação verificável: `docs/audience-integration.md`. Nenhum item pendente é considerado entregue pelo simples registro nesta tabela.

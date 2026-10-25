# Execução do plano S00–S09

Data: 25/10/2026. Base: `prd/DIM-PRD-v1.0.md`, `prd/DIM-Plano-de-Acao-Sprints-Stories.md` e `prd/dim-dev-doc.md`.

**Entrega de engenharia local, sem publicação em produção.** Foram criados o monorepo, cinco migrations, aplicação Web/API/worker, conectores, testes e documentação. A matriz abaixo registra as 40 Stories; nenhuma linha representa homologação de produto, PR aprovado ou gate de infraestrutura assinado.

Legenda: **Local** = comportamento implementado/verificado no alcance local; **Parcial** = há implementação e lacunas funcionais identificadas; **Externo** = artefatos preparados, execução depende do ambiente real. Gates R0–R3 continuam abertos até os requisitos globais do plano serem homologados.

| Sprint | Story | Estado | Evidência implementada | Pendência para aceite integral |
| --- | --- | --- | --- | --- |
| S00 | ST-001 | Externo | `infra/inventory.ps1`; fatos e divergências do dev-doc em `docs/architecture.md` | Inventário remoto e assinatura do operador; versões, redes, volumes e recursos |
| S00 | ST-002 | Externo | Compose por APP_ENV, portas privadas, env template, Vault, containers sem root | Provisionar staging/prod reais, TLS, ACL de rede e segredos no Easypanel |
| S00 | ST-003 | Externo | Scripts Restic/pg_dump/rclone; teste de restauração local de banco e mídia com checksum | Restaurar Supabase e Storage em staging e medir RPO/RTO remotos |
| S00 | ST-004 | Parcial | CI lint/test/typecheck/audit/build; health, métricas e regras de alerta; rollback | Executar pipeline remota, CodeQL no GitHub, instalar monitor/alertas e demonstrar rollback |
| S01 | ST-005 | Local | 79 tabelas originais + 2 de integração Audience, 5 migrations com checksum; replay pelo runner, FKs/RLS/immutabilidade testados | Conferir versão do Supabase real, grants, advisors e migration em staging |
| S01 | ST-006 | Parcial | Login Supabase/TOTP, MFA em privilégios, validação de expiração/sessão e membership | Homologar GoTrue/MFA/SMTP real; eventos de sessão verificada já auditados; homologar trilha no Auth real |
| S01 | ST-007 | Local | Convites Auth com validade/aceitação verificada, idempotência, sessões listadas e revogação por organização/MFA; UI e testes | Homologar SMTP/GoTrue real e ciclo completo de convite |
| S01 | ST-008 | Local | RLS sob dim_app, tenant FKs, auditoria append-only, redaction, testes negativos API/DB/Storage | Revisão independente e validação no ambiente Self-Hosted |
| S02 | ST-009 | Local | Titulares/contratos versionados e datas; objetos privados; validação de documento clean | Bucket/cofre/ClamAV reais, homologação jurídica e retenção |
| S02 | ST-010 | Local | Consentimentos append-only, revogação histórica, cancelamento de jobs e guarda por canal | Homologar usos/escopos jurídicos e política de prova |
| S02 | ST-011 | Parcial | Persona imutável por versão; histórico consultável; nova versão para rollback | Comparação das duas últimas versões disponível; homologar revisão/aprovação de persona |
| S02 | ST-012 | Local | Disclosures por plataforma; licença expirada e disclosure ausente bloqueiam aprovação/publicação | Homologar termos e escopos de licenças reais |
| S03 | ST-013 | Local | Diretório, busca, tipo/status/nicho, paginação e escopos aplicados antes do limite | QA com volume e dados reais |
| S03 | ST-014 | Parcial | Perfil, público, slug único, edição de identidade com row_version/409 | Concorrência no perfil complementar implementada; completar UI especializada por tipo |
| S03 | ST-015 | Local | Máquina de estados, guardas de direitos/ativação, histórico/outbox e testes dos três tipos | Aprovar políticas e checklists finais de ativação |
| S03 | ST-016 | Parcial | Upload privado com MIME/AV, metadados/checksum, versões imutáveis e nova versão de rollback | Homologar Storage/AV real e comparação visual de mídias |
| S04 | ST-017 | Local | Catálogo, inventário, status de conta separado de integração e filtros | Popular contas e capacidades reais |
| S04 | ST-018 | Parcial | Checklist automático por conta, responsáveis/evidências e conclusão auditada | Wizard guiado especializado para cada provedor |
| S04 | ST-019 | Local | OAuth X state único/expirável/S256, conferência de titular, vault-only; callback simulado testado | App X e escopos reais; refresh automático e demais OAuth não habilitados |
| S04 | ST-020 | Parcial | Monitor periódico de Telegram/WhatsApp/X no worker, histórico de saúde, falha fecha capacidades, proteção contra revogação concorrente | Granularidade de planos, refresh OAuth e homologação externa |
| S05 | ST-021 | Local | Wizard guiado nas oito etapas, campos condicionais por tipo, autosave e retomada por URL; navegador verificado | QA dos provedores reais, documentos e evidências no Storage real |
| S05 | ST-022 | Local | Delegação por formulário, evidência privada vinculada à identidade e validação de todas as etapas/tarefas na ativação | Homologação com equipe e documentos reais |
| S05 | ST-023 | Externo | Workflow/checklist humano explícito, sem cadastro social automatizado | Definir CMS/e-mail e validar APIs administrativas; fluxo n8n específico |
| S05 | ST-024 | Parcial | Ativação com guardas; suspensão de jobs/agentes; revocation_pending e relatório de offboarding | Revogação/transferência no provedor segundo titularidade e confirmação final humana |
| S06 | ST-025 | Local | Pautas com fontes, briefs por identidade e conteúdo com objetivos | UX de briefing ampliado e pesquisa especializada |
| S06 | ST-026 | Parcial | Agentes restritos, orçamento/tokens/custos e reconciliação de reserva após falha com comprovante, MFA, moeda e evento financeiro único | n8n/LLM reais, preços aprovados e agentes especializados de pesquisa/triagem |
| S06 | ST-027 | Local | Versões por idioma/formato, hash, fontes/mídias, histórico e comparação das duas últimas versões | Diff visual completo e editor multimodal |
| S06 | ST-028 | Parcial | Verificador determinístico, direitos/licenças/fontes/disclosure e flags explicáveis | Checagem factual das fontes e políticas de risco configuráveis |
| S07 | ST-029 | Local | Revisão por outro ator, hash + policy version, versão atual e invalidação após mudança | Quórum de aprovadores configurável implementado; homologar política editorial |
| S07 | ST-030 | Local | Semana/mês navegáveis, arrastar ou editar reagendamento, concorrência por versão, UTC/fuso e tratamento de gaps/folds DST testados | Homologação de uso real e QA móvel do arrastar |
| S07 | ST-031 | Parcial | Worker BullMQ/outbox, claim SQL, Telegram/X, external ID, idempotência e testes com provedor simulado | Redis real e publicação oficial de teste; homologar limites distribuídos por provedor/conta |
| S07 | ST-032 | Local | Erros classificados, backoff, DLQ, uncertain sem reenvio e reconciliação com evidência/MFA | Exercício de falha/retomada real no Redis/provedor |
| S08 | ST-033 | Local | Assinatura WhatsApp, segredo Telegram por conta, dedupe e fila durável; testes de assinatura adulterada e replay | Configurar webhooks e homologar eventos/status de entrega dos provedores |
| S08 | ST-034 | Parcial | Vínculo manual sem transferir consentimento, exportação autorizada, pedidos do titular para revisão humana e retenção configurável | Execução operacional de retenção/exclusão com regras jurídicas e filtros ampliados |
| S08 | ST-035 | Parcial | Inbox três painéis, não lidas com dedupe, tags, leitura, notas/handoff e SLA configurável; atualização por polling | Realtime e conjunto completo de filtros/automação de escalonamento |
| S08 | ST-036 | Parcial | Telegram Bot/WhatsApp Cloud, opt-in/janela configurável, paginação completa e variáveis BODY ordenadas; componentes não suportados bloqueiam | Business aprovado, headers/botões/mídia e homologação da versão Graph |
| S09 | ST-037 | Parcial | Coleta periódica de public_metrics X, amostras imutáveis, ausência sem zero inventado e comparação por período/provedor/moeda | Coleta dos demais provedores, escopos/planos e API real homologados |
| S09 | ST-038 | Local | Parceiros, campanhas, vínculo de identidades, entregáveis/prazos e estados | Homologação dos processos comerciais e patrocínios reais |
| S09 | ST-039 | Local | Eventos financeiros imutáveis, moeda explícita, custos IA conciliáveis, relatório com permissão | Regras por jurisdição, exportação contábil e reconciliação financeira real |
| S09 | ST-040 | Externo | Carga local 10/50/100, recuperação local banco+mídia, alertas e runbook | Carga concorrente em VPS com mídia/Redis/terceiros, restore remoto e SLO observado |

## Verificação realizada

Rodada adicional de 25/10: ESLint e TypeScript sem erros; suíte completa com 19 testes aprovados; cinco testes de conclusão/canais repetidos após a revisão da cobertura, todos aprovados; build Next.js de produção concluído. OpenAPI regenerado com 147 paths. As duas cópias da quarta migration têm SHA-256 idêntico. Serviços e banco descartáveis de navegador foram encerrados.


- Lint ESLint, TypeScript e build Next.js executados localmente.
- Testes automatizados em `tests/`: schema/constraints/RLS, API/auth/MFA/tenant/concorrência, onboarding humano/virtual/híbrido, aprovação exata, idempotência, resultado incerto, revogação, consentimento, webhook, OAuth, AV/Storage, agentes/custos e recuperação.
- Carga: 120 requisições sequenciais por cenário de 10, 50 e 100 identidades, sem erros no relatório local. Os resultados não medem rede, Redis, disco da VPS ou terceiros.
- Browser adicional: wizard guiado, nova identidade, persona com campos, autosave e retomada por URL/reload; evidência `docs/screenshots/onboarding-guided-local.png`.
- Browser: login com GoTrue/API de teste descartáveis em loopback, dashboard autenticado, criação pelo wizard e fluxo de autosave. Nenhuma credencial externa foi usada.
- `docker compose config` validado. Build/execução de containers não realizado: daemon Docker local desligado.
- npm audit: sem vulnerabilidades reportadas no lockfile na instalação; repetir no gate de release.

## Integração com Audience Builder — 25/10/2026

O DIM é executor; o Audience Builder gere persona, trajetória de autoridade e blog/editorial. Novas identidades usam a origem Audience. Foram implementados vínculo, sincronização autenticada, validação do contrato real de persona, hashes/aprovação, histórico imutável/RLS, interface somente leitura e invalidação de conteúdo/jobs. A suíte passou com 24 testes e a fixture foi aceita pelo validador real do checkout Audience.

A quinta migration acrescenta `audience_bindings` e `audience_context_versions`, preservando as 79 tabelas originais. A integração remota completa **continua pendente**: export persistido no Audience, pedidos aprovados de execução, adaptadores faltantes e receipts/resultados de retorno. Detalhes em [audience-integration.md](audience-integration.md).

## Cobertura dos canais aprovada

O escopo inclui Blogs, Instagram, Facebook, X, WhatsApp, Telegram, E-mail, YouTube e CRM para todas as identidades. **A implementação ainda não cobre todos de ponta a ponta.** A matriz por identidade está na Web e em `GET /api/v1/influencers/:id/channels`; o estado detalhado e as lacunas estão em [channel-coverage.md](channel-coverage.md). YouTube foi incluído no catálogo nesta revisão, sem simular um conector funcional.

## Lacunas transversais

Interface principal PT-BR; idiomas de conteúdo PT-BR/EN/ES e formatação regional existem, mas tradução integral da interface ainda não foi entregue. Alguns comandos administrativos avançados usam editor JSON e referências de UUID. A acessibilidade tem controles rotulados, foco, responsividade e mensagens de erro; WCAG 2.2 AA completa e testes móveis visuais ainda precisam de homologação. Os requisitos globais de PR revisado, produto homologado e gates remotos não foram substituídos por testes locais.

## Impedimentos externos confirmados

Não há `.env` de runtime, credenciais DB/Auth/Vault/n8n, acesso autorizado à VPS/Easypanel, app X/Business WhatsApp, bucket/AV configurados ou backup remoto no checkout. Esses valores não foram inventados. Os módulos falham fechados até serem configurados. Nenhum deploy, publicação social, convite real ou envio de mensagem foi efetuado.



# Execução do plano S00–S09

Data: 25/10/2026. Base: `prd/DIM-PRD-v1.0.md`, `prd/DIM-Plano-de-Acao-Sprints-Stories.md` e `prd/dim-dev-doc.md`.

**Entrega de engenharia local, sem publicação em produção.** Foram criados o monorepo, seis migrations, aplicação Web/API/worker, conectores, testes e documentação. A matriz abaixo registra as 40 Stories; nenhuma linha representa homologação de produto, PR aprovado ou gate de infraestrutura assinado.

Legenda: **Local** = comportamento implementado/verificado no alcance local; **Parcial** = há implementação e lacunas funcionais identificadas; **Externo** = artefatos preparados, execução depende do ambiente real. Gates R0–R3 continuam abertos até os requisitos globais do plano serem homologados.

| Sprint | Story | Estado | Evidência implementada | Pendência para aceite integral |
| --- | --- | --- | --- | --- |
| S00 | ST-001 | Externo | `infra/inventory.ps1`; fatos e divergências do dev-doc em `docs/architecture.md` | Inventário remoto e assinatura do operador; versões, redes, volumes e recursos |
| S00 | ST-002 | Externo | Compose por APP_ENV, portas privadas, env template, Vault, containers sem root | Provisionar staging/prod reais, TLS, ACL de rede e segredos no Easypanel |
| S00 | ST-003 | Externo | Scripts Restic/pg_dump/rclone; teste de restauração local de banco e mídia com checksum | Restaurar Supabase e Storage em staging e medir RPO/RTO remotos |
| S00 | ST-004 | Parcial | CI lint/test/typecheck/audit/build; health, métricas e regras de alerta; rollback | Executar pipeline remota, CodeQL no GitHub, instalar monitor/alertas e demonstrar rollback |
| S01 | ST-005 | Local | 79 tabelas originais + 4 Audience, 6 migrations espelhadas; replay/FKs/RLS/immutabilidade testados | Aplicar em staging, revisar grants/advisors e homologar Supabase real |
| S01 | ST-006 | Parcial | Login Supabase/TOTP, MFA em privilégios, validação de expiração/sessão e membership | Homologar GoTrue/MFA/SMTP real; eventos de sessão verificada já auditados; homologar trilha no Auth real |
| S01 | ST-007 | Local | Convites Auth com validade/aceitação verificada, idempotência, sessões listadas e revogação por organização/MFA; UI e testes | Homologar SMTP/GoTrue real e ciclo completo de convite |
| S01 | ST-008 | Local | RLS sob dim_app, tenant FKs, auditoria append-only, redaction, testes negativos API/DB/Storage | Revisão independente e validação no ambiente Self-Hosted |
| S02 | ST-009 | Local | Titulares/contratos versionados e datas; objetos privados; validação de documento clean | Bucket/cofre/ClamAV reais, homologação jurídica e retenção |
| S02 | ST-010 | Local | Consentimentos append-only, revogação histórica, cancelamento de jobs e guarda por canal | Homologar usos/escopos jurídicos e política de prova |
| S02 | ST-011 | Local | Persona versionada imutável, origem Audience/Authority aprovada, hashes/histórico e consulta somente leitura; readback produtivo obrigatório | Alimentar read model a partir do domínio estratégico legado e homologar origem real |
| S02 | ST-012 | Local | Disclosures por plataforma; licença expirada e disclosure ausente bloqueiam aprovação/publicação | Homologar termos e escopos de licenças reais |
| S03 | ST-013 | Local | Diretório, busca, tipo/status/nicho, paginação e escopos aplicados antes do limite | QA com volume e dados reais |
| S03 | ST-014 | Local | Perfil especializado humano/virtual/híbrido, campos operacionais com concorrência e persona Audience somente leitura; UI/tenant testados | QA com dados reais, acessibilidade/mobile e homologação |
| S03 | ST-015 | Local | Máquina de estados, guardas de direitos/ativação, histórico/outbox e testes dos três tipos | Aprovar políticas e checklists finais de ativação |
| S03 | ST-016 | Local | Upload privado AV/MIME/checksum; MP4 100 MiB; galeria e comparação de mídia com licença/scan/tenant/URL temporária e descarte de respostas antigas | Homologar Storage/AV/proxy/licenças reais e comparação com mídia real em mobile |
| S04 | ST-017 | Local | Catálogo, inventário, status de conta separado de integração e filtros | Popular contas e capacidades reais |
| S04 | ST-018 | Parcial | Checklist/responsáveis/evidências; conexão Vault e health oficial Telegram/WhatsApp/Meta/Google/CMS/Resend | Wizard OAuth guiado por provedor e criação legítima/homologação das contas |
| S04 | ST-019 | Local | X state único/expirável/PKCE; tokens somente Vault; novos canais validam titular/scopes/expiração e registram autorização oficial configurada | OAuth guiado/refresh Meta/Google/X e homologação dos apps reais |
| S04 | ST-020 | Parcial | Monitor de X/Telegram/WhatsApp/Facebook/Instagram/YouTube/CMS/e-mail; capacidades distintas e falha fecha operação | Refresh, planos/quota, reconexão e homologação real |
| S05 | ST-021 | Local | Wizard guiado nas oito etapas, campos condicionais por tipo, autosave e retomada por URL; navegador verificado | QA dos provedores reais, documentos e evidências no Storage real |
| S05 | ST-022 | Local | Delegação por formulário, evidência privada vinculada à identidade e validação de todas as etapas/tarefas na ativação | Homologação com equipe e documentos reais |
| S05 | ST-023 | Parcial | Gateway Audience e transporte WordPress com intent/receipt; remetente/domínio Resend verificados; sem cadastro social automatizado | Provisionamento legítimo CMS/DNS/e-mail, credenciais e fluxos administrativos reais |
| S05 | ST-024 | Parcial | Ativação com guardas; suspensão de jobs/agentes; revocation_pending e relatório de offboarding | Revogação/transferência no provedor segundo titularidade e confirmação final humana |
| S06 | ST-025 | Local | Pautas com fontes, briefs por identidade e conteúdo com objetivos | UX de briefing ampliado e pesquisa especializada |
| S06 | ST-026 | Parcial | Agentes restritos, orçamento/tokens/custos e reconciliação de reserva após falha com comprovante, MFA, moeda e evento financeiro único | n8n/LLM reais, preços aprovados e agentes especializados de pesquisa/triagem |
| S06 | ST-027 | Local | Versões/hash, diff textual linear, fontes/idioma/formato, comparação de mídias privadas e link de revisão de ação importada | QA multimídia/idiomas com dados reais e homologação |
| S06 | ST-028 | Parcial | Verificador determinístico, direitos/licenças/fontes/disclosure e flags explicáveis | Checagem factual das fontes e políticas de risco configuráveis |
| S07 | ST-029 | Local | Revisão por outro ator, hash + policy version, versão atual e invalidação após mudança | Quórum de aprovadores configurável implementado; homologar política editorial |
| S07 | ST-030 | Local | Semana/mês navegáveis, arrastar ou editar reagendamento, concorrência por versão, UTC/fuso e tratamento de gaps/folds DST testados | Homologação de uso real e QA móvel do arrastar |
| S07 | ST-031 | Parcial | BullMQ/outbox; X/Telegram/Facebook texto, Instagram JPEG, YouTube MP4, blog via Audience/WordPress; aprovação/contexto/conta/horário exatos e revalidação antes de cada mutação | Redis/provedores reais, formatos adicionais, métricas e contratos Audience específicos de conversa/CRM |
| S07 | ST-032 | Local | Erros classificados, backoff, DLQ, uncertain sem reenvio e reconciliação com evidência/MFA | Exercício de falha/retomada real no Redis/provedor |
| S08 | ST-033 | Local | Assinatura WhatsApp, segredo Telegram por conta, dedupe e fila durável; testes de assinatura adulterada e replay | Configurar webhooks e homologar eventos/status de entrega dos provedores |
| S08 | ST-034 | Parcial | Vínculo/export/pedidos, revisão independente MFA, dry-run padrão, apagamento operacional parcial e supressão de reingestão | Execução de retenção em Storage/backups/provedores, regras jurídicas e homologação |
| S08 | ST-035 | Parcial | Inbox três painéis, filtros antes da paginação, histórico/notas/handoff, SLA configurável/escalonamento idempotente, UI e polling | Realtime, agendamento autenticado do SLA e homologação operacional |
| S08 | ST-036 | Local | Telegram/WhatsApp oficiais, opt-in/janelas, templates paginados BODY/header texto ou ID mídia/botões URL/quick reply; componentes inválidos bloqueiam | Business/Graph/contas reais, tipos avançados/named e homologação |
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

## Fundação da integração Audience — histórico anterior à rodada ampliada

O DIM é executor; o Audience Builder gere persona, trajetória de autoridade e blog/editorial. Novas identidades usam a origem Audience. Foram implementados vínculo, sincronização autenticada, validação do contrato real de persona, hashes/aprovação, histórico imutável/RLS, interface somente leitura e invalidação de conteúdo/jobs. A suíte passou com 24 testes e a fixture foi aceita pelo validador real do checkout Audience.

Verificação final desta etapa: build de produção concluído, seis testes direcionados de API/Audience repetidos e aprovados, OpenAPI regenerado com 151 paths e tela de vínculo conferida no navegador descartável (`docs/screenshots/audience-integration-local.png`).

A quinta migration acrescenta `audience_bindings` e `audience_context_versions`, preservando as 79 tabelas originais. A integração remota completa **continua pendente**: export persistido no Audience, pedidos aprovados de execução, adaptadores faltantes e receipts/resultados de retorno. Detalhes em [audience-integration.md](audience-integration.md).

## Cobertura dos canais aprovada

O escopo inclui Blogs, Instagram, Facebook, X, WhatsApp, Telegram, E-mail, YouTube e CRM para todas as identidades. **A operação integral ainda depende das lacunas funcionais e da homologação descritas abaixo.** A matriz está na Web e em `GET /api/v1/influencers/:id/channels`; [channel-coverage.md](channel-coverage.md) apresenta os adaptadores atuais, formatos e limitações. Nesta rodada foram acrescentados Facebook, Instagram, YouTube, Resend e o transporte de blog via Audience/WordPress.

## Lacunas transversais

Interface principal PT-BR; idiomas de conteúdo PT-BR/EN/ES e formatação regional existem, mas tradução integral da interface ainda não foi entregue. Alguns comandos administrativos avançados usam editor JSON e referências de UUID. A acessibilidade tem controles rotulados, foco, responsividade e mensagens de erro; WCAG 2.2 AA completa e testes móveis visuais ainda precisam de homologação. Os requisitos globais de PR revisado, produto homologado e gates remotos não foram substituídos por testes locais.

## Impedimentos externos confirmados

Não há `.env` de runtime, credenciais DB/Auth/Vault/n8n, acesso autorizado à VPS/Easypanel, app X/Business WhatsApp, bucket/AV configurados ou backup remoto no checkout. Esses valores não foram inventados. Os módulos falham fechados até serem configurados. Nenhum deploy, publicação social, convite real ou envio de mensagem foi efetuado.

## Rodada autônoma ampliada — 25/10/2026

Além da fundação anterior, foram implementados export persistido/ações aprovadas/revogação/receipts e transporte WordPress no Audience; intake, revisão local, executor contínuo separado, agenda exata, outbox de retorno e proteção contra duplicidade/regressão no DIM. Os adaptadores Facebook/Instagram/YouTube e Resend possuem HTTP real injetável e testes negativos; não houve envio externo.

A sexta migration acrescenta duas tabelas Audience (total 83), configuração de executor/papel separado, AAL original de publicação, sequência imutável de receipts e backoff de retorno. Runtime sem credenciais falha fechado. Alterar o executor durante uma chamada remota, revogar membership/permissões ou promovê-lo a admin não autoriza o envio.

QA Web descartável: perfil especializado/Audience somente leitura; busca/importação de ação; link para /studio/:id; filtros/SLA de Inbox; diff de duas versões. Evidências: docs/screenshots/audience-execution-local.png, inbox-controls-local.png e content-comparison-local.png. Serviços de teste são restritos a loopback, sem provedor externo.

Smoke HTTP entre os projetos usou Next Audience real e adapters DIM: contexto, ações, receipt/replay, esvaziamento da fila, tenant inválido e revogação. A rodada de testes/build final e a contagem atual estão no registro abaixo; as contagens anteriores são históricas.

### Pendências funcionais que não são apenas credenciais

- Integrar o domínio estratégico legado Audience (projeto/manifest/persona) ao novo read model; produção exige readback Authority configurado.
- Contratos Audience específicos para ações de conversa/CRM e enriquecimento de receipts com métricas/custos.
- OAuth guiado/refresh dos novos canais, formatos adicionais, coleta de métricas além de X e recebimento/delivery/bounce de e-mail.
- Workflow específico de pesquisa/triagem, checagem factual avançada e políticas de risco; dez workflows n8n ainda exigem configuração/handoff.
- Realtime/agendamento de SLA, provisionamento e revogação/transferência externas, retenção de Storage/backups/provedores e homologação global.

Os gates R0–R3 e o aceite integral das 40 Stories permanecem abertos. Implementação local de um comportamento não é homologação de toda a plataforma.

### Verificação final desta rodada

- DIM: npm run check aprovado — ESLint, TypeScript, 51 testes e build Next de produção.
- Audience: TypeScript, 314 testes em 32 arquivos e build de produção com lint aprovados. O teste legado que gravava fixtures no checkout foi isolado no diretório temporário e repetido com sucesso.
- OpenAPI DIM regenerado com 165 paths. Sexta migration espelhada com SHA-256 idêntico: 77353B2A2DC2C1CA86C5387AD19704A79102C502814E5A53F77C178FCFBF3F49.
- Revisões funcionais/segurança identificaram corridas, regressão terminal, AAL indevido e duplicidade por chave alternativa; correções cobertas por testes negativos. O revisor delegado atingiu limite de uso antes de emitir aprovação final; não se declara gate independente formal aprovado.
- Smoke HTTP entre projetos e QA Web desktop locais aprovados; servidores/abas descartáveis encerrados. Sem deploy, migration remota, publicação social ou envio real de e-mail/mensagem.

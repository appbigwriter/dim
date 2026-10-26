# Implementação das Stories S00–S09

Atualizado em 26/10/2026. Base: PRD v1.0, plano de 40 Stories e integração Audience Builder → DIM autorizada pelo usuário.

As 40 Stories possuem implementação ou ferramentas operacionais executáveis. A tabela separa o código entregue da execução/homologação no ambiente real. Credenciais ausentes não foram substituídas por respostas de sucesso, contas fictícias ou contadores artificiais. Os gates R0–R3 não equivalem à conclusão do código: continuam dependendo de implantação, evidências de infraestrutura, revisão e aceite do produto.

| Sprint | Story | Implementação e evidências | Validação externa restante |
| --- | --- | --- | --- |
| S00 | ST-001 | Inventário de fatos/configuração e coletor operacional em `infra/inventory.ps1`; arquitetura e divergências documentadas | Inventário remoto e assinatura do operador |
| S00 | ST-002 | Compose por ambiente, redes/portas privadas, Vault, TLS/deploy e templates sem credenciais | Aplicar em staging/produção e comprovar isolamento/TLS |
| S00 | ST-003 | Backup Restic/pg_dump/Storage com manifestos SHA-256; restauração staging executável com readback e relatório; teste local de recuperação | Executar restore remoto e medir RPO/RTO do ambiente |
| S00 | ST-004 | CI lint/typecheck/tests/build/audit, health, heartbeat, métricas, alertas, imagens por SHA e rollback | Pipeline remota, monitores e exercício de rollback |
| S01 | ST-005 | 7 migrations espelhadas; 79 tabelas originais + 4 Audience + verificação factual = 84; replay, RLS, FKs e imutabilidade testados | Aplicar migrations em staging e revisar grants |
| S01 | ST-006 | Supabase Auth/TOTP, MFA administrativo, sessão/membership revogáveis, auditoria; login local opt-in sem elevar AAL ou criar admin | GoTrue/MFA/SMTP reais |
| S01 | ST-007 | Convites/aceitação, memberships, papéis e escopos; listagem e revogação de sessões | Ciclo real de convites e papéis da equipe |
| S01 | ST-008 | Tenant SQL/RLS, papel dim_app, auditoria append-only, redaction e casos negativos cross-tenant | Revisão independente e Supabase Self-Hosted |
| S02 | ST-009 | Titularidade, contratos, vigência e evidência privada vinculada à identidade | Documentos, antivírus e jurídico reais |
| S02 | ST-010 | Consentimentos imutáveis, revogação, cancelamento de jobs e retenção de prova | Política jurídica de usos e retenção |
| S02 | ST-011 | Persona canônica no Audience/Authority; domínio de projeto/intake/manifesto/estratégia alimenta automaticamente contexto versionado; comparação no DIM | Readback Authority e projeto real aprovados |
| S02 | ST-012 | Disclosures por canal e licença de mídia; bloqueio de aprovação/publicação por ausência ou vencimento | Homologação de licenças e disclosures |
| S03 | ST-013 | Diretório, tipo/status/nicho, pesquisa e paginação com escopos antes do limite | Dados reais e QA de volume |
| S03 | ST-014 | Perfil humano/virtual/híbrido, campos condicionais e concorrência; persona Audience somente leitura | QA de produto/mobile |
| S03 | ST-015 | Transições, pré-condições, responsáveis, histórico/outbox e suspensão segura | Política operacional aprovada |
| S03 | ST-016 | Upload privado, AV/MIME/checksum, galeria/diff e licença; nova versão para rollback | Storage/AV e mídia real |
| S04 | ST-017 | Catálogo, inventário, pesquisa/filtros e estados distintos de cadastro/integração/capacidade | Contas reais vinculadas |
| S04 | ST-018 | Checklist legítimo com responsáveis/provas e componente de autorização guiada por provedor | Cadastro oficial pelo titular quando exigido |
| S04 | ST-019 | X/Google PKCE, Meta OAuth, state único, seleção de contas do grant, titularidade e tokens somente no Vault | Apps, callbacks e permissões oficiais |
| S04 | ST-020 | Health de todos os canais, capacidades verificadas, renovação X/Google/Meta, CAS contra revogação e reconexão | Quotas, planos e homologação oficial |
| S05 | ST-021 | Wizard oito etapas, autosave, retomada e campos condicionais | QA com documentos e contas reais |
| S05 | ST-022 | Delegação, tarefas, evidências privadas e validação das etapas antes da ativação | Revisão da equipe responsável |
| S05 | ST-023 | Workflow de onboarding com tarefas concretas/dedup; Audience gere/provisiona blog com autoria, intent e readback; Resend verifica domínio/remetente; fallback humano previsto no aceite | Infra CMS/DNS/e-mail e atribuição legítima do titular |
| S05 | ST-024 | Ativação por guardas, cancelamento/suspensão, revogação local e relatório; tarefas atribuídas com prova para revogação/transferência oficial | Confirmação do titular/provedor para encerramento externo |
| S06 | ST-025 | Pautas/briefing/fontes/objetivo vinculados à identidade e persona; pesquisa restrita com evidência de fontes | Fontes/editoria reais |
| S06 | ST-026 | Geração, pesquisa, triagem e análise com limite de contexto/tokens/orçamento, relatórios, custo, reconciliação e revisão humana; agentes sem ferramentas ou segredos sociais | Provedor/modelo e preços configurados |
| S06 | ST-027 | Versões imutáveis por formato/idioma, hash, diff, fontes e mídia; ações Audience preservam contexto exato | QA editorial multimídia |
| S06 | ST-028 | Política de risco versionada, termos/frases, fontes HTTPS com DNS/IP fixado, citação efetivamente encontrada e decisão factual independente; falha/stale bloqueiam | Política editorial e avaliação humana dos fatos |
| S07 | ST-029 | Central de revisão, ator independente, quórum, versão/hash/política e invalidação | Homologação de política e responsáveis |
| S07 | ST-030 | Calendário mês/semana, navegação/reagendamento, timezone e conflitos DST/concorrência | QA operacional/mobile |
| S07 | ST-031 | Worker/outbox/BullMQ, idempotência/backoff/rate limit, conectores oficiais e IDs; executor Audience para publicação, conversa e CRM com revalidação antes da mutação | Redis/provedores reais e publicação autorizada de teste |
| S07 | ST-032 | DLQ, erro classificável, uncertain sem reenvio cego e reconciliação com evidência | Exercício real de falha e recuperação |
| S08 | ST-033 | Webhooks WhatsApp/Telegram e Resend assinados, raw body, janela/replay/dedupe, fila e readback | URLs públicas e eventos oficiais |
| S08 | ST-034 | CRM, vínculos sem transferência de consentimento, exportação, pedidos/revisão/erasure; planos de retenção Storage/provedor/backup com segunda aprovação/readback | Política jurídica e destinos efetivos de retenção |
| S08 | ST-035 | Inbox, filtros, histórico/notas/handoff, SSE autenticado com cursor/reconexão/revogação, SLA automático com executor real limitado | Operação real e responsáveis de SLA |
| S08 | ST-036 | Telegram/WhatsApp oficiais; opt-in/janelas, templates BODY/HEADER/mídia/botões e parâmetros posicionais/nomeados; limites do template verificados | Business/Graph/bot reais e templates aprovados |
| S09 | ST-037 | Coleta X/Meta/YouTube/CMS; fatos de entrega e-mail; amostras imutáveis, proveniência, ausência/stale e comparação de períodos; retorno Audience enriquecido | Permissões/quotas e fontes financeiras reais |
| S09 | ST-038 | Parceiros/campanhas/identidades/entregáveis/prazos e workflow de acompanhamento | Processo comercial real |
| S09 | ST-039 | Receita/custo imutáveis, moeda explícita, IA conciliável, exportação autorizada e receipts com custo atribuível | Reconciliação contábil e regras por jurisdição |
| S09 | ST-040 | Cenários locais 10/50/100, recuperação DB+mídia; benchmark HTTPS staging concorrente `scripts/load-live.ts`, alertas e runbook | Carga/restore reais na VPS e SLO observado |

## Integração Audience

O Audience mantém projeto, persona/manifesto, estratégia de autoridade e blog. Seus comandos persistem o domínio e materializam o contexto automaticamente, inclusive read-repair após interrupção. O DIM importa somente ações aprovadas, exige revisão local independente e executa `publication`, `message` ou `crm_update` no destino aprovado. O resultado volta por outbox/receipt idempotente com erro, ID externo, evidência, métrica/frescor e custo quando houver fonte atribuível. CRM não exige conta social. Nenhum workflow aprova conteúdo por conta própria.

## Alcance operacional

Os 12 arquivos n8n chamam o backend autenticado; não restam nós genéricos que apenas dizem para configurar um workflow. Cadastro social, decisão editorial e confirmação de titularidade continuam humanos onde o plano assim exige, com tarefas/filas persistidas e auditadas.

Formatos implementados: texto X/Telegram/Facebook, JPEG Instagram, MP4 YouTube e artigo WordPress via Audience; mensagens oficiais WhatsApp/Telegram/e-mail e atualização CRM. Formatos futuros não alteram essas capacidades mínimas. Métricas inexistentes nas APIs não são simuladas. A verificação factual confirma evidência/citação e registra julgamento humano; não transforma uma fonte em garantia automática de verdade.

A interface principal é PT-BR e os conteúdos aceitam PT-BR/EN/ES; o seletor atual controla formatação regional. Tradução integral da interface e certificação WCAG completa não foram declaradas como homologadas.

## Validação

Suítes locais, typecheck/lint/build, testes negativos, hashes das migrations e OpenAPI são atualizados na rodada final. Histórico de screenshots e relatórios em `docs/screenshots`, `docs/load-report.json` e `docs/recovery-report.json` refere-se a ambientes descartáveis. Nenhuma implantação, migration remota ou envio externo foi efetuado nesta rodada. Os testes HTTP usam transporte controlado, não credenciais oficiais.

## Evidências finais — 26/10/2026

- DIM: lint, TypeScript, 81 testes na suíte completa e build de produção aprovados; auditoria npm sem vulnerabilidades. Casos adicionais dirigidos confirmam custo decimal sem perda de precisão, CRM sob política factual e bloqueio de desvio de conversa privada para canal público.
- Audience: lint, TypeScript, 324 testes em 34 arquivos e build Next de produção aprovados. Next/React/ESLint/Vitest atualizados para remover alertas críticos/altos herdados; npm audit sem vulnerabilidades. Rotas legadas de blog também verificam operador/ownership; rotas dinâmicas compatíveis com params assíncronos.
- Interoperabilidade executada por `npx tsx scripts/verify-audience-contract.ts`: publicação, mensagem e CRM, templates nomeados, hash canônico e receipts enriquecidos aceitos pelos validadores reais dos dois checkouts. O script é somente local, sem HTTP ou env secretos.
- OpenAPI regenerado: 184 paths. SHA-256 das duas cópias da sétima migration: `30B63DCCA8B4B9B490ABC0B10D4353232B366E477E92CF93CB6FCD79B79463FA`.
- Carga local: 120 requisições em cada cenário 10/50/100 identidades, zero erros; simulação sequencial PGlite/Fastify, distinta de capacidade real da VPS. Recuperação local DB e mídia verificada por checksum.
- Navegador descartável: login Supabase de teste, Inbox com realtime conectado, controles SLA/retenção e ficha YouTube com autorização correspondente e health. Identificado/corrigido redirecionamento após login e remoção dos botões de provedores incorretos na ficha. Nenhuma autorização OAuth real foi iniciada. Abas/servidores de teste foram encerrados.
- Revisão técnica identificou e corrigiu concorrência de mensagens, payload/AAL forjado, desvio do canal privado, ausência de validação do receipt e precisão financeira. A revisão formal de PR/produto não foi fabricada. O aceite de produção permanece nos gates externos do plano.

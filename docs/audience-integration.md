# Audience Builder → DIM

Implementação local de 25/10/2026. Audience gere persona, estratégia, trajetória de autoridade e blog. Authority Engine continua sendo a fonte canônica da versão aprovada. DIM importa contexto, prepara ações aprovadas, aplica direitos/revisão/capacidades, executa e devolve recibos. Flux/Control Tower não são substituídos.

## Contexto e origem

`dim.audience-context.v1` preserva o pacote real persona-intake, seu hash e IDs. Inclui tenant/projeto, versão/hash do contexto, objetivos/pilares/marcos e blogs com estado/readback. Valida escopo, aprovação, hashes, ausência de segredos e regressão/conflito. Persona e perfil estratégicos importados são somente leitura no DIM.

Audience disponibiliza persistência JSON local com lock/escrita atômica e Supabase append-only privado. Projeto/intake/manifesto/estratégia/blog alimentam automaticamente o read model, inclusive recuperação por leitura após interrupção. Produção exige readback do pacote aprovado pelo adapter oficial Authority configurado. Importação manual sem readback só existe em local/development com flag explícita e não pode sobrescrever um contexto gerido pelo domínio.

Novas identidades DIM usam Audience; antigas são legacy_local até migração explícita. Vínculos não mudam silenciosamente. Contexto alterado invalida revisão/cancela jobs pendentes; degradado ou sem confirmação há 24 horas bloqueia uso operacional.

## Ação, revisão e execução

Contrato `dim.audience-action.v1`: packages/contracts/src/audience-actions.ts. Aprovação cobre tenant/projeto/persona, contexto, canal, conta UUID DIM, texto/fontes/mídias/idioma, título, horário, validade e chave idempotente. YouTube exige declarações de público infantil/privacidade no hash.

O DIM recebe apenas o identificador e busca o corpo aprovado na origem configurada. Persiste execução única e versão aguardando revisão. Aprovação da origem não substitui revisor local independente, quórum, direitos, fontes, disclosure, licenças e capacidade atual. Alterações de versão/conta/horário exigem outra ação aprovada. O horário é o início permitido; atraso seguro pode ocorrer dentro da validade sem alterar o horário aprovado.

Agendamento usa chave canônica da execução. Chave alternativa no endpoint genérico é rejeitada; ações concluídas/canceladas não reabrem. Resultado incerto exige reconciliação, sem reenvio cego.

Antes de cada mutação externa, inclusive depois de health/mídia/Vault, o worker relê aprovação/hash/contexto/validade na origem e permissões locais. Revogação e contexto superado bloqueiam. Revogar depois de uma operação chegar ao provedor não a desfaz.

## Execução contínua

Administração com MFA pode habilitar um membro no vínculo. O papel audience_executor possui audience.sync e permissões operacionais, sem aprovação/administração. Worker sincroniza contexto, prepara ações e agenda versões já aprovadas por outro revisor. Habilitação/responsável são conferidos depois das chamadas remotas e antes de importar/agendar/enviar.

AAL original é persistido; o worker não transforma AAL1 em MFA. Promover executor a administrador/revisor bloqueia a operação até corrigir a separação. Configurar executor não atribui papéis. Membership/grants atuais são revalidados.

## Recibos duráveis

Payload validado por audienceReceipt: receiptId/actionId/actionHash/status/occurredAt e ID externo/código de erro opcionais. Estados: awaiting_review, scheduled, running, succeeded, failed, blocked, cancelled, uncertain (accepted também é aceito no contrato).

Recibos imutáveis e sequenciados preservam retry sem regressão terminal. Outbox só confirma entrega após origem confirmar ID/hash exatos. Timeout reenvia o mesmo receiptId, com backoff/dedupe. Falha de retorno não bloqueia publicações. Custos/métricas completos de retorno ainda não integram esse primeiro contrato.

## Endpoints

| Sistema | Método/rota | Efeito |
| --- | --- | --- |
| DIM | POST /api/v1/influencers/:id/audience/bind | Vínculo de origem |
| DIM | GET .../audience e .../audience/context | Metadados e snapshot autorizado |
| DIM | POST .../audience/sync | Readback versionado |
| DIM | GET .../audience/actions | Ações da origem |
| DIM | POST .../audience/import-action | Body {action_id}; preparar revisão |
| DIM | GET .../audience/executions | Execuções da identidade |
| DIM | POST /api/v1/audience/executions/:id/schedule | Agendar versão revisada |
| DIM | POST .../audience/executor | Habilitar membro operacional separado |
| Audience | GET/POST /api/v1/integrations/dim/context | Export/import persistidos |
| Audience | GET/POST /api/v1/integrations/dim/actions | Pendentes/aprovação escopada |
| Audience | GET .../actions/:id | Aprovação vigente; revogada 410 |
| Audience | POST .../actions/:id/revoke | Revogação imutável |
| Audience | POST .../actions/:id/receipts | Recepção idempotente |
| Audience | GET .../blog/health; POST .../blog/publish | Gateway WordPress aprovado |

## Configuração, evidência e limites

Vault `dim/<organization_id>/audience-builder`: read_model_url, actions_url, token, tenant_id, allowed_project_ids (array JSON). URLs completas HTTPS, sem credenciais embutidas nem redirects; cliente acrescenta tenant/projeto/persona. HTTP loopback somente development explícito. Browser não recebe token nem define endpoint.

Audience exige token de serviço/escopo, tokens e atores próprios de aprovação, configuração Authority e, para blog, allowlist/credenciais WordPress. Os nomes e exemplos completos estão em FBR Audience/03-arquitetura/integracao-dim.md e no .env.example da origem. URLs health/publish do blog incluem queries tenant/projeto/destination na configuração.

DIM possui sete migrations, 79 tabelas originais mais quatro tabelas Audience e content_verifications (84 tabelas de domínio). RLS, tenant FKs, grants privados e imutabilidade testados localmente. Nenhuma migration remota aplicada.

Smoke HTTP local com servidor Next real Audience e adapters reais DIM confirmou contexto, lista/get de ação, receipt/replay, fila vazia, tenant inválido e revogação. Não houve publicação externa. QA Web local conferiu importação e link para revisão; evidência screenshots/audience-execution-local.png.

Atualização de 26/10: o domínio de projeto/intake/manifesto/estratégia/blog alimenta o contexto automaticamente, com journal persistido e read-repair. O provisionamento do blog exige operador/projeto e intent/autoria antes da mutação. Ações message e crm_update incluem conversa/contato e parâmetros exatos; WhatsApp suporta parâmetros nomeados compatíveis nos dois contratos. Há OAuth/refresh, coleta adicional e enriquecimento de receipts com custo atribuível, evidência e métrica/proveniência/horário. Campos de resultado são validados antes da outbox; ausência não vira zero. Ações privadas não podem ser redirecionadas ao publicador de canal. Permanecem a configuração real e homologação de Authority, CMS, provedores e ambiente. Blog segue sob gestão Audience; DIM não cria um CMS estratégico paralelo.

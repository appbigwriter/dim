# Runbook DIM

## Inventário e ambientes

Execute `pwsh -File infra/inventory.ps1` para emitir o inventário confirmado pelo dev-doc. O resultado é uma leitura documental, sem conexão remota e sem assinatura de um operador da VPS. Confirme antes de aplicar: versões Postgres/Supabase/n8n, rede Easypanel, CPU/RAM/disco, TLS, volumes, DNS, SMTP, Storage e repositório de backup.

Crie configurações distintas para staging/produção, contas de teste e segredos distintos. Atribua `APP_ENV`, `WEB_ORIGIN`, `DATABASE_URL`, URLs e chaves Supabase por ambiente. Nunca use o service role em `NEXT_PUBLIC_*`. A API é interna; a Web encaminha somente headers permitidos para um `API_INTERNAL_URL` fixado pelo servidor.

O Compose não cria Supabase/n8n. A rede backend é interna; DB e Redis não possuem porta publicada. Redis usa rede dedicada sem autenticação e protected-mode desativado para permitir os containers clientes. Não conecte serviços não confiáveis a essa rede. Adote ACL/TLS ou Redis gerenciado se a rede for compartilhada. O bind Web de referência é `127.0.0.1:3000`; o Easypanel deve fornecer o proxy HTTPS, certificado e rede verificados da instalação. O container Web usa porta 3000; API usa 3001.

## Migrations

1. Backup consistente e staging isolado compatível com `auth.users`, `auth.sessions` (incluindo `not_after`) e papéis Supabase.
2. Revisar diferenças contra o baseline. Nunca aplicar sobre uma instalação desconhecida ou o template genérico sem inventário.
3. `npm run db:migrate` aplica as migrations ainda não registradas e confere checksums. Execute um único runner por ambiente.
4. A migration adiciona 79 tabelas de domínio e uma tabela técnica de histórico. As migrations seguintes adicionam constraints, RLS, imutabilidade e colunas de runtime, sem criar tabelas de domínio extras.
5. Copias em `supabase/migrations` e `packages/db/migrations` devem ser idênticas. Novas migrations são criadas com o CLI Supabase, copiadas para o runner e verificadas nos testes.
6. Execute `prd/DIM-custom_dim-verificacao.sql`, testes de tenant e operações com o papel de runtime no staging real.

**Reversão:** estratégia expand/contract. Não há downgrade automático destrutivo. Pare writers, restaure uma cópia em staging e reverta a imagem da aplicação mantendo as colunas aditivas. Descartar `custom_dim` só é permitido em banco explicitamente descartável; nunca no Supabase central. Não edite checksums de migrations aplicadas.

O papel de migration cria `dim_app` NOLOGIN. A conexão de runtime deve conseguir `SET ROLE dim_app`. As consultas de controle exigem acesso específico a memberships, grants e Auth. O app não altera tabelas de governança no schema `public` nem pressupõe configuração do PostgREST. O schema fica privado.

## Bootstrap / acesso

Crie o usuário no Supabase Auth/fluxo corporativo autorizado. Use `BOOTSTRAP_USER_ID`, `BOOTSTRAP_ORG_NAME`, `BOOTSTRAP_ORG_SLUG` e `npm run db:bootstrap` para uma organização nova. O script é uma ação administrativa única e não é um endpoint público. Membership/grants são administrados no módulo de equipe; usuários convidados precisam existir no Auth. Envio automático de convite e configuração SMTP ainda não estão implementados na aplicação.

Entre com senha. Se houver TOTP verificado, o login pede código. Para primeiro cadastro MFA, autentique, abra `/login`, selecione configurar MFA, escaneie o QR e confirme o código. Administrador sem `aal2` recebe `MFA_REQUIRED`. Revogar membership bloqueia próximas requisições e execuções. Auth valida também a existência da sessão para impedir uso de sessão já removida. A compatibilidade dessa consulta precisa ser verificada na versão Self-Hosted instalada.

## Storage e antivírus

Crie `dim-private` privado via operação administrativa Supabase, limite 5 MB e MIME permitidos PDF/PNG/JPEG/WebP. Não crie políticas públicas de leitura/escrita. Revise políticas globais existentes de `storage.objects`, pois policies permissivas de outro sistema podem afetar o bucket.

Configure `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST`/`CLAMAV_PORT` privados. `/storage/upload` verifica magic bytes e ClamAV INSTREAM antes de enviar. Serviço indisponível bloqueia upload. Download depende de tenant, escopo, scan clean e URL de 60 segundos. Não há upload por URL arbitrária nem fetch de fontes de pesquisa, reduzindo superfície SSRF. Objetos enviados e não registrados por falha SQL podem virar órfãos; reconcilie por prefixo e checksum antes de qualquer limpeza.

## Cofre e conectores

Vault KV v2: `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_MOUNT` (padrão `secret`). Use TLS; HTTP somente em `APP_ENV=development`. Política do token deve limitar paths ao projeto/ambiente; os exemplos abaixo são formatos de referência, não valores secretos.

- Telegram: `dim/<org>/<account>/telegram` com `token`; webhook em `dim/<org>/<account>/webhook` com `secret`. Crie o bot oficialmente, dê as permissões reais no chat/canal, configure webhook oficial com `secret_token` e `/api/v1/webhooks/telegram/<account>`. O `external_id` é o chat/canal autorizado; o handler atual aceita apenas eventos desse chat, não inventaria todos os chats de um bot.
- X: configure `X_CLIENT_ID`, `X_CLIENT_SECRET` quando cliente confidencial e `X_REDIRECT_URI` HTTPS exato. `/accounts/:id/oauth` retorna autorização S256. Callback `/api/v1/integrations/callback/x` troca código, verifica titular, salva tokens no Vault e scopes/validade no banco. Reconectar cria um novo state de dez minutos. Refresh automático não está implementado; integração expirada bloqueia e exige reconexão.
- WhatsApp: configure versão real `WHATSAPP_GRAPH_VERSION` e `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`. Configure o callback genérico `/api/v1/webhooks/whatsapp`; o servidor deriva tenant e conta pelo número assinado e processa estados de entrega sem regressão. Ref de conta contém `token`, `app_access_token`, `waba_id`. `/accounts/:id/connect` inspeciona permissões e número, e `/accounts/:id/sync-templates` importa até 100 templates e marca paginação parcial. Templates antigos ficam stale. Somente templates aprovados dessa conta e sincronizados nas últimas 24h podem ser usados fora da janela. Templates com componentes variáveis ainda exigem extensão do payload; o envio atual cobre texto e template sem parâmetros.
- Meta Instagram/Facebook, CMS e e-mail estão no inventário com integração desabilitada. Provisionamento é checklist humano até definição do CMS/API e aprovação de plataforma. Não há automação de cadastro social.

Todos os conectores falham fechados sem credenciais/capacidades. Conectar/verificar depende de permissão administrativa. As capacidades ficam stale após 24h: reconectar/verificar antes de publicar. Nunca corrija esse estado marcando o banco manualmente como autorizado sem um teste real.

## n8n e agentes

Use o n8n central inventariado. Configure `N8N_URL` e `N8N_SERVICE_TOKEN` no worker/API; `DIM_API_INTERNAL_URL` no n8n. Importe os JSONs de `n8n/workflows`. Configure credenciais Header Auth chamadas `DIM inbound service` e `DIM outbound service`, header `X-DIM-Service-Token`. Mantenha n8n atrás do proxy administrativo e não salve execuções com payloads sensíveis.

Ative somente workflows homologados. Dois workflows executam geração/verificação; os outros dez sinalizam ação humana/configuração pendente. Criar conta, revogar direitos, aprovar e publicar continuam sujeitos aos comandos da API, nunca à decisão livre de um agente.

Para geração, configure um model config com modelo aprovado, moeda, preços por milhão de tokens e teto. Ref `dim/<org>/ai/<model-config-id>` contém o token do modelo. Configure assignment/persona/política e habilite explicitamente o agente. O resultado é uma nova versão para revisão; não recebe aprovação automática. Custos de falhas com resultado incerto ficam reservados em `failed_reserved`; reconcilie com o provedor antes de liberar orçamento. Não é um lançamento financeiro confirmado.

## Publicação, retries e DLQ

O worker consome outbox com ID determinístico de fila. A DB faz claim antes do efeito externo. Há retry exponencial de 30s com jitter e cinco tentativas, limite global de 10 jobs/s, circuit breaker por host e timeout. Há reservas atômicas no Redis por provedor/segundo e conta/minuto, configuradas por PROVIDER_RATE_PER_SECOND e ACCOUNT_RATE_PER_MINUTE. Homologue os valores contra o plano real; não há promessa de throughput de terceiros.

Estados `blocked`, `failed`, `uncertain` são diferentes. Consulte `last_error`, tentativas e correlation ID. `uncertain` nunca entra em retry automático. Investigue no provedor; `/publications/:id/reconcile` exige evidência privada e MFA. Um resultado comprovadamente não enviado pode então voltar à fila por `/retry`. O endpoint não permite forçar reenvio de um resultado incerto. Agendamentos são armazenados em UTC; UI mostra fuso da identidade.

Suspensão/offboarding cancela jobs pendentes, desabilita agentes e marca integrações como `revocation_pending`. Um envio já em voo pode concluir antes da suspensão obter o lock da identidade; o envio não pode ser desfeito por uma transação local. Revogação no provedor e transferência de titularidade são tarefas humanas auditadas. Gere `/influencers/:id/offboarding-report` e retenha evidências.

## Health e alertas

- `/health/live`: processo vivo.
- `/health/ready`: SQL e Redis; 503 se indisponível.
- Web `/health`: encaminha readiness da API.
- `/health/dependencies`: somente papel de segurança com MFA.
- `/metrics`: Prometheus, token `METRICS_TOKEN` no Authorization Bearer; use apenas rede de monitoração.
- Worker: heartbeat Redis com TTL de 30s; `scripts/worker-health.ts` e Docker HEALTHCHECK.

`infra/alerts.yaml` inclui readiness, disco e publicações incertas. Configure targets e destinatários reais na monitoração existente. Métricas de latência são por processo; consolide por instância. Não foi enviado alerta externo durante a implementação.

## Backup / restore

`infra/backup.sh` usa `pg_dump --schema=custom_dim`, cópia separada do bucket via rclone e backup criptografado Restic fora da VPS. PGSERVICE/PGSERVICEFILE e PGPASSFILE autenticam pg_dump sem segredo em argv. A origem Storage, volume de trabalho privado, repositório, arquivo de senha, credenciais e agendamento pertencem ao ambiente; não há valores presumidos. O arquivo de serviço e o PGPASSFILE devem ser privados, provisionados pelo operador.

`infra/restore-staging.sh` restaura o snapshot localmente e exige staging/target confirmado. Depois:

1. Localize os arquivos restaurados e confirme schema de destino ausente, banco descartável e Auth compatível. O schema referencia usuários Auth; o backup DIM não substitui a política de backup do Auth central.
2. Configure autenticação PostgreSQL no ambiente staging isolado. Aplique `pg_restore --no-owner --dbname="$STAGING_DATABASE_URL" <custom_dim.dump>` em schema limpo. Não use `--clean` no banco compartilhado.
3. Copie o diretório restaurado de objetos para o bucket privado de staging com `rclone copy <storage-restaurado> "$STAGING_STORAGE_TARGET" --checksum`.
4. Compare contagens, SHA-256, tenants, contratos, versões e amostras de download assinado. Execute migrations faltantes e smoke tests sem tokens de produção.
5. Registre início do incidente, instante do snapshot e fim da recuperação; calcule RPO/RTO reais. Faça o exercício antes de aprovar R0.

O teste automatizado restaura PGlite em outra instância e um arquivo de mídia por cópia separada; esse é o alcance de `docs/recovery-report.json`. Não comprova backup remoto da VPS. Metas 24h/8h permanecem propostas.

## CI, deploy e rollback

Pipeline: lint, TypeScript, testes, auditoria npm, OpenAPI, build Web, Compose e build de três imagens por SHA. A pipeline não foi executada no GitHub porque não há repositório remoto configurado. Testes locais e validação Compose foram executados. O daemon Docker local está indisponível: build de imagem, rede e Redis reais ficam para CI/staging.

Antes do deploy no serviço existente `sistemas/dim`, registre imagens imutáveis anteriores, backup e configuração. Não mantenha o path `/09-codigo` se o catálogo apontar para esta raiz sem adaptação. Configure build args públicos do frontend e variáveis privadas apenas nos serviços backend. Execute migrations como job controlado; faça staging, smoke `/health`, login/MFA, cross-tenant, upload e publicação autorizada de teste. A produção exige os gates do plano.

Rollback da aplicação: pare ingressos/worker, volte API/worker/Web às imagens anteriores compatíveis, preserve schema aditivo, valide health e jobs antes de retomar. Se houver resultado externo incerto, mantenha o bloqueio de reenvio durante o rollback.


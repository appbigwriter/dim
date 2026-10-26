# Cobertura dos nove canais

Verificação local em 25/10/2026. O escopo se aplica às identidades humanas, virtuais e híbridas. Catálogo, adaptador, conta autorizada e homologação são estados distintos. Nenhuma identidade recebe contas ou credenciais fictícias.

| Canal | Implementado localmente | Limites e aceite externo |
| --- | --- | --- |
| Blogs | Contexto/ações Audience; gateway DIM; transporte WordPress no Audience com health e intent durável antes do envio | Configurar blog ativo/readback e credenciais; provisionamento e outros CMS exigem adapters |
| Instagram | Graph via Facebook Login, inspeção de token/scopes/Página/conta profissional; JPEG privado e publicação de container | OAuth guiado/refresh, outros formatos, webhooks/métricas e homologação pendentes |
| Facebook | Inspeção de token/scopes/titularidade da Página e publicação de texto | OAuth guiado/refresh, mídia, webhooks/métricas e homologação pendentes |
| X | OAuth PKCE, texto, health, métricas públicas e falhas incertas | Refresh, planos/formatos adicionais e homologação real |
| WhatsApp | Cloud API, assinatura, Inbox, opt-in/janela, templates BODY, header texto/mídia oficial e botões URL/quick reply | Business/Graph aprovados e testes reais; componentes avançados/named são bloqueados |
| Telegram | Bot API, texto, health, webhook, Inbox e resposta | Mídia/moderação adicionais e homologação |
| E-mail | Resend: domínio/remetente verificados, fila durável, destinatário verificado no servidor, consentimento e resposta | DNS/contas, confirmação de destinatário, recebimento e delivery/bounce pendentes; sem broadcast arbitrário |
| YouTube | Scopes/canal, MP4 privado, upload resumable, título e declarações de público/privacidade no hash aprovado | OAuth guiado/refresh, processamento posterior, métricas/quotas e homologação |
| CRM interno | Contatos/consentimentos, vínculo, Inbox, notas/handoff, filtros/paginação, SLA idempotente, export e apagamento operacional parcial com revisão independente | Agendamento autenticado de SLA, realtime, retenção externa/Storage/backups e homologação jurídica/operacional |

A ficha e `GET /api/v1/influencers/:id/channels` mostram os nove canais, contas visíveis e capacidade mínima verificada/fresca. Registro conectado sem capacidade comprovada permanece bloqueado. A API não presume homologação.

O worker publica texto em X/Telegram/Facebook, JPEG em Instagram, MP4 em YouTube e artigos via Audience/WordPress. Respostas WhatsApp/Telegram/e-mail usam Inbox e suas guardas. O contrato inicial de ação Audience é de publicação: ações de conversa/CRM, broadcasts e operações adicionais precisam de contratos específicos.

MP4 até 100 MiB e PDF/PNG/JPEG/WebP até 5 MiB exigem AV, MIME real, checksum, identidade e licença. Configurar limites correspondentes no proxy, Storage e ClamAV. Público/não listado no YouTube exige autorização no cofre além da revisão. Container Instagram sem confirmação fica incerto.

Detalhes: [conectores](connectors.md), [e-mail](email-integration.md), [Audience](audience-integration.md), [Inbox e privacidade](inbox-operations.md).

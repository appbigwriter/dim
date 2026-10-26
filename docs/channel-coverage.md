# Cobertura dos nove canais

Atualizado em 26/10/2026. Os canais se aplicam às identidades humanas, virtuais e híbridas. Cada conta exige titularidade legítima, autorização própria e capacidade atual verificada. Não há geração de contas ou credenciais fictícias.

| Canal | Fluxos implementados | Configuração/homologação externa |
| --- | --- | --- |
| Blogs | Audience gere projeto/persona/estratégia/blog, provisionamento autenticado com intent/autoria, contexto automático e readback WordPress; DIM publica artigo aprovado; métricas com origem | CMS/DNS/credenciais, domínio e pacote Authority aprovados |
| Instagram | OAuth guiado Meta, Página/conta profissional, seleção do titular, renovação do grant, health, JPEG privado/container e métricas oficiais | App, permissões, versão Graph e contas profissionais |
| Facebook | OAuth guiado Meta, titularidade/tarefas da Página, renovação, publicação de texto e métricas | App/Página e permissões oficiais |
| X | OAuth PKCE, refresh com rotação, texto, health e métricas públicas | App, scopes, plano e quotas |
| WhatsApp | Cloud API, webhook assinado, Inbox, opt-in/janela, templates BODY/HEADER/mídia/botões, parâmetros posicionais e nomeados, logs e IDs | Business/Graph, templates e número aprovados |
| Telegram | Bot API, webhook autenticado, texto/canal, Inbox e resposta oficial | Bot/canal/titular e permissões |
| E-mail | Resend, remetente/domínio verificados, Inbox, destinatário no Vault, revisão documental explícita de titularidade, consentimento, recebimento/readback e fatos de entrega/bounce | DNS/domínio, assinatura Svix e comprovação de endereço; não há broadcast arbitrário |
| YouTube | OAuth/PKCE Google, seleção do canal, refresh, upload MP4 resumable, declarações de público/privacidade, health e métricas | App revisado, scopes/canal, quotas e processamento oficial |
| CRM | Contatos/vínculos/consentimentos, mensagens, notas/handoff, SLA automático, SSE, export e erasure revisado de dados/Storage/provedor/backup | Política jurídica e destinos reais de retenção |

O Audience emite ações `publication`, `message` e `crm_update`. O DIM importa a versão/hash/contexto, exige revisão local independente e executa o destino exato. Uma ação de conversa não pode ser desviada para o publicador de canal. O recibo retorna erro, ID/evidência, métrica com proveniência/frescor e custo atribuível quando disponíveis.

A ficha e `GET /api/v1/influencers/:id/channels` mostram contas visíveis e capacidades mínimas verificadas. A conexão guiada e o botão de health ficam na ficha da conta; segredos permanecem no servidor. Revogação concorrente e resultado incerto bloqueiam repetição automática.

Formatos mínimos entregues: texto X/Telegram/Facebook, JPEG Instagram, MP4 YouTube e artigo WordPress; mensagens WhatsApp/Telegram/e-mail e patch CRM aprovado. MP4 até 100 MiB e PDF/PNG/JPEG/WebP até 5 MiB exigem AV/MIME/checksum/identidade/licença. Formatos adicionais são extensões desses adaptadores. Nenhum teste local prova aprovação de app, criação da conta pelo titular ou publicação real.

Métricas não disponíveis na API, como views de blog WordPress sem plugin/fonte real e estatísticas de post Telegram, ficam desconhecidas. Confirmar um evento técnico de e-mail não prova leitura humana.

Detalhes: [OAuth](oauth-onboarding.md), [métricas](additional-channel-metrics.md), [e-mail](email-integration.md), [Audience](audience-integration.md), [Inbox](inbox-operations.md).

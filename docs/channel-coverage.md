# Cobertura dos canais por influenciador

Verificação em 25/10/2026. Escopo confirmado pelo usuário: Blogs, Instagram, Facebook, X, WhatsApp, Telegram, E-mail, YouTube e CRM devem integrar o produto para todas as identidades humanas, virtuais e híbridas.

**Esse escopo ainda não está integralmente implementado.** O recorte de MVP do PRD (ao menos uma rede) não equivale à entrega de todos os canais aprovados. Cadastro de plataforma, conta vinculada, implementação de adaptador e homologação externa são etapas distintas.

| Item | Código existente | Falta para operação integral |
| --- | --- | --- |
| Blogs | Catálogo CMS, contas e tarefas humanas | Adaptador CMS, provisionamento legítimo, autenticação, publicação, mídia, revisão e métricas |
| Instagram | Catálogo e cadastro de contas | OAuth Meta, permissões, publicação de mídia, status/webhooks, métricas e limites por conta |
| Facebook | Catálogo e cadastro de contas | OAuth Meta/Páginas, tokens/permissões, publicação, status/webhooks e métricas |
| X | OAuth S256, publicação de texto, saúde e coleta de public_metrics | Homologação real, refresh e suporte ampliado a formatos/limites de planos |
| WhatsApp | Cloud API, validação de número/token, assinatura, Inbox, opt-in, janela, templates paginados e variáveis de texto BODY | Conta Business aprovada, componentes de mídia/header/botões e homologação real |
| Telegram | Bot API, texto, saúde, webhook, Inbox e resposta | Homologação real e capacidades adicionais de mídia/moderação |
| E-mail | Catálogo, contas e tarefas humanas; convites Auth são um fluxo separado | Adaptador operacional de e-mail por influenciador, domínio/remetente, envio/recebimento, consentimento e entrega |
| YouTube | Incluído no catálogo nesta revisão | OAuth Google, canais, upload de vídeo, processamento, publicação, métricas e quotas |
| CRM | Contatos/consentimentos por tenant, vínculo manual, histórico, Inbox, notas, handoff, exportação e pedidos de titular | Filtros completos, automações, execução de retenção/exclusão e homologação dos processos |

A ficha de cada identidade mostra os nove itens, o estágio de implementação e suas contas visíveis. A API correspondente é `GET /api/v1/influencers/:id/channels`; ela aplica a permissão da identidade e filtra contas por escopo. Nenhuma identidade recebe contas ou credenciais fictícias automaticamente. Cada canal precisa de titularidade, autorização e capacidade verificadas para aquela conta.

O YouTube não aparecia no seed inicial. A quarta migration e o seed passam a incluí-lo como plataforma, sem declarar publicação de vídeo implementada.

As lacunas de Blogs, Instagram, Facebook, E-mail e YouTube incluem **código ainda ausente**, além de credenciais/aprovações externas. Não devem ser apresentadas apenas como configuração pendente.

# Adaptadores operacionais dos canais

Os adaptadores em `packages/connectors/src/channels.ts` têm transporte HTTP real e testes com `fetch` injetável. Sua presença não equivale à homologação das contas. Nenhuma chamada mutável foi feita aos provedores durante a implementação. Tokens, identificadores de aplicativo, endpoints privados e allowlists ficam exclusivamente no cofre por integração.

`channelConnector(provider, secret, mediaResolver?, fetcher?)` devolve a interface `Connector`. O parâmetro opcional `payload` da publicação aceita `mediaAssetIds`, `title`, `subject` e `body`. `MediaResolver(assetId)` deve carregar **o asset aprovado da organização corrente**, com bytes verificados, MIME e, quando necessário, URL temporária autorizada. URLs fornecidas diretamente no conteúdo não são usadas para buscar mídia.

| Canal | Implementação | Verificação e configuração |
| --- | --- | --- |
| Facebook | Texto em Página via Graph `/{page}/feed` | `graph_version`, `app_access_token`, `app_id` opcional, token de Página; debug de token exige `pages_manage_posts` e `pages_read_engagement`, validade e `/me.id` correspondente. Perfis pessoais e mídia são bloqueados. |
| Instagram | Um JPEG, criação de container, leitura de estado e `media_publish` | Fluxo Facebook Login com `page_id`, escopos `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, vínculo real `instagram_business_account`. Exige resolver e `media_allowed_origins` como array JSON de origins HTTPS. Legenda até 2.200 caracteres, JPEG até 8 MiB. |
| YouTube | Upload resumable MP4 com metadados e recibo de vídeo | `client_id`, token OAuth com escopo de upload **e** leitura (`youtube.readonly`, ou escopo completo que cubra ambos), `/channels?mine=true` confirma titularidade. Resolver privado obrigatório, limite local de 100 MiB. `payload.title` e `payload.body.madeForKids` explícitos. Privacidade `private` por padrão; outras exigem `allow_nonprivate=true` no cofre. |
| Blog/CMS | Protocolo delegado `dim.channel-transport.v1` | O endpoint pertence ao Audience Builder ou a seu adaptador autorizado; `health_url`, `publish_url`, `allowed_origins` configurados explicitamente. Health exige `owner=audience-builder`, destino exato e readback. O DIM não cria uma gestão de blog paralela. |
| E-mail | Adaptador Resend real em `email.ts`, fila durável e resposta individual pela Inbox | `provider=resend`, `token`, `domain_id`, `from_email` no cofre; API Domains confirma domínio verificado e sending enabled. Destinatário deriva exclusivamente de identidade de contato verificada, vínculo com influenciador e referência protegida no cofre. Marketing exige opt-in vigente; atendimento exige inbound recente. O gateway privado anterior continua opcional e desabilitado sem resolver de consentimento. |

`channelHealth` não recebe resolver de mídia e, por isso, não habilita publicação de Instagram/YouTube. A integração deve testar uma instância com transporte de mídia realmente disponível antes de registrar essa capacidade. O gateway de e-mail tampouco habilita envio até o core fornecer consentimento e destinatário verificados.

O protocolo privado dos gateways é uma proposta de contrato explícita, **não** uma API presumida dos produtos externos. O Audience/gateway precisa implementá-lo e ser configurado antes de uso. GET `health_url`, autenticado com Bearer, retorna:

```json
{
  "contractId": "dim.channel-transport.v1",
  "provider": "cms",
  "destination": "blog-id",
  "owner": "audience-builder",
  "readbackVerified": true,
  "capabilities": ["publish_text"]
}
```

Para e-mail, `provider=email`, `senderVerified=true`; o destino é o identificador da conta remetente autorizada. POST `publish_url` usa Bearer e `Idempotency-Key`, com corpo `{contractId,provider,destination,idempotencyKey,text,title?,subject?,recipient?,actionId?,actionHash?}`. `recipient` só existe para e-mail e contém `{email,consentReceiptId}`. Para CMS, `actionId` e `actionHash` são obrigatórios e vêm dos campos `body.audience_action_id` e `body.audience_action_hash` da versão aprovada. O Audience revalida a ação persistida, contexto, destino, prazo e texto/título antes de publicar. O gateway deve validar a autorização e aplicar idempotência durável. A resposta deve repetir `contractId`, `destination`, `idempotencyKey` e, para CMS, `actionId`/`actionHash`, com `status=published` e `externalId`; aceitação/enfileiramento sem publicação confirmada não conta como publicado. `health_url` e `publish_url` podem conter os parâmetros de escopo exigidos pelo gateway, configurados no cofre.

Todos os transportes proíbem redirecionamento e impõem timeout. Endpoints configuráveis exigem HTTPS, allowlist de origin e recusam IPs/hosts locais. Erros de rede/5xx após envio ou resposta sem recibo confiável resultam em `uncertain`, impedindo republicação automática. Container Instagram ainda em processamento fica em reconciliação; não se presume sucesso. Upload YouTube concluído confirma o recebimento do vídeo, mas a disponibilidade pública ainda depende do processamento e das restrições do YouTube.

O storage privado aceita MP4 até 100 MiB, após verificação de box `ftyp`, marca MP4 e antivírus; os demais formatos mantêm 5 MiB. Essa assinatura é validação inicial de formato, não um parser completo de codecs. O ClamAV de destino deve aceitar o tamanho configurado, caso contrário o upload é recusado. `loadVerifiedMedia` verifica organização, escopo, procedência do path, status clean, bytes, tamanho, SHA-256 e formato antes do transporte. O guard editorial continua responsável por licença e vínculo da mídia com a versão/identidade aprovada.

Atualização de 26/10: OAuth guiado Meta/Google/X, renovação, métricas adicionais e recebimento/delivery/bounce de e-mail estão implementados e conectados ao worker. O gateway WordPress/CMS é implementado no Audience. Resultados de processamento externo ainda incertos continuam exigindo reconciliação com evidência; nenhum container/vídeo é presumido disponível publicamente sem confirmação. Configuração/implantação, limites da versão e homologação com contas reais permanecem requisitos operacionais. Consulte oauth-onboarding.md e additional-channel-metrics.md.

Referências primárias consultadas em 25/10/2026: [Meta Pages Posts](https://developers.facebook.com/docs/pages-api/posts/), [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/), [Meta debug_token](https://developers.facebook.com/docs/graph-api/reference/debug_token/), [YouTube resumable uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol), [YouTube channels.list](https://developers.google.com/youtube/data/reference/rest/v3/channels/list), [Google tokeninfo](https://developers.google.com/identity/openid-connect/reference). O acesso automatizado às páginas Meta retornou restrição/429; os contratos Meta devem ser homologados na versão Graph aprovada, sem assumir que testes locais comprovam permissões remotas.

# Autorização guiada e renovação dos canais

O componente `account-connect.tsx` orienta a autorização de X, Facebook, Instagram profissional e YouTube. O início exige administração com MFA; o usuário abre a URL oficial, autoriza no provedor, retorna ao DIM e confirma uma das contas recebidas do próprio provedor. A API nunca aceita um token ou uma conta externa arbitrária do navegador.

Rotas: POST `/api/v1/accounts/:id/connect/start`; callback público `/api/v1/oauth/callback/{x|meta|google}`; GET `/api/v1/accounts/:id/connect/:operation/choices`; POST `/api/v1/accounts/:id/connect/:operation/select` com `{external_id}`. O callback apenas troca autorização e prepara a seleção: a ativação exige novamente o usuário autenticado que iniciou a operação. O state aleatório é armazenado somente como hash, vence em dez minutos e é consumido uma vez. X e Google usam PKCE S256. Verifiers, tokens, refresh tokens e tokens de Página ficam no cofre; a API de seleção retorna somente ID, nome e canal.

`oauthConfigFromEnvironment()` lê configurações explícitas:

| Provedor | Variáveis |
| --- | --- |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` quando confidential client, `X_CONNECT_REDIRECT_URI` |
| Meta | `META_CLIENT_ID`, `META_CLIENT_SECRET`, `META_CONNECT_REDIRECT_URI`, `META_GRAPH_VERSION` |
| Google/YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CONNECT_REDIRECT_URI` |
| Mídia/privacidade | `OAUTH_MEDIA_ALLOWED_ORIGINS` como array JSON de origins HTTPS para mídia Instagram; `YOUTUBE_ALLOW_NONPRIVATE=true` apenas quando publicação pública/unlisted estiver aprovada |

As variáveis `*_CONNECT_REDIRECT_URI` devem apontar exatamente para os novos callbacks registrados no aplicativo do provedor. São distintas do callback legado X, que permanece compatível com sua configuração anterior. Não há client secret em variável `NEXT_PUBLIC_*`. HTTPS é obrigatório; somente `APP_ENV=development` permite callback HTTP no loopback.

X exige `tweet.read`, `tweet.write`, `users.read` e solicita `offline.access`. Google solicita upload e leitura do YouTube, acesso offline e consentimento. Os canais vêm de `channels?mine=true`; não basta conhecer um ID de canal. Meta troca o code por token e pelo grant de longa duração, verifica permissões concedidas, enumera Páginas com tarefa de criação e resolve Instagram pelo vínculo `instagram_business_account` da Página. A paginação usa apenas cursores em host fixo, nunca URLs remotas arbitrárias. Uma conta que já possui `external_id` só pode ser vinculada ao mesmo titular; qualquer alteração da conta durante a autorização invalida a seleção.

Após confirmação, a integração fica `pending_verification`, com capacidades desativadas. O teste oficial de saúde deve confirmar titularidade, permissões e transporte de mídia antes de habilitar operações. Permissões, IDs de aplicativo e validade são persistidos sem credenciais no banco.

`refreshOAuthIntegrations(db,vault,config)` processa autorizações próximas do vencimento. X e Google usam o refresh token oficial, verificam novamente o titular, armazenam o resultado em uma nova referência imutável no cofre e aplicam compare-and-swap na integração ainda ativa. Uma revogação concorrente impede a atualização. Há claim durável por versão da credencial para evitar consumo concorrente de refresh token rotativo; uma resposta incerta exige nova autorização em vez de repetir cegamente o token antigo. Após renovação, capacidades ficam bloqueadas até novo health.

Facebook Login não fornece um refresh token universal. O adaptador pode recuperar/rotacionar os tokens de Página enquanto o grant de usuário continuar válido; quando o grant exige nova presença do titular, registra `requires_reauthorization` e o usuário usa o fluxo guiado novamente. A implementação não inventa uma renovação silenciosa que o provedor não oferece.

Os testes injetam HTTP e Vault e cobrem state expirado/repetido, titular diferente, usuário revogado, seleção fora do grant, Page sem tarefa de criação, IG vinculado e CAS de refresh diante de revogação. Credenciais reais, aplicativos revisados, permissões aprovadas, DNS/callbacks acessíveis e testes de contas reais continuam necessários para operação externa.

Fontes oficiais consultadas em 25/10/2026: [OAuth X com PKCE e refresh](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [Google OAuth para aplicações web](https://developers.google.com/identity/protocols/oauth2/web-server), [Meta manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/), [Meta tokens de longa duração](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/), [Meta Pages](https://developers.facebook.com/docs/pages-api/getting-started/). As páginas Meta limitaram o acesso automatizado com HTTP 429; contratos precisam da homologação normal da versão Graph configurada.

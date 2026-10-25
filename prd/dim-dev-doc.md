# Documentação para Dev — DIM - Digital Influencer Mannagement

## 1. Identidade do projeto

- **Project ID:** `3a4d3421-7d76-421c-afe2-e981e12ef64b`
- **Slug:** `dim`
- **Tipo:** `custom`
- **Template:** `custom_base` (v1.0.0)
- **Schema exclusivo:** `custom_dim`
- **Domínio oficial:** dim.fbr.news
- **Domínio de validação:** https://dim.fbr.news/health
- **Namespace:** `fbr/custom/3a4d3421-7d76-421c-afe2-e981e12ef64b`
- **Target:** `vps2`
- **Repository path:** `/`
- **Easypanel project:** `sistemas`
- **Easypanel service:** `dim`

## 2. Variáveis completas do runtime

O bloco abaixo usa valores derivados reais quando seguros e marcadores textuais objetivos para credenciais. Substitua os marcadores privados pelos valores do provider autorizado antes do deploy.

```env
NODE_ENV=production
APP_ENV=production
CONTROL_TOWER_BASE_URL=https://control-tower.fbr.news
CONTROL_TOWER_PROJECT_ID=3a4d3421-7d76-421c-afe2-e981e12ef64b
CONTROL_TOWER_SCHEMA_NAME=custom_dim
DATABASE_URL=<SUPABASE_CENTRAL_DATABASE_URL_ACCESSIBLE_FROM_RUNTIME>
SUPABASE_URL=https://supabase-control-tower-api.fbr.news
SUPABASE_SERVICE_ROLE_KEY=<SUPABASE_CENTRAL_SERVICE_ROLE_KEY>
SUPABASE_ANON_KEY=<secret-manager:fbr/custom/3a4d3421-7d76-421c-afe2-e981e12ef64b/SUPABASE_ANON_KEY>
AUTHORITY_ADMIN_TOKEN=<GENERATED_AND_PERSISTED_AUTHORITY_ADMIN_TOKEN>
AUTHORITY_OPERATOR_TOKEN=<GENERATED_AND_PERSISTED_AUTHORITY_OPERATOR_TOKEN>
AUTHORITY_REVIEWER_TOKEN=<GENERATED_AND_PERSISTED_AUTHORITY_REVIEWER_TOKEN>
AUTHORITY_PUBLISHER_TOKEN=<GENERATED_AND_PERSISTED_AUTHORITY_PUBLISHER_TOKEN>
AUTHORITY_VIEWER_TOKEN=<GENERATED_AND_PERSISTED_AUTHORITY_VIEWER_TOKEN>
PORT=3000
HOST=0.0.0.0
```

## 3. Procedimento manual no Easypanel

1. Abra o projeto e o serviço informados acima.
2. Configure o source path do repositório como `/09-codigo` (valor padrão persistido no catálogo).
3. Abra **Environment**; o destino padrão do serviço é `.env`.
4. Informe as variáveis exatamente com os nomes do bloco `env`.
5. Nunca cole o bloco em Git, chat, ticket ou log.
6. Salve o Environment e execute **Deploy**.
7. Verifique o domínio de validação e aguarde HTTP 200.

### Classificação das variáveis

- `AUTHORITY_PROJECT_ID` e `AUTHORITY_OWNER_ID`: identidade derivada do catálogo.
- `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: conexão/provider Supabase; `DATABASE_URL` precisa ser acessível pelo container do serviço.
- `AUTHORITY_*_TOKEN`: tokens privados do Authority; nunca expor no frontend.
- `PORT`, `HOST`, `NODE_ENV` e `APP_ENV`: configuração derivada do runtime.

## 4. Regras de arquitetura

- Operar exclusivamente no schema `custom_dim`.
- Não criar, alterar ou excluir tabelas de governança no schema `public`.
- Nunca enviar service role key ou tokens para o browser.
- Persistir ownership com `project_id` e `owner_id`.
- Tabelas esperadas no schema:
- entities
- entity_relations
- records
- files
- settings
- audit_logs
- events

## 5. Checklist de validação

- [ ] Migration/runtime contract aplicado.
- [ ] Variáveis salvas no `.env` do serviço correto.
- [ ] `DATABASE_URL` não usa `localhost`, `127.0.0.1`, `::1` ou `db` inacessível.
- [ ] Deploy concluído no serviço correto.
- [ ] https://dim.fbr.news/health retorna HTTP 200.
- [ ] Authority executa preflight `select 1`.
- [ ] Teste de escrita e readback concluído.
- [ ] Restart/redeploy preserva owner e tokens.

## 6. Segurança

Este documento não deve conter valores secretos reais. Se uma credencial for exposta, revogue-a e gere uma nova antes de continuar.

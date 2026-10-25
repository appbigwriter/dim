-- Queries somente de leitura. Rodar após a migration em STAGING.
SELECT n.nspname AS schema_name, count(*) AS table_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='custom_dim' AND c.relkind='r' GROUP BY 1;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='custom_dim' AND c.relkind='r' AND NOT c.relrowsecurity;

SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='custom_dim' AND grantee IN ('anon','authenticated') ORDER BY 1,2,3;

SELECT conrelid::regclass AS table_name, conname AS constraint_name, contype
FROM pg_constraint WHERE connamespace='custom_dim'::regnamespace
ORDER BY table_name::text, constraint_name;

SELECT schemaname, tablename, indexname
FROM pg_indexes WHERE schemaname='custom_dim' ORDER BY tablename,indexname;

-- Esperado: 79 tabelas, 0 tabelas com RLS desligado, 0 GRANTs diretos anon/authenticated.
-- Testes de cross-tenant, privilégios e execução precisam de transações e identidades de teste;
-- este arquivo não cria nem altera dados reais.

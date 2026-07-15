# Evidência — Prompt 8, administração e observabilidade

As mutações administrativas revalidam sessão/RBAC, escopo de temporada/pool,
CSRF, idempotência, justificativa e, nas operações sensíveis, preview com
confirmação reforçada. Before/after, request ID e ator são persistidos no audit
log. O painel cobre sync, mappings/quarentena, overrides, regras, usuários,
jobs, flags e rollback.

`GET /api/admin/health` consolida database/pool, provider e lock, ranking, SSE,
outbox e idade do backup. O contrato externo de go-live exige links de dashboard
e prova de disparo/recuperação de alerta para cada sinal; apenas a resposta do
endpoint local não aprova produção.

Testes relevantes: `admin-security.test.ts`, contratos HTTP, SSE/shutdown,
integração PostgreSQL e o E2E `@rollback`. O runbook detalhado está em
[runbook-administracao-etapa-8.md](runbook-administracao-etapa-8.md).

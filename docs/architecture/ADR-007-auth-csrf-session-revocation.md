# ADR-007 — sessão, CSRF e RBAC

- Status: Aceito
- Data: 2026-07-14

## Contexto

A aplicação usa cookie de sessão PostgreSQL. Antes da Etapa 0, bloqueio não
revogava acesso, callbacks podiam escapar do Express e mutações não tinham
token CSRF.

## Alternativas

1. Confiar apenas em SameSite/CORS: rejeitada.
2. Migrar imediatamente para JWT: rejeitada por ampliar escopo e revogação.
3. Sessão server-side revalidada + token CSRF: escolhida.

## Decisão

Sessão armazena identidade, papel, status e sessionVersion. Toda rota protegida
revalida User no servidor; bloqueio, senha ou papel incrementam a versão e
drenam SSE. `regenerate` é obrigatório no login/registro e erros de
regenerate/destroy seguem `next(error)`.

Mutações cookie-auth exigem token aleatório ligado à sessão. Origin e
Sec-Fetch-Site rejeitam browser cross-site. Cliente nativo, que pode não enviar
esses headers, continua obrigado ao token. RBAC global e PoolMembership são
checagens independentes.

## Consequências

Há uma leitura de User por request protegido; otimização futura só pode manter
revogação imediata. Tokens nunca entram em logs.

## Invariantes testáveis

- Token/origem inválidos retornam 403.
- Usuário bloqueado ou com versão/papel divergente recebe 401 no próximo request.
- Admin global não recebe membership social implícito.
- Falha do store não é ignorada.

## Compatibilidade, rollout e rollback

O endpoint de token é aditivo; cliente busca token antes de mutar. Rollback de
aplicação preserva sessionVersion. Desabilitar CSRF não é rollback aceitável;
em emergência, mutações devem ser bloqueadas.

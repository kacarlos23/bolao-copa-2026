# Bolao Copa do Mundo 2026

Monorepo para o bolao da Copa do Mundo 2026.

## Estrutura

- `apps/api`: API Express, Prisma, jobs e SSE.
- `apps/web`: Expo + React Native Web.
- `packages/shared`: tipos, schemas e regras compartilhadas.
- `docs`: planejamento e operacao.
- `scripts`: backup e restore.

## Desenvolvimento

1. Copie `.env.example` para `.env` e ajuste as variaveis.
2. Instale dependencias com `npm install`.
3. Gere o Prisma Client com `npm run prisma:generate`.
4. Rode migracoes com `npm run prisma:migrate`.
5. Crie o primeiro admin com `npm run seed`.
6. Rode tudo com `npm run dev`.

O frontend usa a porta `8080`, pronta para o Cloudflare Tunnel configurado nessa porta.

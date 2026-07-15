# Bolão Copa 2026

Monorepo TypeScript do bolão entre amigos da Copa do Mundo 2026, em evolução controlada para múltiplas competições, começando pelo Brasileirão Série A 2026.

## Estado atual

- `apps/api`: Express 4, Prisma/PostgreSQL, sessões persistidas em PostgreSQL, SSE e sincronização de placares.
- `apps/web`: Expo 54, React Native Web e Expo Router.
- `packages/shared`: schemas Zod, tipos e pontuação 15/3/1/0.
- `scripts`: operação do PostgreSQL local, healthcheck, backup e restore.
- `docs`: arquitetura, operação e plano faseado.

Baseline verificada em 14/07/2026 após os Prompts 0–2:

```text
npm test       69 testes aprovados
npm run lint   aprovado
npm run build  aprovado
```

A suíte possui os primeiros testes de reconciliação de drafts do frontend, e a
integração PostgreSQL da Etapa 2 foi ensaiada sobre backup restaurado. Antes de
habilitar múltiplas competições, siga
[o plano de evolução](docs/plano-de-evolucao-bolao.md).

## Desenvolvimento

Pré-requisitos: Node.js 20 ou superior, npm e PostgreSQL.

1. Copie `.env.example` para o ambiente usado pela API e substitua todos os segredos de exemplo.
2. Instale de modo reprodutível:

   ```powershell
   npm ci
   ```

3. Gere o Prisma Client e aplique as migrations:

   ```powershell
   npm run prisma:generate
   npm run prisma:migrate
   ```

4. Configure `ADMIN_PASSWORD` e crie o primeiro administrador:

   ```powershell
   npm run seed
   ```

5. Inicie API e web:

   ```powershell
   npm run dev
   ```

Por padrão, a API usa `3001` e o Expo Web usa `8080`. Confirme `WEB_ORIGIN` e `EXPO_PUBLIC_API_URL` de acordo com o modo de publicação; não presuma que portas diferentes serão roteadas automaticamente.

## Qualidade

```powershell
npm run lint
npm test
npm run build
npm audit --omit=dev
```

O build não substitui os gates de migration rehearsal, restore drill, concorrência no fechamento dos palpites e E2E descritos no plano.

## Dados e operação

- Não altere o ranking histórico da Copa sem regra versionada e auditoria.
- Use migrations aditivas no padrão expand–migrate–contract.
- Toda nova query esportiva deve ter `seasonId`; palpites e ranking também devem ter `poolSeasonId`.
- O backup versionado inclui `uploads/avatars`, manifests e SHA-256; valide o conjunto antes de qualquer restore.
- Pare API e jobs antes de restore. Faça o primeiro teste de restore em banco isolado.
- A origem oficial vigente deve ser verificada antes de importar horários do Brasileirão.

Consulte também:

- [Plano de evolução](docs/plano-de-evolucao-bolao.md)
- [Plano de expansão](<docs/PLANO DE EXPANSÃO>)
- [Arquivo canônico de execução — comece pela pré-execução](docs/PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#pre-execucao)
- [Operação](docs/operacao.md)
- [Evidência do Prompt 0](docs/evidencia-prompt-0-hardening.md)
- [ADRs e evidência do Prompt 1](docs/evidencia-prompt-1-adrs.md)
- [Schema, backfill e evidência do Prompt 2](docs/evidencia-prompt-2-schema-backfill.md)
- [Etapa 0 — preservação](<docs/Etapa 0 — Preservação do bolão da Copa>)
- [Etapa 9 — testes](<docs/Etapa 9 — Testes obrigatórios>)

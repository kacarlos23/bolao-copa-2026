# Bolão Sirel 2026

Monorepo TypeScript do Bolão Sirel, com Copa do Mundo 2026 e Brasileirão Série A 2026 em operação e expansão controlada para Copa do Brasil, Libertadores e Sul-Americana 2026.

## Estado atual

- `apps/api`: Express 4, Prisma/PostgreSQL, sessões persistidas em PostgreSQL, SSE e sincronização de placares.
- `apps/web`: Expo 54, React Native Web e Expo Router.
- `packages/shared`: schemas Zod, tipos e pontuação 15/3/1/0.
- `scripts`: operação do PostgreSQL local, healthcheck, backup e restore.
- `docs`: arquitetura, operação e plano faseado.

Baseline verificada em 21/07/2026 na máquina de testes, após restaurar e validar o backup do mesmo dia vindo de produção:

```text
Copa do Mundo  48 seleções, 72 jogos finalizados, 2.042 palpites/simulações e 1.311 scores
Brasileirão    20 clubes, 235 jogos, 62 palpites, 23 scores e 209 snapshots de ranking
Prisma         14 migrations aplicadas; schema válido e atualizado
npm test       229 testes aprovados
npm run lint   aprovado
npm run build  aprovado
```

O banco anterior da máquina de testes e um dump validado foram preservados para rollback. Nenhum banco ou serviço de produção foi alterado. A evidência completa, os checksums e a decisão de continuidade estão em [Evidência do Prompt 0 — Copas 2026](docs/evidencia-prompt-0-copas-2026.md). O próximo passo autorizado pelo gate técnico é o Prompt 1 do plano das copas; os prompts continuam sequenciais e não devem ser agrupados.

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
- [Plano e prompts — Copa do Brasil, Libertadores e Sul-Americana 2026](docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md)
- [Evidência do Prompt 0 — Copas 2026](docs/evidencia-prompt-0-copas-2026.md)
- [Operação](docs/operacao.md)
- [Evidência do Prompt 0](docs/evidencia-prompt-0-hardening.md)
- [ADRs e evidência do Prompt 1](docs/evidencia-prompt-1-adrs.md)
- [Schema, backfill e evidência do Prompt 2](docs/evidencia-prompt-2-schema-backfill.md)
- [Etapa 0 — preservação](<docs/Etapa 0 — Preservação do bolão da Copa>)
- [Etapa 9 — testes](<docs/Etapa 9 — Testes obrigatórios>)

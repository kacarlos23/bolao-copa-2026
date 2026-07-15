# Evidência do Prompt 2 — schema e backfill

Revisão concluída em 14/07/2026 sobre o commit-base `21bf051`, depois da
aprovação documental dos ADRs do Prompt 1.

## Entregas

- duas migrations aditivas, sem fase contract;
- entidades e contextos `seasonId`/`poolSeasonId` definidos pelos ADRs;
- unicidades compostas, constraints hierárquicas e triggers de isolamento;
- backfill idempotente da Copa com dual write compatível;
- snapshots que distinguem preenchimento estrutural de alteração de negócio;
- testes estáticos do SQL e teste PostgreSQL de cruzamentos negativos.

O mapa estrutural e operacional está em
[migracao-multicompeticao-aditiva.md](migracao-multicompeticao-aditiva.md), e o
mapa de dados está em [backfill-world-cup-2026.md](backfill-world-cup-2026.md).

## Rehearsal PostgreSQL isolado

O dump `bolao-world-cup-2026-20260714-233244732Z.dump` foi restaurado em um
container temporário `postgres:17-alpine`. O banco original não foi alterado.

```text
prisma migrate deploy             7 migrations aplicadas; 4.283 ms (4,283 s)
prisma migrate status             schema atualizado
locks não concedidos após DDL     0
```

O primeiro backfill associou 72 partidas, 72 palpites, 20 scores, 32 fixtures,
1 chave, 1 pick, 72 simulações e 1 snapshot de ranking aos novos contextos.
Sua validação reportou:

```text
órfãos                 0
duplicidades           0
relações cruzadas      0
hash antes/depois      e4c1e6f8237328874bb09e343741c5871588567114f4bd2155b6edfb2dc8fbde
```

O snapshot de negócio antes/depois foi idêntico. Na segunda execução, todos os
deltas foram zero e o snapshot físico completo permaneceu idêntico.

## Constraints e isolamento

`npm run test:migration:constraints` executou contra o PostgreSQL restaurado e
provou que três inserts/updates cruzados são rejeitados:

1. round associado a stage de outra temporada;
2. palpite associado a pool e partida de temporadas diferentes;
3. snapshot associado a pool e temporada incompatíveis.

A transação de teste foi revertida. Os testes estáticos também bloqueiam DDL
destrutivo e verificam a presença das constraints essenciais.

## Rollback de aplicação

A API anterior (`21bf051`) foi instalada e compilada em worktree temporário,
apontada para o banco já migrado e preenchido e iniciada sem rollback de
schema. Foram verificados:

```text
GET /health                       aprovado
GET /api/auth/me                  Administrador Local
GET /api/ranking                  1 linha
GET /api/competition/cup/matches  72 partidas
```

O processo, container e worktree temporários foram removidos depois do ensaio.

## Gate

| Critério | Resultado |
|---|---|
| Backfill reexecutável sem duplicação | aprovado; segunda execução com deltas zero |
| Zero órfãos e relações cruzadas | aprovado |
| Hashes e contagens da Copa preservados | aprovado |
| Constraints impedem cruzamento | aprovado no PostgreSQL real |
| Rollback da aplicação sem `DROP`/restore | aprovado com a versão anterior |

Não permanece requisito de schema da Etapa 2 aberto para iniciar o Prompt 3.

# Migração aditiva para múltiplas competições

## Escopo

A Etapa 2 é implementada por duas migrations complementares e estritamente
aditivas:

- `20260714234454_add_multi_competition_model`: cria `Competition`,
  `CompetitionSeason`, `Stage`, `Round`, `SeasonTeam`, `Pool`,
  `PoolMembership`, `PoolSeason`, `ScoringRuleSet` e
  `ProviderEntityMapping`, além dos primeiros contextos opcionais nas tabelas
  legadas;
- `20260715010000_complete_multi_competition_constraints`: completa os
  contextos de pool do mata-mata, os campos de corte do `PoolSeason`, as
  unicidades compostas e as constraints de hierarquia e isolamento.

Nenhuma delas remove ou renomeia tabela, coluna, índice, constraint ou rota
legada. O preenchimento dos registros da Copa fica no backfill transacional e
idempotente documentado em [backfill-world-cup-2026.md](backfill-world-cup-2026.md).

## Relações e ownership

```text
Competition 1 ── N CompetitionSeason
CompetitionSeason 1 ── N Stage 1 ── N Round
CompetitionSeason 1 ── N SeasonTeam N ── 1 Team
CompetitionSeason 1 ── N MatchDay / Match / KnockoutFixture / KnockoutGeneration

Pool 1 ── N PoolMembership N ── 1 User
Pool 1 ── N PoolSeason N ── 1 CompetitionSeason
PoolSeason 1 ── 0..1 ScoringRuleSet
PoolSeason 1 ── N Prediction / PredictionScore / RankingSnapshot
PoolSeason 1 ── N KnockoutBracket / KnockoutPick
PoolSeason 1 ── N KnockoutGroupSimulationScore / KnockoutPredictionScore
```

As FKs acrescentadas a linhas legadas continuam opcionais durante o padrão
expand–migrate–contract. O runtime atual faz dual write para os IDs
determinísticos da Copa; a camada genérica e o shadow read são responsabilidade
do Prompt 3.

## Constraints e compatibilidade

- `Stage(id, seasonId)` e `Round(id, stageId, seasonId)` são chaves compostas
  auxiliares. A FK composta de `Round` impede stage de outra temporada e a de
  `Match` impede round/stage/season incompatíveis.
- `Match` aceita contexto totalmente nulo para compatibilidade ou exige
  `seasonId`, `stageId` e `roundId` juntos.
- triggers de constraint validam o mesmo `CompetitionSeason`/`PoolSeason` em
  `Prediction`, `PredictionScore`, `RankingSnapshot`, `KnockoutBracket`,
  `KnockoutPick`, `KnockoutGroupSimulationScore` e
  `KnockoutPredictionScore`.
- `MatchDay(seasonId, date)` e
  `Prediction(poolSeasonId, userId, matchId)` têm unicidades compostas.
- As unicidades globais legadas de data e de palpite são mantidas nesta fase;
  sua remoção só pode ocorrer numa futura fase contract.
- `PoolSeason.scoreableFrom`, `startsAtRound` e o campo legado
  `scoreableFromRound` coexistem para preservar o comportamento atual.
- O mata-mata não foi unificado: fixtures, picks e rotas antigas continuam
  válidos, agora com contexto aditivo de temporada/pool.

`ProviderEntityMapping.internalId` permanece deliberadamente polimórfico. A
chave `provider + entityType + externalId` é única e `seasonId` registra o
escopo/proveniência quando aplicável.

## Locks e rollback

As alterações nullable sem default são de catálogo, mas pedem
`ACCESS EXCLUSIVE` durante cada DDL curto. Os índices não usam
`CONCURRENTLY`; em uma base muito maior, o rehearsal deve definir se algum
índice precisa de uma migration operacional própria. As FKs e constraints
validam as linhas existentes e devem ser executadas com monitoramento de lock.

O rollback normal é da aplicação. As estruturas novas ficam no banco e a
versão anterior continua operando por meio das colunas legadas; não se executa
`DROP` nem restore para desfazer um deploy de aplicação.

## Evidência do rehearsal de 14/07/2026

Uma cópia do dump real foi restaurada em PostgreSQL 17 isolado. As sete
migrations foram aplicadas em **4,283 segundos** e `prisma migrate status`
confirmou o schema atualizado. A consulta posterior encontrou **zero locks não
concedidos**.

O teste PostgreSQL negativo tentou três cruzamentos — `Round` entre temporadas,
`Prediction` entre pool e partida e `RankingSnapshot` entre pool e temporada —
e os três foram rejeitados; a transação de teste foi revertida. O backfill
completo também percorreu as constraints do mata-mata sem violação.

A versão anterior da API, no commit-base `21bf051`, foi compilada e iniciada
sobre o banco já migrado e preenchido. `GET /health`, usuário atual, ranking e
as 72 partidas da Copa responderam corretamente, comprovando rollback de
aplicação sem rollback destrutivo de schema.

Os comandos, hashes e contagens estão consolidados em
[evidencia-prompt-2-schema-backfill.md](evidencia-prompt-2-schema-backfill.md).

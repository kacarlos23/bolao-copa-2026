# ADR-001 — domínio multi-competição

- Status: Aceito
- Data: 2026-07-14

## Contexto

O modelo legado trata a Copa 2026 como universo global. A expansão precisa
preservar IDs e separar identidade permanente, edição esportiva e contexto
social sem criar regras pelo slug.

## Alternativas

1. Duplicar tabelas/serviços por campeonato: rejeitada por divergência de regra.
2. Acrescentar apenas `competition` textual a Match: rejeitada por não modelar
   edição, timezone, formato ou pools.
3. Domínio `Competition` + `CompetitionSeason` com migração aditiva: escolhida.

## Decisão

`Competition` é identidade permanente e possui N `CompetitionSeason`. Match,
MatchDay, Stage, Round, SeasonTeam e mappings pertencem a uma edição. Palpite,
score e ranking pertencem adicionalmente a `PoolSeason`. `Standings` é
classificação esportiva; `Ranking` é classificação social.

Ownership:

- CompetitionSeason possui stages, rounds e matches; Team é catálogo global
  e participa por SeasonTeam.
- PoolSeason possui Prediction e RankingSnapshot.
- Prediction possui seu PredictionScore; scores duplicam chaves de consulta,
  mas constraints/serviço provam consistência com a Prediction.
- Snapshots são derivados, retidos por política e nunca fonte primária.

## Consequências

Todas as APIs esportivas novas exigem `seasonId`; palpite/ranking exigem também
`poolSeasonId`. Há mais validação relacional, mas nenhum dado da Copa precisa
ser recriado.

## Invariantes testáveis

- Match.seasonId coincide com Stage/Round quando presentes.
- Prediction.poolSeasonId aponta para a mesma season de Match.
- IDs legados e valores de ranking/palpite/score não mudam no backfill.
- Nenhuma query genérica escolhe comportamento por slug.

## Compatibilidade, rollout e rollback

FKs em linhas legadas entram nullable, são backfilladas e recebem dual write.
Rotas da Copa tornam-se aliases somente na Etapa 3. Rollback desliga aplicação
nova e preserva tabelas/colunas; não há rollback destrutivo de schema.

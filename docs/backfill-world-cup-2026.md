# Backfill da Copa do Mundo 2026

O backfill preenche o modelo multi-competição depois das migrations aditivas:

```powershell
npm run backfill:world-cup-2026 -- --report .\snapshots\backfill-report.json
```

Ele executa uma transação `SERIALIZABLE`, adquire advisory lock e aborta se
detectar mudança de IDs ou dados de negócio da Copa. O relatório inclui
contagens, deltas, hashes e validações explícitas de órfãos, duplicidades e
relações cruzadas.

## Identidades determinísticas

- `Competition`: `competition-world-cup`, slug `world-cup`;
- `CompetitionSeason`: `competition-season-world-cup-2026`, slug
  `world-cup-2026`;
- `Pool`: `pool-bolao-do-trabalho`, slug `bolao-do-trabalho`;
- `PoolSeason`: `pool-season-bolao-do-trabalho-world-cup-2026`;
- `ScoringRuleSet`: `scoring-rule-set-15-3-1-0-v1`.

Entidades que já existem por chave natural conservam seus IDs. IDs de junção e
mappings são derivados deterministicamente da chave natural.

## Mapa do preenchimento

- cria a competição, a temporada, os stages de grupos/mata-mata e nove rounds;
- vincula seleções a `SeasonTeam` e as classifica como `NATIONAL_TEAM`;
- preenche `seasonId`, stage/round e fechamento individual de `MatchDay` e
  `Match`;
- cria pool, memberships, `PoolSeason` e o ruleset imutável 15/3/1/0;
- preenche `poolSeasonId` em palpites, scores, ranking, chave, picks,
  simulações de grupos e scores do mata-mata;
- vincula fixtures e gerações do mata-mata à temporada, sem substituir o
  modelo legado;
- registra equipes, partidas e fixtures em `ProviderEntityMapping`.

O `PoolSeason` inicia na primeira rodada e em `scoreableFrom` igual ao começo
do torneio. O status da temporada deriva dos jogos armazenados. O dual write do
runtime preserva os mesmos IDs enquanto as rotas genéricas ainda não existem.

## Comparação de snapshots

```powershell
npm run snapshot:copa -- --backfill --output .\snapshots\before.json
npm run backfill:world-cup-2026 -- --report .\snapshots\report.json
npm run snapshot:copa -- --backfill --output .\snapshots\after.json
npm run snapshot:compare -- --backfill .\snapshots\before.json .\snapshots\after.json
```

O modo `--backfill` exclui somente os novos campos estruturais e os
`updatedAt` necessariamente tocados pelo preenchimento. IDs, partidas,
resultados, palpites, scores, pontos e posições continuam protegidos. Para
provar idempotência física, capture um snapshot normal depois da primeira
execução, repita o backfill e compare sem `--backfill`.

## Evidência do rehearsal de 14/07/2026

Sobre uma cópia restaurada do banco real, a primeira execução resultou em:

- 1 competição, 1 temporada, 2 stages, 9 rounds e 48 `SeasonTeam`;
- 1 pool, 1 membership, 1 `PoolSeason`, 1 ruleset e 152 mappings;
- 17 dias, 72 partidas, 72 palpites e 20 scores;
- 32 fixtures, 1 geração, 1 chave, 1 pick e 72 simulações de grupos;
- 0 scores de mata-mata e 1 snapshot de ranking.

Órfãos, duplicidades e relações cruzadas ficaram todos em zero. O hash de
preservação antes/depois foi
`e4c1e6f8237328874bb09e343741c5871588567114f4bd2155b6edfb2dc8fbde`.
O comparador confirmou snapshots de negócio idênticos.

Na segunda execução, todos os deltas foram zero e o snapshot físico integral
permaneceu idêntico. A evidência completa está em
[evidencia-prompt-2-schema-backfill.md](evidencia-prompt-2-schema-backfill.md).

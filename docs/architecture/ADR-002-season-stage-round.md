# ADR-002 — CompetitionSeason, Stage, Round e capabilities

- Status: Aceito
- Data: 2026-07-14

## Contexto

Datas, rodadas e mata-mata estão parcialmente codificados para a Copa. Uma
liga, grupos e confrontos de ida/volta exigem estrutura comum sem condicional
por competição.

## Alternativas

1. Inferir formato pelo slug: rejeitada.
2. Uma tabela de rodada global para todo formato: rejeitada por semântica pobre.
3. Stage/Round ordenados e capabilities declarativas: escolhida.

## Decisão

CompetitionSeason declara timezone IANA, status e capabilities validadas:
`LEAGUE`, `GROUPS`, `KNOCKOUT`, `TWO_LEGS`. Stage declara tipo e ordem; Round
pertence simultaneamente ao Stage e à mesma CompetitionSeason. Match pertence
à season e pode referenciar Stage/Round. Round é unidade esportiva, enquanto
MatchDay permanece agrupamento de apresentação legado durante a transição.

## Consequências

O frontend compõe features por capabilities. Configurações incompatíveis
falham na fronteira Zod. O modelo aceita liga, grupos e mata-mata sem criar
hierarquias paralelas novas.

## Invariantes testáveis

- Stage `(seasonId, slug)` e `(seasonId, order)` são únicos.
- Round `(stageId, order)` é único e `Round.seasonId = Stage.seasonId`.
- Match com Round pertence à season e ao stage dessa Round.
- Instantes são UTC; apresentação/corte usa timezone IANA da season.
- Capabilities, não slug, habilitam standings/chave/ida-volta.

## Compatibilidade, rollout e rollback

A Copa recebe stages/rounds por backfill sem substituir KnockoutFixture.
MatchDay global continua durante expand. Rollback volta a ler MatchDay/campos
legados; Stage/Round permanecem inertes até reaplicação.

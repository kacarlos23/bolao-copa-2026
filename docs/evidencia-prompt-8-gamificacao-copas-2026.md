# Evidência — Prompt 8, ranking e gamificação das copas 2026

Data da execução: 23/07/2026. Ambiente: máquina de teste. SHA inicial:
`9fe1a695ffc4ae46f48e14fe6c12ef70879661d3`.

## Resultado

O Prompt 8 foi implementado sem migration, backfill, alteração de feature flag ou
escrita operacional nas temporadas. A regra de pontuação permanece 15/3/1/0 por
partida; as novas conquistas não atribuem pontos nem bônus de classificado.

Entregas:

- ranking `OVERALL`, `STAGE` e `ROUND` validado no servidor contra
  `rankingScopes`;
- `TURN` falha fechado quando não está explicitamente declarado;
- fase e rodada de outra temporada são recusadas antes da consulta do ranking;
- troféus globais derivados das fases, rodadas e partidas reais da temporada,
  sem cardinalidades fixas da Copa do Mundo;
- sala de troféus, hero, pódio, movimentos, streaks e filtros identificam a
  temporada selecionada, sem fallback visual para o Brasileirão;
- catálogos idempotentes e versionados para Libertadores, Sul-Americana e Copa
  do Brasil;
- Mestre da Fase de Grupos, Rei dos Playoffs, Especialista em Mata-Mata, Cravou
  Ida e Volta, Cravou na Final e os três títulos de campeão no bolão;
- conquistas consolidadas somente com resultados `FINISHED`;
- correção/replay recompõe o fato, revoga ou readquire a conquista com
  `sourceRevision` e evento outbox, sem duplicar o prêmio;
- histórico anterior ao `scoreableFrom`, scores de outro `PoolSeason` e dados
  de outra temporada são ignorados.

As definições específicas são criadas por `prepareConmebolCup2026` na próxima
preparação/carga idempotente de cada temporada. Este prompt não executou a carga
nem alterou as quatro flags.

## Gates

| Gate | Resultado |
| --- | --- |
| testes focados de gamificação, escopos e UI | PASS; replay, correção, LIVE, ida/volta, isolamento, cutoff e troca de temporada |
| `npm test` | PASS; 23 preservação, 18 shared, 191 API e 75 web |
| `npm run build` | PASS; shared, API e web |
| `npm run gate:pr` | PASS; 193 API, 75 web, 26 contratos, lint, genericidade, segurança, build e budget |
| auditoria de dependências | PASS; 0 high, 0 critical; 13 moderadas já triadas |
| `NODE_ENV=test; npm run gate:release-candidate` | PASS; 7 PostgreSQL, 60 E2E, 2 load tests e duas repetições sem flake |
| Prisma no banco efêmero | PASS; 17 migrations aplicadas por `migrate deploy` no runner isolado |
| snapshots locais consecutivos | PASS; `Snapshots identicos.` |

A primeira tentativa do release-candidate herdou `NODE_ENV=production` do
checkout. O cookie `secure` foi corretamente recusado pelo HTTP local, e o teste
CSRF terminou em 403. A repetição definiu `NODE_ENV=test` somente no processo do
gate, silenciou os logs HTTP e passou integralmente. Nenhum arquivo de ambiente
foi alterado.

## Preservação

Os snapshots foram armazenados somente em `output/release-gates/`, ignorado pelo
Git. Contagens não vazias:

| Entidade | Contagem |
| --- | ---: |
| usuários ativos | 24 |
| partidas da Copa | 72 |
| palpites | 2.042 |
| scores | 1.311 |
| fixtures de mata-mata | 32 |

Hashes de negócio protegidos:

- `Match`: `f3b5fcbc57f74006fd7e867841273dd0c287ef14b4fd9cdf75b9f6d5cbd50646`;
- `Prediction`: `86af5bb9497c9609e4ee208a97b795f38b8ffbcf8eebe8c6022747a92dcba351`;
- `PredictionScore`: `66b1ef039914c524e5c2424d67c857729bdd025f9965705d2d4a9ef0624c7b78`;
- `RankingSnapshot`: `c978b9971e09028c9cc2676c73164613476e6d4b98d06959910422d7c250ace0`.

## Estado operacional e riscos

- nenhuma migration foi criada no Prompt 8;
- o banco local de teste continua três migrations aditivas atrás da `main`;
  nenhuma foi aplicada para não misturar escopo;
- o release-candidate comprovou as 17 migrations em banco efêmero;
- `readEnabled`, `writeEnabled`, `uiEnabled` e `syncEnabled` das novas copas não
  foram alteradas;
- nenhum P0/P1 funcional do Prompt 8 permanece;
- a atualização do banco local e a carga idempotente das definições permanecem
  gates operacionais do Prompt 10.

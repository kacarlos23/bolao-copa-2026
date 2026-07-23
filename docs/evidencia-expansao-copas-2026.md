# Evidência — expansão das copas 2026

Data da execução: 23/07/2026. Ambiente: máquina local de teste. SHA base do
Prompt 10: `1a9f91b0c239d94079448dbc54e72f46461a4b90`.

## Decisão

**GO para continuidade dos testes. NO-GO para produção ou abertura geral.**

O canário administrativo da máquina de teste, as cargas oficiais, a matriz
automatizada, o backup/restore e o rehearsal de migration passaram com zero
P0/P1 no escopo de teste. Produção não foi acessada. As flags globais das três
copas continuam desligadas e nenhuma temporada foi aberta para usuários.

O checkout não continha a revisão solicitada do Prompt 10 para “canário
produtivo controlado”; o texto versionado autorizava somente a máquina de teste.
A execução prosseguiu após autorização humana explícita para esse ambiente.
Esta evidência não substitui janela operacional, canário produtivo isolado,
métricas reais nem autorização de produção.

## Candidato e ambiente

- branch `main`, remoto `origin`;
- Prompt 8: `5c2afef332d2dba8e92d91da2efe3b5b6575d0b5`;
- Prompt 9: `1a9f91b0c239d94079448dbc54e72f46461a4b90`;
- PostgreSQL local de teste: `localhost:5433`;
- migrations antes: 14 aplicadas e 3 pendentes;
- migrations depois: 17 aplicadas, banco atualizado;
- comando de aplicação:
  `npm --workspace @bolao/api exec -- prisma migrate deploy`;
- nenhum deploy, restart, import, flag ou acesso de produção.

## Backup, restore e migration rehearsal

Foi criado um dump novo da baseline não vazia antes da migration:

| Artefato | Resultado |
| --- | --- |
| dump custom | 2.225.030 bytes; SHA-256 `1e45f90234f70aa43695bf5ac8286e0dc4d84f338ae040abcc806f638f2bad02` |
| avatares | 5 arquivos; SHA-256 `4d2be5557843ebec85493a93ff21969299b8493db94562e139e0ed03c78d6bbf` |
| manifesto do dump | catálogo, tamanho, checksum, globals sem senhas e avatares validados |
| restore drill | PASS em banco temporário isolado; removido ao final |
| restore de avatares | PASS por arquivo e checksum; diretório temporário removido |
| snapshot restaurado | `Snapshots identicos.` |

O restore encontrou inicialmente uma incompatibilidade no runner: o snapshot
esperado continha `businessContentHashes`, mas o verificador não repetia
`--backfill`. O runner passou a detectar esse contrato, recebeu teste de
regressão e o drill completo foi repetido com sucesso.

O rehearsal em cópia restaurada confirmou:

- `prisma migrate status` antes e depois;
- as migrations
  `20260721010000_add_generic_ties`,
  `20260722010000_add_configurable_cup_providers` e
  `20260722020000_admin_competition_refresh` aplicadas por `migrate deploy`;
- constraints PostgreSQL: 9 cruzamentos inválidos recusados e transação de
  teste revertida;
- backfill executado somente em `--dry-run`;
- zero operação destrutiva de schema;
- hashes da Copa e do Brasileirão preservados antes/depois das migrations e
  das cargas;
- rollback da aplicação por `readEnabled=false`, `writeEnabled=false`,
  `uiEnabled=false` e `syncEnabled=false`, sem rollback de schema.

Referências locais ignoradas pelo Git:

- `backups/prompt10-20260723/`;
- `output/release-gates/prompt10-cups-2026/canary-report.json`;
- `output/release-gates/migration-restore-rollback.json`;
- `output/tie-migration-rehearsal/tie-migration-rehearsal.json`.

## Cargas e fontes oficiais

Cada temporada passou por `--dry-run`, revisão de readiness/checksum, `--apply`,
repetição e `--verify`. A repetição com as mesmas chaves não criou nova
execução nem alterou contagens/flags; `VERIFY` usou chaves de modo distintas e
retornou zero inserts, updates e quarentenas.

| Temporada | Checksum da fonte | Times | Stages | Rounds | Ties | Jogos | Quarentena |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sul-Americana 2026 | `44059d3a03f7cc9b8768674f83be5e781bf3efe7a9fc2228b9a21b08bc68b761` | 56 | 3 | 12 | 24 | 128 | 0 |
| Libertadores 2026 | `ea0f02982e3866fb818656270d72cab28009aee7bb993ec79ea9ab2a608e04bf` | 47 | 3 | 13 | 23 | 142 | 0 |
| Copa do Brasil 2026 | `2745514a9a032c95115391c47bcb25b7a43044be26062aafe2e9f2fcd394f76a` | 126 | 1 | 9 | 118 | 142 | 0 |

As reconciliações locais contra os snapshots oficiais imutáveis passaram:

- Sul-Americana: grupos A–H, 96 resultados de grupos, standings sem
  divergência, 8 playoffs e transferências da Libertadores;
- Libertadores: grupos A–H, 96 resultados de grupos, 15 ties preliminares,
  8 oitavas, ida/volta, kickoff e venue do primeiro jogo pontuável;
- Copa do Brasil: nove fases, jogos únicos e ida/volta, 33 decisões por
  pênaltis, 7 slots futuros adiados e zero standings.

Não foram coletados dados externos durante o canário. Foram usados os artefatos
oficiais sanitizados coletados em 22/07/2026, com URLs, byte lengths e SHA-256
registrados. Nenhum fixture, resultado ou palpite sintético foi inserido nas
três temporadas oficiais.

## Estado das temporadas na máquina de teste

| Temporada | Season ID | PoolSeason ID | `scoreableFrom` | Status |
| --- | --- | --- | --- | --- |
| Sul-Americana 2026 | `cmrxly5db0002kli05g2pplfx` | `cmrxly5du000ekli0gx1cguq4` | `2026-08-12T12:00:00.000Z` | `DRAFT` |
| Libertadores 2026 | `cmrxly9gr0002klf4xcnfyy20` | `cmrxly9h3000dklf4l9vcddkm` | `2026-08-11T22:00:00.000Z` | `DRAFT` |
| Copa do Brasil 2026 | `cmrxlydq10002klpcqjcjxxvf` | `cmrxlydqy000cklpcei0nttob` | `2026-08-01T20:30:00.000Z` | `DRAFT` |

Todas possuem `historicalMatchesScoreable=false`, zero `PredictionScore` e
provider oficial ativo. Estado final das flags:

| Temporada | read | write | ui | sync |
| --- | --- | --- | --- | --- |
| Sul-Americana 2026 | OFF | OFF | OFF | OFF |
| Libertadores 2026 | OFF | OFF | OFF | OFF |
| Copa do Brasil 2026 | OFF | OFF | OFF | OFF |

O canário das cargas foi administrativo e manteve as flags públicas fechadas.
O bypass restrito a `ADMIN` e as rotas auditadas foram exercitados nas suítes
HTTP/E2E isoladas. Escrita, descarte de draft, fechamento individual, resultados
controlados, score/ranking, SSE e reconexão foram exercitados apenas em
bancos/fixtures isolados das suítes. Não foi aberta flag global para simular
isolamento por pool/usuário.

## Preservação da Copa e do Brasileirão

Snapshots antes da migration, após migrations e após as cargas:
`Snapshots identicos.` Contagens da baseline:

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

A projeção adicional por temporada confirmou, antes/depois das cargas:

- Copa do Mundo: 72 Match, 1.041 Prediction, 1.041 PredictionScore e
  24.523 RankingSnapshot;
- Brasileirão: 235 Match, 78 Prediction, 43 PredictionScore e
  377 RankingSnapshot.

## Matriz automatizada

| Gate | Resultado |
| --- | --- |
| `npm run gate:pr` | PASS |
| preservação | PASS; 25 testes |
| shared | PASS; 18 testes |
| API | PASS; 57 arquivos, 223 testes |
| componentes web | PASS; 16 arquivos, 75 testes |
| contratos API/SSE/auth/shutdown | PASS; 5 arquivos, 27 testes |
| go-live evidence gate | PASS; 6 testes, incluindo `syncEnabled` |
| dependências | PASS; 0 high, 0 critical; 13 moderadas triadas |
| build e budget | PASS; 2.366.035 bytes JavaScript |
| `npm run gate:migration` | PASS; 17 migrations, backup/restore, avatares e rollback 4×OFF |
| `NODE_ENV=test; npm run gate:release-candidate` | PASS |
| integração PostgreSQL | PASS; 7 testes |
| E2E desktop/mobile | PASS; 60 testes |
| carga | PASS; 2 testes |
| flakiness | PASS; contratos e componentes repetidos duas vezes |
| canário isolado das copas | PASS; restore, migrate, load, repeat, verify e reconcile |

A matriz cobre score 15/3/1/0, cutoff, timezone/remarcação, standings por grupo,
Tie, agregado, pênaltis, final única, gamificação, imports, idempotência,
outbox, correção, ranking, isolamento, provider offline, fallback declarado,
recovery, lock, shutdown, segurança, acessibilidade e performance. Os E2E
cobrem componentes genéricos das quatro competições atuais, grupos,
ida/volta, final única, fechamento, drafts, deep links, ranking, SSE,
offline/reconexão e viewports 320/768/1280/1440.

## Defeitos encontrados e corrigidos

1. restore não repetia o modo de hashes de negócio do snapshot esperado;
2. nova execução do preparador sobrescrevia o timestamp e poderia voltar flags
   operacionais para OFF;
3. smoke da Copa do Brasil verificava uma forma antiga de capabilities;
4. o vínculo bilateral de transferência Libertadores→Sul-Americana era
   interpretado como divergência do provider e poderia ser removido;
5. o rehearsal e o gate externo de flags ainda não exigiam `syncEnabled=false`.

Todos receberam cobertura e passaram nos gates finais.

## P0/P1/P2 e riscos

- P0 no escopo de teste: nenhum conhecido;
- P1 no escopo de teste: nenhum conhecido;
- P2-001: 13 advisories moderados na cadeia Expo 54, já registrados, sem high
  ou critical;
- bloqueio de produção: falta executar o Prompt 10 revisado em SHA publicado,
  janela aprovada e ambiente produtivo controlado;
- bloqueio de abertura geral: as flags são globais por temporada. Devem
  permanecer OFF até existir isolamento produtivo efetivo e auditável para
  pool/usuário canário ou autorização operacional para outra estratégia;
- smoke de health/readiness, métricas, alertas e logs reais de produção não foi
  executado nem inferido desta máquina de teste.

## Comandos principais

```text
npm --workspace @bolao/api exec -- prisma migrate status
npm --workspace @bolao/api exec -- prisma migrate deploy
npm run snapshot:compare -- --backfill <antes> <depois>
npm run test:canary:cups-2026
npm run load:sudamericana-2026 -- --dry-run|--apply|--verify
npm run load:libertadores-2026 -- --dry-run|--apply|--verify
npm run load:copa-do-brasil-2026 -- --dry-run|--apply|--verify
npm run reconcile:sudamericana-2026 -- --verify-db
npm run reconcile:libertadores-2026 -- --verify-db
npm run reconcile:copa-do-brasil-2026 -- --verify
npm run gate:pr
npm run gate:migration
NODE_ENV=test npm run gate:release-candidate
```

Os logs e JSON locais foram mantidos fora do Git. Eles não contêm credenciais,
URLs de banco, tokens, payloads privados ou segredos.

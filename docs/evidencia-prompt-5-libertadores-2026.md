# Evidência — Prompt 5, CONMEBOL Libertadores 2026

## Resultado da homologação

A coleta final foi feita em `2026-07-22T14:28:28-03:00`, timezone
`America/Sao_Paulo`, offset `-03:00`. O snapshot normalizado tem SHA-256
`ea0f02982e3866fb818656270d72cab28009aee7bb993ec79ea9ab2a608e04bf`.

A fotografia oficial reconciliada registra:

- 47 `SeasonTeam`, com associação e federação conferidas no Manual de Clubes;
- três fases preliminares históricas, fase de grupos A–H e fase final;
- 13 rounds, 142 partidas concretas e 126 resultados históricos;
- 96 resultados de grupos, 32 linhas de standings e zero divergência entre a
  tabela derivada e a tabela oficial;
- 15 ties preliminares decididos e 8 ties concretos das oitavas, todos com duas
  partidas, datas, horários e estádios oficiais;
- quartas, semifinais e final representadas como rounds e sete slots oficiais de
  chave; os ties concretos ficam diferidos até a CONMEBOL definir os clubes;
- 16 classificados para as oitavas e 8 terceiros colocados exportados para os
  playoffs da Sul-Americana;
- os 8 exportados apontando para o mesmo `Team.id` nas duas temporadas, sem
  colisão entre homônimos;
- final em 28/11/2026, em Montevidéu; o estádio ainda está TBC na fonte oficial;
- zero pontos retroativos, zero rankings cruzados e zero eventos cruzados.

Não foram criados `Team` ou `Tie` fictícios para vencedores ainda desconhecidos.
O domínio `Tie` exige dois clubes concretos; por isso os quatro caminhos de
quartas, dois de semifinais e o da final ficam preservados como slots nos rounds
até que os participantes sejam oficialmente promovidos.

## Fontes e checksums

| Fonte oficial | Bytes | SHA-256 |
| --- | ---: | --- |
| [Manual de Clubes — página](https://www.conmebol.com/documentos/manual-de-clubes-conmebol-libertadores-2026/) | 210834 | `fd9bd917ffec6bd152b6f4ac2fd8542c048415fbb49ef89bd155bd44b0711456` |
| [Manual de Clubes — PDF](https://cdn.conmebol.com/wp-content/uploads/2025/12/CL-2026-Manual-de-Clubes-ESP-Feb26.pdf) | 14406942 | `5c3507a763538e2a662afa8126d0507181e0f22348963b78908d8757bef1ecb8` |
| [Grupos A–H](https://gol.conmebol.com/libertadores/es/news/rumbo-la-gloria-eterna-asi-quedaron-los-grupos-de-la-conmebol-libertadores-2026) | 129784 | `d7b0c0186d7ba2daf8c5aec1366cd5a81b82588cdbee192c81e46b4c2e41ada4` |
| [Calendário da fase de grupos](https://gol.conmebol.com/libertadores/es/news/calendario-conmebol-libertadores-2026-dias-horarios-y-sedes-de-la-fase-de-grupos) | 141589 | `87036445ecd4b7413fac705d41ac61b68fee35d0206de3d9c05ef9b6da2ac298` |
| [Fixtures oficiais 2026](https://gol.conmebol.com/libertadores/es/api/v2/tournament-fixtures/15) | 2806942 | `d916444db803e552b86594bbeed6b6d7d43002b2c5a788c803c6483124526afc` |
| [Tabela oficial](https://gol.conmebol.com/libertadores/es/tournament-table/15) | 170484 | `c751c014bf11de2a0efd3fb76a11039f4792ec4f07f97301e514f587bbfdf35c` |
| [Classificados para as oitavas](https://gol.conmebol.com/libertadores/es/news/la-conmebol-libertadores-2026-ya-tiene-sus-protagonistas-para-octavos) | 138939 | `315401d67b8727bfe01662632813552c9471171b7c482b6d8405ca408045aaaf` |
| [Chave das oitavas](https://gol.conmebol.com/libertadores/es/news/asi-se-disputaran-los-octavos-de-final-de-la-conmebol-libertadores) | 132895 | `b6f61077a09355705ea232a909630be0b344af787bd6391ab68eac31b56e8033` |
| [Datas, horários e estádios das oitavas](https://gol.conmebol.com/libertadores/es/news/fechas-y-horarios-asi-se-jugaran-los-octavos-de-final-de-la-conmebol-libertadores) | 125214 | `73b295c030a2bca368beac1c52edfe518a4d5f81182d6b5e7ae57a8d7200bd3e` |
| [Fixture das oitavas — PDF](https://www.conmebol.com/wp-content/uploads/2026/06/Fixture_8vos-de-Final_CONMEBOL-Libertadores-2026_5.6.2026-1.pdf) | 189725 | `a1a94a59ac50b7c58599deacb763966a8c8832ffa2d67b4f7a8fdb82ae8456e1` |
| [Final em Montevidéu](https://gol.conmebol.com/libertadores/es/news/la-final-de-la-conmebol-libertadores-2026-se-disputara-en-montevideo) | 127193 | `6817c3c926df8a5b8f885a928912e74aaa77e15c7afdf80835ab3c1a3b0b2ca4` |
| Feed de standings exposto pela página oficial | 14310 | `6ff822f73da9e5b2622ab27ba5ec48e840368ca10fc06bdedc7e387d6d742e58` |

O URL integral do feed de standings e todos os manifests de provenance estão
no snapshot versionado. As respostas brutas não são redistribuídas: o repositório
retém URL, tipo, tamanho e checksum.

## Corte de pontuação e canário

O `PoolSeason` do `bolao-do-trabalho` usa a versão 1 da regra 15/3/1/0,
`historicalMatchesScoreable=false` e
`scoreableFrom=2026-08-11T22:00:00.000Z`. A fonte oficial confirma Fluminense x
Independiente Rivadavia em 11/08/2026, às 19h de Brasília, no Maracanã, como
o primeiro jogo integralmente verificável das oitavas.

A temporada permanece `DRAFT`. `readEnabled`, `writeEnabled`, `uiEnabled` e
`syncEnabled` permanecem `false`; nenhuma exposição pública faz parte deste
prompt.

## Gates e hashes

A homologação foi executada em uma cópia PostgreSQL isolada, com as 17
migrations existentes aplicadas. A Sul-Americana foi carregada primeiro e a
Libertadores em seguida. Os dois comandos `--verify` retornaram zero inserts,
zero updates e zero quarentenas em `TEAMS`, `STRUCTURE`, `TIES`, `SCHEDULE`,
`RESULTS` e `STANDINGS`.

O `reconcile --verify-db` retornou:

- 96 resultados de grupo e 0 divergências de standings;
- 8 identidades globais transferidas;
- 0 scores históricos, 0 rankings cruzados, 0 eventos cruzados e 0 IDs de
  partidas repetidos entre as competições;
- primeiro jogo pontuável em `2026-08-11T22:00:00.000Z`, Maracanã.

Os snapshots de preservação antes/depois foram idênticos tanto na cópia
isolada quanto no banco local original: 24 usuários ativos, 72 partidas, 2042
palpites, 1361 scores e 32 fixtures de mata-mata. Entre os hashes preservados:

- `Match`: `0d13e7ba69ec46ffb0512f0b0e0d07f7db92558ce85fab3002a0b71cf51440ac`;
- `Prediction`: `2836bf11fb1792ea4abfa7b0a876c9392c545eddd223e8534d7d4434da455745`;
- `PredictionScore`: `da02edd860498c8b58021c765bb3186545801526cd45ef8d80b919d9f908a75d`;
- `RankingSnapshot`: `c9ee0e42809377cdcf5b6da5a2d8e05613fb633f8f5e071470476cb9d0cac45f`.

Nenhuma migration nova foi necessária no Prompt 5.

Comandos finais executados:

```powershell
npm run load:sudamericana-2026 -- --verify
npm run load:libertadores-2026 -- --dry-run
npm run load:libertadores-2026 -- --verify
npm run reconcile:libertadores-2026 -- --dry-run
npm run reconcile:libertadores-2026 -- --verify-db
npm run test:migration:constraints
npm run test:integration
npm run gate:pr
npm run snapshot:copa -- --backfill --output <depois.json>
npm run snapshot:compare -- --backfill <antes.json> <depois.json>
```

Resultados: 181 testes da API, 69 de componentes, 26 de contrato, 18 do
pacote compartilhado, 23 de preservação, 7 de integração PostgreSQL e 9
restrições cruzadas aprovados. Lint, build, budget e auditoria de dependências
também passaram; a auditoria registrou 13 avisos moderados já tolerados pelo
gate e nenhum `high` ou `critical`.

## Riscos residuais

- o estádio da final continua TBC;
- os sete ties posteriores às oitavas dependem de classificados futuros;
- horários e estádios das oitavas devem ser revalidados antes de abrir escrita;
- UI, leitura pública, escrita e sync automático continuam deliberadamente
  desligados até o Prompt 10.

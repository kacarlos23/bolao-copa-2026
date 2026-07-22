# Evidência — Prompt 4, CONMEBOL Sul-Americana 2026

## Resultado da homologação

A fotografia foi revalidada no Prompt 5 em `2026-07-22T14:22:53-03:00`, timezone
`America/Sao_Paulo`, offset `-03:00`. O snapshot normalizado tem SHA-256
`44059d3a03f7cc9b8768674f83be5e781bf3efe7a9fc2228b9a21b08bc68b761`.
Essa revalidação acrescentou país/federação somente aos homônimos com
códigos curtos iguais (`NAC` e `RAC`), conforme os Manuais de Clubes, para
provar que a carga conjunta com a Libertadores não funde clubes distintos.

A fonte oficial continha 144 fixtures: 16 da fase preliminar, 96 da fase de
grupos, 16 dos playoffs e 16 slots das oitavas. Os slots das oitavas continham
participante `Unknown`, horário TBC e nenhum estádio; por isso não foram
transformados em `Team`, `Match` ou `Tie`. A chave e os oito caminhos das
oitavas, além dos cruzamentos posteriores, foram preservados como metadata dos
rounds. Os ties futuros serão criados somente quando ambos os participantes
forem oficialmente conhecidos.

A fotografia reconciliada registra:

- 56 `SeasonTeam`, sem nenhum clube `Unknown`;
- fases preliminar histórica, grupos e final;
- grupos A–H, seis rodadas, 32 linhas de standings e 96 resultados de grupo;
- 16 ties preliminares decididos, incluindo seis decisões por pênaltis, e oito
  ties de playoffs;
- exatamente um segundo colocado da Sul-Americana e um terceiro transferido da
  Libertadores em cada playoff;
- 128 partidas concretas e 114 resultados históricos;
- zero divergência entre J/V/E/D/GP/GC/PTS derivados e a tabela oficial;
- final em 21/11/2026, no Estadio Metropolitano Roberto Meléndez, Barranquilla;
- zero pontos gerados para o histórico.

## Fontes e checksums

| Fonte oficial                                                                                                                                                                    |    Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | ------------------------------------------------------------------ |
| [Manual de Clubes — página](https://www.conmebol.com/documentos/manual-de-clubes-conmebol-sudamericana-2026/)                                                                    |   210882 | `b2509b3678e19ec43429ee610dc106de733f0fa1b9fd0ca148eeac2840a90cf2` |
| [Manual de Clubes — PDF](https://cdn.conmebol.com/wp-content/uploads/2025/12/CS-2026-Manual-de-Clubes-ESP-Feb26.pdf)                                                             | 11679327 | `ab8bab858def7e9ce1a866fbec02eb90d18ae7223fe42bfa154c1597e2bd84ea` |
| [Calendário da fase de grupos](https://gol.conmebol.com/sudamericana/es/news/calendario-conmebol-sudamericana-2026-dias-horarios-y-sedes-de-la-fase-de-grupos)                   |   135819 | `60d3f3a3bf6bb96d9fc5a92b64096e338905fe240ab7eec4e3233a3b4dfc3ea7` |
| [Fixtures oficiais 2026](https://gol.conmebol.com/sudamericana/es/api/v2/tournament-fixtures/104)                                                                                |  2829885 | `f96dd491624652c3e2a6444aae63bab2fbcc2ef1ee0e7a4c4a9767e9a210832e` |
| [Classificação oficial](https://gol.conmebol.com/sudamericana/es/tournament-table/104)                                                                                           |   175251 | `eca79da34d8d158ee62aae36422bb894f9740715bce585e80902f28fdeb5b1ab` |
| [Definição dos playoffs](https://gol.conmebol.com/sudamericana/es/news/definidos-los-cruces-de-playoffs-de-la-conmebol-sudamericana)                                             |   124510 | `e9cc1adcccebbf7d7fce4b2d93a2e939310e7b3a6c105bce07035215c79ecf7c` |
| [Dias, horários e sedes dos playoffs](https://gol.conmebol.com/sudamericana/es/news/para-tomar-nota-asi-se-jugaran-los-playoffs-de-octavos-de-final-de-la-conmebol-sudamericana) |   122926 | `a400804888715d5c4f2185ce7c6e9cec098c35c52a998b5f6175dd2b17e6ce08` |
| [Chave das oitavas](https://gol.conmebol.com/sudamericana/es/news/asi-se-jugaran-los-octavos-de-final-de-la-conmebol-sudamericana)                                               |   131976 | `477d3c57b7ad9eafda882180b30e3714757ab359d7b945268776094dff5cafb5` |
| [Sede da final](https://gol.conmebol.com/sudamericana/es/news/barranquilla-sede-de-la-final-de-la-conmebol-sudamericana-2026)                                                    |   121462 | `3fc1360ebd3c146eb0d0514c9f50e8fd8336204f6cd9d26bd6fb5365487719a9` |
| Feed de standings exposto pela página oficial                                                                                                                                    |    13466 | `ebb7566d4a33c67a4eefc530a3e4c28d2985c49b7125c2b89bc6081a0e88bcbd` |

O URL completo do feed de standings, incluindo o identificador público que a
página oficial expunha no momento da coleta, está registrado no manifest do
snapshot. O coletor o redescobre a partir da página e não o trata como
configuração secreta ou eterna.

## Corte de pontuação e canário

O `PoolSeason` usa a versão 1 da regra 15/3/1/0,
`historicalMatchesScoreable=false` e
`scoreableFrom=2026-08-12T12:00:00.000Z`. Este é o primeiro slot futuro das
oitavas publicado no feed oficial no momento da homologação. Como o kickoff
ainda estava TBC, o corte precisa ser revalidado e, se necessário, movido para
a próxima fase antes de habilitar escrita.

A temporada permanece `DRAFT`. As flags independentes `readEnabled`,
`writeEnabled`, `uiEnabled` e `syncEnabled` estão `false`. O provider está
configurado, mas o scheduler consulta `syncEnabled`; portanto a carga manual de
homologação não publica nem atualiza automaticamente a temporada.

## Gates executáveis

```powershell
npm run collect:sudamericana-2026
npm run reconcile:sudamericana-2026 -- --dry-run
npm run load:sudamericana-2026 -- --dry-run
npm run load:sudamericana-2026 -- --apply
npm run load:sudamericana-2026 -- --verify
npm run reconcile:sudamericana-2026 -- --verify-db
```

O `--verify` exige zero inserts, updates e quarentenas para `TEAMS`,
`STRUCTURE`, `TIES`, `SCHEDULE`, `RESULTS` e `STANDINGS`. O smoke administrativo
confere contagens, regra, corte, zero score histórico, provider e as quatro flags
desligadas. A reconciliação de banco também exige que os oito IDs transferidos
da Libertadores apontem para no máximo um `Team` global cada.

Nenhuma migration nova foi necessária neste prompt. As duas migrations
aditivas dos Prompts 2 e 3 foram aplicadas no banco local de homologação antes
da carga; o snapshot de preservação permaneceu idêntico após essa aplicação.

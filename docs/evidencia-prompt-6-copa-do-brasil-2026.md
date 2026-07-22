# Evidência — Prompt 6, Copa do Brasil 2026

Data da coleta: `2026-07-22T22:06:51.967Z`

Timezone de coleta e temporada: `America/Sao_Paulo`

Offset original: `-03:00`

Ambiente: banco PostgreSQL local de teste; nenhuma escrita em produção.

## Fontes oficiais revalidadas

As fontes primárias usadas no snapshot são:

- [REC, PGA e tabela básica divulgados pela CBF](https://www.cbf.com.br/futebol-brasileiro/noticias/undefined/csa-x-bahia/cbf-divulga-tabela-basica-plano-geral-de-acoes-e-regulamento-especifico-da-copa-do-brasil-2026)
- [Nota oficial da CBF sobre os 126 participantes](https://www.cbf.com.br/futebol-brasileiro/noticias/selecao-masculina/nota-oficial-paqueta/copa-do-brasil-de-2026-tera-recorde-de-participantes-e-17-estreantes)
- [Tabela oficial por fase](https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026)
- [Tabela detalhada da sexta fase](https://www.cbf.com.br/futebol-brasileiro/noticias/copa-brasil/copa-brasil-masculino/cbf-divulga-tabela-detalhada-da-6-fase-da-copa-betano-do-brasil)

Documentos fixados no snapshot:

| Documento                     | URL                                                                                                                                 |  Bytes | SHA-256                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| REC                           | `https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Copa_do_Brasil_2026_66989a5426.pdf`                              | 601120 | `3f26faa8031ed699de74456102f9cada86e6fe4989d586b5e51faa22d5bd22df` |
| PGA                           | `https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/PGA_Copa_do_Brasil_2026_b8ea9aaeb8.pdf`                              | 485611 | `3272333933a386e13343a3c44efd6258a188b52d1a696e20edb34d7fded78bf6` |
| Tabela básica                 | `https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Basica_Copa_do_Brasil_2026_77efe8f233.pdf`                    | 385562 | `6ccf0a573f95756cdeb4c2506e9f4d9d1cbff57b0666a1db9988a031fea6f2c3` |
| Tabela detalhada — sexta fase | `https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Detalhada_6_Fase_Copa_Betano_do_Brasil_2026_1_ecf9a829ca.pdf` | 267584 | `0fdb993a01f437fae1660bbb5481c86269f07d8ef439443e5e4075003353f8a3` |

Páginas detalhadas coletadas: fases 1–6, IDs CBF `1995`, `1996`, `1997`, `1998`, `1999` e `2000`. O snapshot imutável final é [cbf-copa-do-brasil-2026.sanitized.json](../apps/api/src/modules/providers/__fixtures__/official/cbf-copa-do-brasil-2026.sanitized.json), com checksum de evidência `2745514a9a032c95115391c47bcb25b7a43044be26062aafe2e9f2fcd394f76a`.

## Formato homologado e reconciliação

O REC confirma nove fases, sem tabela de liga/grupo:

|          Fase | Formato     | Participantes/entrada                                      | Ties |                       Jogos | Situação coletada        |
| ------------: | ----------- | ---------------------------------------------------------- | ---: | --------------------------: | ------------------------ |
|             1 | Jogo único  | 28 clubes, critério 3                                      |   14 |                          14 | Finalizada               |
|             2 | Jogo único  | 14 vencedores da fase 1 + 74 clubes, critério 3            |   44 |                          44 | Finalizada               |
|             3 | Jogo único  | 44 vencedores da fase 2 + 4 clubes, critério 2             |   24 |                          24 | Finalizada               |
|             4 | Jogo único  | 24 vencedores da fase 3                                    |   12 |                          12 | Finalizada               |
|             5 | Ida e volta | 12 vencedores da fase 4 + 20 clubes da Série A, critério 1 |   16 |                          32 | Finalizada               |
|   6 — oitavas | Ida e volta | 16 vencedores da fase 5                                    |    8 |                          16 | Agendada, sem resultado  |
|   7 — quartas | Ida e volta | 8 classificados                                            |    4 | 0 concreto; 4 slots tardios | Aguardando classificação |
| 8 — semifinal | Ida e volta | 4 classificados                                            |    2 | 0 concreto; 2 slots tardios | Aguardando classificação |
|     9 — final | Jogo único  | 2 classificados                                            |    1 |   0 concreto; 1 slot tardio | Aguardando classificação |

Totais reconciliados: `126` clubes em `SeasonTeam`, `1` stage knockout, `9` rounds, `118` ties, `142` partidas e `126` resultados históricos. Entradas tardias armazenadas em metadata: fase 1 `28`, fase 2 `74`, fase 3 `4`, fase 4 `0`, fase 5 `20`; a soma não exige que os clubes estejam ativos na mesma rodada.

O REC também foi aplicado nas validações de mando: sorteio/designação oficial nas fases 1–4; regras de sorteio e Anexo na fase 5; sorteio nas oitavas e quartas; sorteio público nas semifinais; retorno com mando invertido nas séries; e mando/local da final definido pela CBF. Empates em jogo único e na final são decididos por pênaltis. Nas fases de dois jogos, primeiro se aplica o saldo agregado e, persistindo empate, pênaltis; não foi criado critério de gol fora.

Foram preservados os `externalId` estáveis de `Match` e `Tie`, inclusive na representação da inversão de mando da segunda perna. A reconciliação corrige participantes oficiais com identidade `CBF_EXTERNAL_ID` e, quando necessário, desanexa/reassocia a partida na mesma transação para satisfazer as constraints sem recriar IDs.

## Corte, regras e flags

- Competição: slug `copa-do-brasil`.
- Temporada: `copa-do-brasil-2026`, ano 2026, status administrativo `DRAFT`.
- Capabilities: `KNOCKOUT`, `TWO_LEGS`, `LIVE_SCORING`; standings desligado.
- `PoolSeason` e regra `copa-do-brasil` versão 1: `15/3/1/0`.
- `historicalMatchesScoreable=false`; os 126 resultados anteriores não geraram pontos.
- Primeiro jogo futuro homologado: fase 6, Vasco da Gama x Fluminense, `2026-08-01T20:30:00.000Z` (`01/08/2026 17:30 -03:00`); `scoreableFromRound=6`, `startsAtRound=6`.
- A coleta registrou a sexta fase ainda não iniciada (`0` resultados); portanto o corte não precisou ser adiado para a fase posterior. A política permanece condicionada à revalidação do primeiro kickoff futuro antes de uma futura abertura.
- UI, escrita pública, leitura pública e sync público permanecem `false` nas feature flags.
- O provider da Copa usa a infraestrutura HTTP/cache/auditoria e o pipeline normalizado do provider CBF da Série A, mas possui parser, IDs CBF, readiness, fixture e validações próprios. A configuração local habilita somente `TEAMS`, `STRUCTURE`, `TIES`, `SCHEDULE` e `RESULTS`, sem `STANDINGS`.

## Operação e gates

Scripts adicionados:

- `collect:copa-do-brasil-2026` — coleta oficial, valida readiness e grava snapshot sanitizado;
- `load:copa-do-brasil-2026 --dry-run|--apply|--verify` — prepara e reconcilia de forma idempotente;
- `reconcile:copa-do-brasil-2026 --dry-run|--apply|--verify` — confere cardinalidade por fase, IDs, resultados e pênaltis.

Resultados finais:

- `load --apply`: PASS; smoke administrativo PASS; 126 clubes, 9 rounds, 118 ties, 142 partidas, 0 quarentenas.
- `load --verify`: PASS; `0` inserts, `0` updates, `0` quarentenas em todos os cinco tipos.
- `reconcile --dry-run`: PASS; partidas por fase `[14,44,24,12,32,16,0,0,0]`, resultados `[14,44,24,12,32,0,0,0,0]`, ties `[14,44,24,12,16,8,0,0,0]`.
- `reconcile --apply`: PASS.
- `reconcile --verify`: PASS; import idempotente.
- Testes unitários: nove fases, entradas tardias, jogo único, ida/volta, pênaltis, final, cutoff e 126 clubes.
- Prisma: `17 migrations found`; banco local atualizado; nenhuma migration nova foi criada no Prompt 6.
- `test:migration:constraints`: PASS em banco isolado; 9 cruzamentos inválidos rejeitados e transação revertida.
- `gate:pr`: PASS; lint, preservação, shared/API/web, contratos, go-live evidence, auditoria, builds e budget.
- `gate:release-candidate`: PASS; integração PostgreSQL, E2E `58/58`, load budget e flakiness.
- `gate:migration`: PASS; rehearsal com restore, avatares e snapshots antes/depois idênticos.

## Preservação e hashes

Foi criado snapshot não versionado antes e depois com `snapshot:copa -- --backfill`. A comparação pós-carga repetida foi `Snapshots identicos.`. A comparação inicial contra a baseline anterior à aplicação das migrations já existentes apresentou somente as duas diferenças explicadas pela migration aditiva de scoring/gamificação (`20260718010000_stage7_scoring_gamification`), que preenche colunas novas em `PredictionScore` e `RankingSnapshot`:

- `businessContentHashes.PredictionScore`: `d19c373105a18ab3756534023160d77f541d945635a9b8ee6a2eb475efdd0da3` → `6d1f674e1dcac39a6718c352fd532469ed5f579aaddf68f218a50b22b3bf118d`;
- `businessContentHashes.RankingSnapshot`: `9f6f4da2fab509587aa5691f8b569aae0f823fb3e179aa8bed026f8688062b24` → `d1f84d41f8e1884afaecb3af83d1387973e66beb0f39421caec19af66347be2b`.

As contagens e hashes das entidades preservadas permaneceram estáveis no segundo snapshot; não houve alteração de usuários, palpites, jogos ou scores da Copa do Mundo. Os artefatos de snapshot foram mantidos fora do Git.

## Riscos residuais

As fases 7–9 estão representadas como rounds e slots, mas não receberam partidas concretas porque a fonte oficial coletada ainda não homologava seus classificados/calendário. A temporada continua em `DRAFT` e as flags públicas permanecem desligadas. Nova homologação da CBF deve gerar um novo snapshot, revalidar o cutoff e executar novamente `load --verify`/`reconcile --verify` antes de qualquer canário futuro.

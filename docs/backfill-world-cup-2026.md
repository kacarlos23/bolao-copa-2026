# Backfill da Copa do Mundo 2026

O comando abaixo preenche o modelo multi-competição depois da migration
`20260714234454_add_multi_competition_model`:

```powershell
npm run backfill:world-cup-2026 -- --report .\snapshots\backfill-report.json
```

O backfill roda em uma transação `SERIALIZABLE`, usa um advisory lock para impedir
duas execuções concorrentes e aborta se detectar alteração em IDs, palpites,
resultados, pontos ou posições. O relatório JSON contém contagens antes/depois,
deltas, IDs criados e hashes de preservação. O diretório `snapshots/` continua
ignorado pelo Git.

## Identidades e estrutura

As identidades padrão são determinísticas:

- `Competition`: `competition-world-cup`, slug `world-cup`;
- `CompetitionSeason`: `competition-season-world-cup-2026`, slug
  `world-cup-2026`;
- `Pool`: `pool-bolao-do-trabalho`, slug `bolao-do-trabalho`;
- `PoolSeason`: `pool-season-bolao-do-trabalho-world-cup-2026`;
- `ScoringRuleSet`: `scoring-rule-set-15-3-1-0-v1`.

Se uma entidade com a mesma chave natural já existir, seu ID é preservado e
somente campos divergentes são corrigidos. IDs das entidades de junção e dos
mappings são derivados por SHA-256 da chave natural.

A fase de grupos usa um `Stage` com três `Round`s e todas as partidas legadas são
associadas à rodada indicada em `rawPayload.round`, com fallback para a tabela
oficial local. O mata-mata usa outro `Stage` e seis `Round`s descritivos. A lógica
existente continua baseada em `KnockoutFixture.stage`; nenhum fixture, palpite ou
serviço público foi convertido para outro modelo.

O status da temporada é `FINISHED` apenas quando a final e todos os jogos
armazenados estão encerrados. Enquanto houver dados não encerrados, é `ACTIVE`.
Em banco vazio, o calendário oficial local decide entre `DRAFT`, `ACTIVE` e
`FINISHED`.

## Escopo vinculado

O comando associa:

- seleções da Copa a `SeasonTeam` e as classifica como `NATIONAL_TEAM`;
- partidas da fase de grupos, seus `MatchDay`s e palpites/scores relacionados;
- fixtures, gerações e chaves do mata-mata;
- snapshots de ranking legados;
- todos os usuários com papel `USER` ou atividade de palpite/ranking ao pool;
- IDs de `Team.externalId`, `Match.externalId` e números oficiais 73–104 a
  `ProviderEntityMapping`;
- o conjunto de regras imutável 15/3/1/0 ao `PoolSeason`.

## Comparação de snapshots

Para uma mudança estrutural, gere snapshots com `--backfill`. O snapshot mantém
o hash físico integral e acrescenta hashes das colunas de negócio, excluindo
somente as novas FKs, os novos campos aditivos e `updatedAt` alterado pelo
preenchimento dessas FKs:

```powershell
npm run snapshot:copa -- --backfill --output .\snapshots\before.json
npm run backfill:world-cup-2026 -- --report .\snapshots\report.json
npm run snapshot:copa -- --backfill --output .\snapshots\after.json
npm run snapshot:compare -- --backfill .\snapshots\before.json .\snapshots\after.json
```

Para provar idempotência byte a byte, capture um snapshot normal depois da
primeira execução, rode o backfill novamente e use o comparador sem a opção
`--backfill`.

## Evidência local de 14/07/2026

Em uma cópia restaurada do banco atual, a primeira execução criou 1 competição,
1 temporada ativa, 2 stages, 9 rounds, 48 `SeasonTeam`, 1 pool, 1 membership,
1 `PoolSeason`, 1 regra e 152 mappings. Foram vinculados 17 `MatchDay`, 72
partidas, 72 palpites, 20 scores, 32 fixtures, 1 geração, 1 chave e 1 snapshot de
ranking. Os hashes protegidos ficaram idênticos antes/depois.

Na segunda execução, todos os 21 deltas do relatório foram zero e o snapshot
físico integral permaneceu idêntico. O ensaio separado em banco limpo aplicou as
cinco migrations, executou o seed do administrador, criou a estrutura padrão e
também produziu deltas zero e snapshot integral idêntico na segunda execução.
O banco local original foi usado somente para dump e snapshot de leitura e
continuou sem a migration multi-competição aplicada.

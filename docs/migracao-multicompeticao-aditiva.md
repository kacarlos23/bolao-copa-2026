# Migração aditiva para múltiplas competições

## Escopo

A migration `20260714234454_add_multi_competition_model` implementa somente a
fase de expansão do modelo. Ela não faz backfill, não muda consultas de negócio
e não remove nem renomeia tabelas, colunas, índices, constraints ou rotas.

As entidades esportivas novas são `Competition`, `CompetitionSeason`, `Stage`,
`Round` e `SeasonTeam`. `Pool`, `PoolMembership` e `PoolSeason` separam o escopo
social do escopo esportivo. `ScoringRuleSet` guarda uma versão imutável de
regras em JSON, e `ProviderEntityMapping` preserva a identidade externa e a
proveniência por provider.

Todas as FKs adicionadas a tabelas legadas são nullable. As FKs obrigatórias
existem somente entre tabelas novas e vazias.

## Diagrama textual das relações

```text
Competition 1
└── N CompetitionSeason
    ├── N Stage
    │   └── N Round
    │       ├── N Match (roundId opcional na fase de expansão)
    │       └── N RankingSnapshot (roundId opcional)
    ├── N SeasonTeam N ── 1 Team
    ├── N MatchDay (seasonId opcional)
    ├── N Match (seasonId/stageId/roundId opcionais)
    ├── N KnockoutFixture (seasonId opcional)
    ├── N KnockoutGeneration (seasonId opcional)
    └── N ProviderEntityMapping (seasonId opcional; alvo polimórfico)

Pool 1
├── N PoolMembership N ── 1 User
└── N PoolSeason N ── 1 CompetitionSeason
    ├── 0..1 ScoringRuleSet
    ├── N Prediction (poolSeasonId opcional)
    ├── N PredictionScore (poolSeasonId opcional)
    ├── N RankingSnapshot (poolSeasonId opcional)
    └── N KnockoutBracket (poolSeasonId opcional)
```

`ProviderEntityMapping.internalId` é deliberadamente polimórfico. A combinação
`provider + entityType + externalId` é única; `entityType` identifica qual
tabela interna contém `internalId`. Uma FK polimórfica não pode ser expressa
pelo PostgreSQL, por isso a temporada opcional é a relação relacional de
escopo e a validação do alvo fica para a futura camada de importação.

## Compatibilidade preservada

- `Team.externalId` continua `@unique`. `type` e `crestUrl` são opcionais.
- `Match.externalId`, `KnockoutFixture.matchNumber` e as demais unicidades
  legadas permanecem inalteradas.
- `MatchDay_date_key` continua garantindo a unicidade global de `date`.
  A migration cria apenas o índice não único `(seasonId, date)`.
- `Prediction_userId_matchId_key` continua ativa. Os novos `poolSeasonId` de
  `Prediction` e `PredictionScore` são opcionais e possuem índices de consulta,
  mas ainda não substituem a identidade legada.
- `Match.predictionClosesAt` é opcional. Enquanto estiver nulo, o runtime atual
  continua usando `MatchDay.predictionsCloseAt`, pois nenhuma consulta foi
  alterada nesta entrega.
- O mata-mata legado não foi unificado com `Stage`/`Round`.

## Contratos adiados com segurança

A troca de `MatchDay_date_key` por `UNIQUE (seasonId, date)` foi adiada. Uma
migration posterior deve primeiro executar um backfill idempotente, provar que
nenhum `seasonId` está nulo, verificar que não há duplicidades em
`(seasonId, date)`, criar a nova unicidade e observar o dual write. A constraint
global só poderá ser removida em uma fase de contract posterior.

O mesmo vale para `Prediction`: depois do backfill de `poolSeasonId` e da prova
de que palpite, partida, membership e `PoolSeason` pertencem ao mesmo contexto,
deve ser criada a unicidade `(poolSeasonId, userId, matchId)`. A unicidade antiga
não é removida nesta fase.

Não há valores iniciais de Copa inseridos nesta migration. A criação de
`world-cup`, `world-cup-2026`, pool padrão, regras 15/3/1/0 e o preenchimento das
FKs legadas pertencem ao backfill idempotente subsequente e devem ser ensaiados
com as assinaturas de preservação da Copa.

## Índices adicionados

As consultas esportivas passam a ter suporte estrutural para os caminhos mais
frequentes, sem que o runtime os use ainda:

- `Match(seasonId, status, startsAt)`;
- `Match(seasonId, roundId, status, startsAt)`;
- `Round(seasonId, status, startsAt)`;
- `MatchDay(seasonId, status, predictionsCloseAt)`;
- `KnockoutFixture(seasonId, stage, status, startsAt)`;
- snapshots por `(seasonId, roundId, calculatedAt)` e por
  `(poolSeasonId, roundId, calculatedAt)`;
- palpites e scores por `poolSeasonId` combinado com partida ou usuário.

## Locks potenciais e aplicação operacional

O SQL gerado não contém transação explícita. Cada `ALTER TABLE ... ADD COLUMN`
nullable e sem default é uma alteração de catálogo, sem reescrita das linhas,
mas requer `ACCESS EXCLUSIVE` enquanto o comando curto é executado.

Os `CREATE INDEX` das tabelas legadas não usam `CONCURRENTLY`. Leituras podem
continuar, mas escritas na tabela indexada aguardam o fim da varredura. Os
maiores candidatos são `Match`, `Prediction`, `PredictionScore` e
`RankingSnapshot`; a duração deve ser medida no rehearsal da cópia de tamanho
real. Se exceder a janela aprovada, os índices dessas tabelas devem ser movidos,
antes do deploy, para uma migration operacional separada com `CREATE INDEX
CONCURRENTLY`, tratamento de índice inválido e execução fora de transação.

As FKs sobre colunas legadas são adicionadas depois dos índices. Elas precisam
de locks de DDL nas tabelas envolvidas e validam as linhas existentes; como as
colunas acabaram de ser criadas e estão todas nulas, não existe lookup de pai
nem possibilidade de violação nesta fase. Ainda assim, a aplicação deve ocorrer
com `lock_timeout`/monitoramento definidos pela operação e sem outra migration
concorrente.

Uma falha operacional deve reverter a versão da aplicação e corrigir/reaplicar
a migration aditiva. Não se recomenda remover as novas estruturas como forma de
rollback, e restauração de banco não é necessária para rollback normal.

## Checklist de revisão do SQL

- nenhum `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT` ou `RENAME`;
- nenhuma tabela recriada;
- nenhuma coluna legada tornada `NOT NULL`;
- nenhuma constraint ou rota existente removida;
- nenhuma mudança em dados de negócio;
- novos relacionamentos legados usam `ON DELETE SET NULL`;
- relacionamentos obrigatórios se restringem a tabelas novas.

## Evidência do rehearsal local

Em 14/07/2026, a migration foi aplicada primeiro em um banco PostgreSQL 16
limpo, depois das quatro migrations anteriores, e `prisma migrate status`
confirmou as cinco migrations aplicadas.

Um segundo ensaio foi feito sobre uma cópia restaurada do banco local atual. A
aplicação levou **6,139 segundos**. Antes da migration foram capturados, para
cada uma das 17 tabelas legadas, a lista ordenada de colunas, a contagem de
linhas e um SHA-256 determinístico do conteúdo. Depois da migration, as mesmas
colunas foram lidas novamente: todas as contagens e todos os hashes ficaram
idênticos. Uma verificação adicional confirmou que todas as colunas novas nas
tabelas legadas permaneceram nulas.

A cópia atual também continha `user_sessions`, tabela operacional criada pelo
store de sessão e não gerenciada pelo schema Prisma. Esse drift preexistente foi
preservado e não impediu `prisma migrate deploy`; a equivalência exata entre o
schema Prisma e as cinco migrations foi verificada separadamente no banco limpo.

O banco local original foi consultado apenas para leitura e continuou com
`20260714234454_add_multi_competition_model` pendente ao final do ensaio.

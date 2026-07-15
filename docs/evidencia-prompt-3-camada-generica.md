# Evidência — Prompt 3, camada genérica de competições

## Escopo implementado

- Rotas autenticadas e paginadas para competições, temporadas, rodadas,
  partidas, standings, ranking, palpites e prêmios.
- DTOs e schemas Zod strict em `@bolao/shared`; respostas não usam modelos
  Prisma como contrato.
- Resolução server-side de Pool, membership ACTIVE e PoolSeason. O papel ADMIN
  global não concede membership.
- Escrita de palpite em transação SERIALIZABLE, incluindo fechamento e provas
  Match → MatchDay → Season e PoolSeason → Season.
- Outbox aditiva com envelope SSE v1 (`eventId`, `occurredAt`, `seasonId`,
  `poolSeasonId`, `version`) e entrega após commit.
- Aliases da Copa resolvem IDs pela configuração `WORLD_CUP_CONTEXT` e chamam
  os mesmos casos de uso, sem decisão esportiva por slug.

## Gate automatizado

Os testes de contrato cobrem schema strict, erro seguro com requestId,
membership, cruzamento de PoolSeason, cruzamento de Match, fechamento
transacional, ordem commit/outbox, filtro SSE por season/pool e paridade do
ranking antigo/novo.

## Telemetria exigida antes da contract phase

Não retirar rotas legadas até observar, por uma janela que cubra ao menos um
ciclo completo de jogos:

1. volume e taxa de erro por `legacyAlias`, `seasonId`, `poolSeasonId` e versão
   do cliente; os aliases agora emitem esses campos em log estruturado;
2. assinaturas shadow de status/body para alias e rota genérica, separando
   diferenças apenas de paginação/envelope;
3. contagem de rejeições `POOL_MEMBERSHIP_REQUIRED`,
   `POOL_SEASON_NOT_FOUND`, `MATCH_SEASON_MISMATCH` e fechamento;
4. linhas ainda nulas em `Match.seasonId`, `Prediction.poolSeasonId`, scores e
   snapshots, além de tentativas de violação das constraints da Etapa 2;
5. backlog, idade máxima, tentativas e `lastError` de `OutboxEvent` por
   season/pool; nenhuma publicação pode anteceder commit;
6. conexões e entregas SSE por season/pool, reconnect, backpressure e versões
   de evento desconhecidas;
7. p95/p99 e rows-read das novas queries paginadas e saturação do pool de
   conexões.

A remoção também depende de zero consumidores legados identificados, paridade
shadow sustentada e autorização explícita para a contract phase posterior.

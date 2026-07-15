# Diagramas de entidades e fluxos

## Entidades e cardinalidades

```text
Competition 1 ── N CompetitionSeason 1 ── N Stage 1 ── N Round
                              │              │             └── N Match
                              │              └── N Match
                              ├── N SeasonTeam N ── 1 Team
                              └── N ProviderEntityMapping

Pool 1 ── N PoolMembership N ── 1 User
 └── N PoolSeason N ── 1 CompetitionSeason
       ├── 1 ScoringRuleSetVersion
       ├── N Prediction N ── 1 Match
       │      └── 0..1 PredictionScore
       └── N RankingSnapshot
```

Durante expand, algumas FKs legadas são nullable. Isso é compatibilidade
física, não permissão de domínio. Escritas novas usam `seasonId` e
`poolSeasonId`; constraints e serviços rejeitam relação cruzada.

## Salvar palpite

```text
cliente → API: seasonId + poolSeasonId + matchId + placar + CSRF
API → banco: revalidar sessão e membership
API → transação: carregar PoolSeason e Match
transação: provar Match.seasonId = PoolSeason.seasonId
transação: calcular closesAt na timezone/instante configurado
transação: se now >= closesAt, abortar 409
transação: upsert Prediction(poolSeasonId,userId,matchId)
commit → outbox/SSE: prediction.updated versionado
```

## Sync de provider

```text
adapter → DTO normalizado → schema estrito → mapping/reconciliação
        → dry-run/diff → quarantine de ambiguidade → transação curta
        → dados finais + provenance + outbox → evento após commit
```

## Ranking

```text
result.changed(ruleSetVersion)
  → scores determinísticos por PoolSeason
  → ordenação por TieBreakerRuleSetVersion
  → RankingSnapshot(poolSeasonId,roundId,calculatedAt)
  → outbox → SSE filtrável por season/pool
```

## Evento realtime

```text
transação de negócio → registro Outbox(eventId, version, contexto)
commit → dispatcher idempotente → SSE
reconnect(lastEventId) → replay limitado ou refresh seguro
shutdown → parar dispatcher → drenar clientes → fechar heartbeat
```

## Backup e restore

```text
pausar writes/jobs
  → snapshot REPEATABLE READ + hashes de negócio
  → pg_dump custom + globals sanitizados
  → ZIP de avatares + manifests SHA-256
  → validar artefatos

destino isolado → restore DB → restore avatares → migrations/status
                → snapshot restaurado → comparar hashes → smoke
                → remover destino temporário
```

Rollback normal reverte a aplicação/flags e preserva o schema aditivo. Restore
é reservado a corrupção confirmada e janela aprovada.

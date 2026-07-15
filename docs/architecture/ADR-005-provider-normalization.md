# ADR-005 — normalização de providers

- Status: Aceito
- Data: 2026-07-14

## Contexto

O sincronizador GE mistura fetch, parsing, reconciliação e escrita. Novas
fontes exigem provenance, limites e fallback sem permitir URL arbitrária.

## Alternativas

1. Cada provider escrever no Prisma: rejeitada.
2. Importar por nome do time: rejeitada por ambiguidade.
3. Port `CompetitionDataProvider`, DTO normalizado e mappings: escolhida.

## Decisão

Adapters GE, fonte oficial/CBF, CSV e manual produzem DTOs estritos. O pipeline
único executa fetch limitado, normaliza, resolve ProviderEntityMapping por
externalId, reconcilia, oferece dry-run/diff e somente então aplica. Mapping
guarda provider, entityType, externalId, internalId, season, sourceUrl,
collectedAt, checksum e metadata. Ambiguidade entra em quarantine. Override
manual auditado tem precedência e não é apagado pelo sync.

## Consequências

Imports ficam mais explícitos e auditáveis. Toda fonte usa o mesmo validador;
CSV/manual não contornam invariantes.

## Invariantes testáveis

- `(provider,entityType,externalId)` é único.
- Segunda carga idêntica gera zero inserts indevidos.
- Match ID sobrevive a remarcação.
- FINISHED não regride automaticamente; override sobrevive ao sync.
- Timeout, bytes excessivos e redirect encerram recursos e liberam lock.

## Compatibilidade, rollout e rollback

GE atual vira primeiro adapter sem mudar Match IDs. Mapping/backfill é aditivo.
Flags desligam apply e mantêm dry-run/CSV/manual. Rollback pausa sync e reverte
aplicação; mappings/provenance permanecem para auditoria.

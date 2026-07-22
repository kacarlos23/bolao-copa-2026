# ADR-005 — normalização de providers

- Status: Aceito
- Data: 2026-07-14
- Expansão para copas: 2026-07-22

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

Desde a expansão das copas, `SeasonProviderConfig` é a única fonte de seleção
de provider para API, scheduler e administração. A tabela persiste prioridade,
tipos habilitados (`TEAMS`, `STRUCTURE`, `TIES`, `SCHEDULE`, `RESULTS` e
`STANDINGS`), cadência, timeout, estado, origem, provenance e configuração não
sensível. A metadata transitória do Prompt 1 é copiada por migration e mantida
somente como evidência histórica; o runtime não a consulta para selecionar fonte.

O adapter `conmebol-official` é compartilhado por Libertadores e Sul-Americana.
O adapter `cbf-copa-do-brasil-official` compartilha contratos e infraestrutura,
mas não parser nem readiness com `CbfSerieA2026Provider`. Os adapters das copas
consomem snapshots locais imutáveis com pins SHA-256 de página, PDF e resposta;
CI nunca consulta endpoints reais.

Mappings novos usam simultaneamente `scopeKey=season:<seasonId>` e externalId
persistido com namespace de temporada. A chave legada global permanece durante
expand–migrate–contract e é lida como fallback para preservar GE, Copa e
Brasileirão existentes.

## Consequências

Imports ficam mais explícitos e auditáveis. Toda fonte usa o mesmo validador;
CSV/manual não contornam invariantes.

## Invariantes testáveis

- `(provider,entityType,externalId)` é único.
- Segunda carga idêntica gera zero inserts indevidos.
- Match ID sobrevive a remarcação.
- FINISHED não regride automaticamente; override sobrevive ao sync.
- Timeout, bytes excessivos e redirect encerram recursos e liberam lock.
- Segunda carga dos formatos grupo+híbrido, mata-mata de jogo único e ida/volta
  não cria `Team`, `Stage`, `Round`, `Tie` ou `Match` duplicado.
- Resultado esportivo declarado pelo provider não classifica equipe antes da
  recomputação integral; apenas W.O. e decisão administrativa são declarações.

## Compatibilidade, rollout e rollback

GE atual vira primeiro adapter sem mudar Match IDs. Mapping/backfill é aditivo.
Flags desligam apply e mantêm dry-run/CSV/manual. Rollback pausa sync e reverte
aplicação; mappings/provenance permanecem para auditoria.

# ADR-008 — eventos realtime e outbox

- Status: Aceito
- Data: 2026-07-14

## Contexto

SSE atual publica após chamadas de serviço, sem envelope versionado, replay ou
garantia transacional. Clientes lentos e shutdown também exigem controle.

## Alternativas

1. Emitir SSE dentro da transação: rejeitada por evento fantasma em rollback.
2. Broker externo imediato: adiado por complexidade operacional.
3. Outbox PostgreSQL + dispatcher SSE: escolhida para Etapa 3.

## Decisão

Toda mudança observável grava outbox na mesma transação. O dispatcher publica
após commit e marca entrega de forma idempotente. Envelope mínimo:

```json
{
  "eventId": "cuid",
  "type": "prediction.updated",
  "occurredAt": "2026-07-14T00:00:00.000Z",
  "seasonId": "competition-season-world-cup-2026",
  "poolSeasonId": "pool-season-bolao-do-trabalho-world-cup-2026",
  "version": 1,
  "payload": {}
}
```

Eventos exclusivamente esportivos podem ter poolSeasonId nulo; eventos sociais
nunca. SSE aplica limite de clientes, heartbeat único, backpressure, cleanup e
shutdown. Payload não contém PII desnecessária.

## Consequências

Consistência melhora ao custo de tabela/dispatcher novos na Etapa 3. Consumidor
deduplica por eventId e rejeita versão desconhecida de forma segura.

## Invariantes testáveis

- Rollback não publica evento.
- Replay do mesmo eventId não duplica efeito.
- Evento é filtrável por season/pool e possui occurredAt/version.
- Cliente lento não causa buffer ilimitado; shutdown zera clientes/timers.

## Compatibilidade, rollout e rollback

Eventos legados permanecem durante dual publish, marcados como versão 0 apenas
internamente. Cliente novo prefere envelope v1. Rollback para o dispatcher
antigo preserva outbox pendente; nenhuma linha é descartada.

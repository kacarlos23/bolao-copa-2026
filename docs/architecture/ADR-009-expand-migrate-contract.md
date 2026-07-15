# ADR-009 — expand–migrate–contract e aliases da Copa

- Status: Aceito
- Data: 2026-07-14

## Contexto

O schema e rotas globais precisam evoluir sem janela de indisponibilidade nem
alteração da Copa. Remover constraints/colunas cedo impediria rollback.

## Alternativas

1. Migração big-bang: rejeitada.
2. Novo banco e cópia: rejeitada por risco de IDs/divergência.
3. Expand, backfill/dual write, contract posterior: escolhida.

## Decisão

Sequência obrigatória:

1. expand: criar tabelas, colunas nullable, índices e constraints compatíveis;
2. migrate: backfill idempotente sob lock, dual write e shadow read;
3. application switch: casos de uso exigem contexto e rotas da Copa resolvem os
   IDs determinísticos por alias, sem regra duplicada;
4. contract: somente após Etapa 9, telemetria e autorização explícita.

O alias da Copa resolve IDs de compatibilidade, nunca formato pelo slug. A
Etapa 2 mantém `MatchDay(date)` e `Prediction(userId,matchId)` legados enquanto
acrescenta unicidades compostas novas.

## Consequências

Há redundância temporária e ordem de deploy obrigatória: migration, backfill,
aplicação dual write, shadow read, switch. Contract fica fora do go-live.

## Invariantes testáveis

- Migration não contém DROP/TRUNCATE/DELETE nem NOT NULL em FK legada sem backfill.
- Backfill repetido produz deltas zero.
- Rotas antiga/nova têm paridade para a Copa.
- Rollback de aplicação funciona sem rollback do schema.

## Compatibilidade, rollout e rollback

Flags independentes controlam leitura, escrita e UI nova. Em rollback, desligar
escrita/UI, parar sync e reverter aplicação. Restore somente para corrupção;
nunca remover estruturas aditivas como resposta operacional comum.

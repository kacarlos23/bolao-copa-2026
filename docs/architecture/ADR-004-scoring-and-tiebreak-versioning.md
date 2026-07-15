# ADR-004 — pontuação, desempate e fechamento

- Status: Aceito
- Data: 2026-07-14

## Contexto

O sistema 15/3/1/0 e os desempates atuais precisam permanecer reproduzíveis.
Também havia corrida entre verificação de prazo e escrita do palpite.

## Alternativas

1. Regras mutáveis em AppSetting: rejeitada por alterar histórico.
2. Recalcular sempre pela regra vigente: rejeitada.
3. Rule sets imutáveis referenciados por PoolSeason/score: escolhida.

## Decisão

ScoringRuleSetVersion e TieBreakerRuleSetVersion são imutáveis depois de
associados a temporada iniciada. A Etapa 2 registra a versão inicial 15/3/1/0;
a modelagem completa de versão/breakdown entra na Etapa 7 sem recalcular a Copa.

Cada Match possui instante individual `predictionClosesAt`; se ausente durante
compatibilidade, o alias calcula a partir do kickoff e configuração preservada.
O palpite está fechado quando `now >= closesAt`. Validação de contexto, prazo e
upsert ocorrem na mesma transação. Datas são armazenadas em UTC.

## Consequências

Correção de resultado gera recomputação idempotente/auditada pela mesma
versão. Nova regra exige nova versão e rollout explícito.

## Invariantes testáveis

- O instante exato do limite retorna 409 e não grava.
- Score histórico identifica a versão que o produziu após Etapa 7.
- Replay com mesma versão produz o mesmo score/ranking.
- Desempate tem ordem total determinística e é exibido antes do início.

## Compatibilidade, rollout e rollback

A versão inicial apenas descreve a regra atual. Colunas legadas de score ficam
ativas; dual write posterior acrescenta versão/breakdown. Rollback usa a
implementação 15/3/1/0 existente sem remover rule sets.

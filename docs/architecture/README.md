# Arquitetura multi-competição

Este diretório é o registro de decisões da expansão. Os ADRs estão com
status **Aceito** e foram revisados contra o schema aditivo existente antes da
conclusão da Etapa 2.

## Glossário canônico

| Termo | Definição |
|---|---|
| Competition | Identidade permanente de um torneio, independente de ano, como Copa do Mundo. |
| CompetitionSeason | Uma edição esportiva com timezone, calendário, status e capabilities, como Copa do Mundo 2026. Nunca usar `Season` isoladamente em contrato. |
| Stage | Segmento de uma CompetitionSeason com formato próprio: liga, grupos ou mata-mata. |
| Round | Unidade ordenada dentro de um Stage; não é sinônimo de data. |
| Match | Partida pertencente a exatamente uma CompetitionSeason; durante expand a FK legada pode ser nullable, mas o runtime novo nunca cria partida sem contexto. |
| Pool | Grupo social permanente do bolão. |
| PoolMembership | Vínculo e papel social de um User em um Pool. Admin global não implica membership. |
| PoolSeason | Participação de um Pool em uma CompetitionSeason, com regras e janela pontuável próprias. |
| Prediction | Palpite de User para Match dentro de PoolSeason. |
| PredictionScore | Pontuação derivada e versionada de uma Prediction. |
| Standings | Classificação esportiva dos times; não é ranking do bolão. |
| Ranking | Ordenação de participantes de um PoolSeason. |
| Capability | Característica declarativa (`LEAGUE`, `GROUPS`, `KNOCKOUT`, `TWO_LEGS`) que orienta comportamento sem condicional por slug. |
| Rule set | Versão imutável das regras de pontuação/desempate. |
| Provider | Fonte externa acessada por adapter, nunca dona do modelo interno. |
| Mapping | Relação auditável entre identificador externo e entidade interna. |
| Override | Alteração manual com ator, justificativa e provenance, com precedência sobre sync automático. |
| Alias da Copa | Rota legada que resolve o contexto fixo da Copa e delega ao mesmo caso de uso genérico; não é cópia de regra. |
| Contract phase | Remoção posterior de coluna/rota antiga, proibida nas Etapas 0–2. |

## ADRs

1. [ADR-001 — domínio multi-competição](ADR-001-multi-competition-domain.md)
2. [ADR-002 — temporada, stage, round e capabilities](ADR-002-season-stage-round.md)
3. [ADR-003 — pool, membership e pool season](ADR-003-pool-membership-pool-season.md)
4. [ADR-004 — pontuação, desempate e fechamento](ADR-004-scoring-and-tiebreak-versioning.md)
5. [ADR-005 — normalização de providers](ADR-005-provider-normalization.md)
6. [ADR-006 — convivência do mata-mata](ADR-006-knockout-unification.md)
7. [ADR-007 — sessão, CSRF e RBAC](ADR-007-auth-csrf-session-revocation.md)
8. [ADR-008 — eventos realtime e outbox](ADR-008-realtime-events-and-outbox.md)
9. [ADR-009 — expand–migrate–contract](ADR-009-expand-migrate-contract.md)
10. [ADR-010 — backup, restore e observabilidade](ADR-010-backup-restore-observability.md)

Diagramas e sequências estão em [domain-flows.md](domain-flows.md). Itens que
podem ser fechados em etapas posteriores, sem bloquear o schema da Etapa 2,
estão em [open-decisions.md](open-decisions.md).

# Evidência — Prompt 7, pontuação e engajamento

As regras de pontuação e desempate são versionadas e possuem checksum. O replay
de score é auditável, isolado por temporada/pool e respeita `scoreableFrom` e a
rodada inicial. Streaks e conquistas usam somente resultados finais; snapshots,
movimentos e notificações possuem chaves idempotentes e outbox transacional.

Os testes cobrem propriedades de pontuação, limites, desempates, scoreability,
recomputação, gamificação, retenção e isolamento PostgreSQL. Arquivos centrais:
`packages/shared/src/scoring.ts`, `scoring-rules.service.ts`,
`score-recomputation.logic.ts`, `gamification.logic.ts` e
`ranking.service.ts`.

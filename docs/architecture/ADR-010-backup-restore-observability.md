# ADR-010 — backup, restore, retenção e observabilidade

- Status: Aceito
- Data: 2026-07-14

## Contexto

Backup anterior não incluía avatares nem manifestos. A expansão também exige
rollback verificável, retenção e contexto de temporada nas métricas.

## Alternativas

1. Confiar apenas em dump automático: rejeitada.
2. Snapshot lógico sem restore drill: rejeitada.
3. Conjunto versionado DB + arquivos + manifests e ensaio isolado: escolhida.

## Decisão

Cada baseline registra commit, migrations, timezone, contagens e SHA-256
determinístico de ranking, palpites e scores. O conjunto usa pg_dump custom,
globais sanitizados, ZIP de avatares e manifests cruzados. Restore sempre ocorre
primeiro em destino isolado, compara hashes e limpa temporários.

Logs/métricas carregam requestId e, quando aplicável, seasonId/poolSeasonId.
Observar SSE clients/backpressure, pool, latência de ranking, sync, rejeição por
prazo, CSRF, outbox e idade do backup. Não registrar token, cookie, senha, HTML
ilimitado ou PII. RankingSnapshot usa retenção inicial de 90 dias; outbox só
será purgada após política da Etapa 8.

## Consequências

Go-live depende de evidência operacional, não apenas testes unitários. Backup
consome armazenamento adicional e exige monitoramento de idade/checksum.

## Invariantes testáveis

- Dump/ZIP/manifests têm checksum válido antes do restore.
- Restore reproduz contagens/hashes e avatares.
- Snapshot determinístico não contém segredo/PII desnecessária.
- Shutdown não deixa recursos próprios abertos.
- Rollback normal não exige restore nem migration destrutiva.

## Compatibilidade, rollout e rollback

Scripts antigos foram estendidos, mantendo comandos conhecidos. Antes de
migration, pausar writes/jobs e capturar baseline. Em rollback, preservar
artefatos e schema; restore requer confirmação humana e corrupção comprovada.

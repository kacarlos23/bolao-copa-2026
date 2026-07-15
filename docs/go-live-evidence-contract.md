# Contrato de evidências de go-live v2

O gate `npm run gate:go-live` aceita exclusivamente quatro documentos JSON
sanitizados e assinados. Todos devem declarar `formatVersion: 2`,
`status: "passed"`, `pii: false`, `environment: "production"`, o mesmo SHA de
40 caracteres do candidato, `generatedAt`, `validUntil` com janela máxima de 48
horas e ao menos uma referência HTTPS de artefato com SHA-256.

A assinatura é HMAC-SHA256 do JSON canônico sem o campo `signature`. A chave
`GO_LIVE_EVIDENCE_HMAC_KEY` deve ter pelo menos 32 caracteres, ficar no cofre do
ambiente protegido e nunca ser escrita em arquivo ou log.

## Evidências obrigatórias

- `smoke`: login autenticado, troca de competição, agenda, ranking, limite do
  palpite, SSE e feature flags; viewports mobile (até 480 px) e desktop (a partir
  de 1024 px).
- `source-reconciliation`: provider CBF, 20 times, 38 rodadas, 380 referências,
  20 standings, dez jogos na rodada 20, quarentena zero, tabela/regulamento com
  SHA-256 e segunda importação sem inserts/quarentena.
- `observability`: dashboard e prova de disparo e recuperação para database,
  provider, ranking, SSE, outbox e backup.
- `operational-rehearsal`: backup sanitizado derivado de produção, restore
  isolado com avatares, quatro hashes idênticos da Copa, flags desligadas com ID
  de auditoria e rollback aprovado.

O relatório produzido em `output/release-gates/go-live-external.json` não copia
o conteúdo das evidências nem a assinatura; registra somente o resultado e os
erros de validação. Os schemas executáveis e testes negativos ficam em
`scripts/verify-go-live-evidence.mjs` e
`scripts/verify-go-live-evidence.test.mjs`.

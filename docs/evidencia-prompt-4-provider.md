# Evidência — Prompt 4, provider e reconciliação

O port `CompetitionDataProvider` é implementado pelos adapters CBF, GE, CSV e
manual. O pipeline único valida DTOs strict, external IDs, locks,
idempotência, dry-run/diff/apply, mappings, quarentena e precedência de override.

Para a CBF 2026, URLs são construídas internamente; redirects são bloqueados e
há timeout, limite de bytes e retry controlado. A tabela e o REC vigentes estão
fixados por URL, tamanho e SHA-256. A coleta cobre 38 endpoints de rodada e a
tabela oficial de standings. O comando `npm run reconcile:cbf-2026` compara
J/V/E/D/GP/GC/PTS oficiais com os 177 resultados finalizados e falha diante de
qualquer diferença.

Testes relevantes: `fetch-policy.test.ts`, `provider-sync.logic.test.ts`,
`provider-sync.service.test.ts`, `cbf-serie-a-2026.provider.test.ts`,
`csv.provider.test.ts` e `ge.provider.test.ts`.

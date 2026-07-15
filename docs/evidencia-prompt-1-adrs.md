# Evidência do Prompt 1 — ADRs e contratos

Revisão concluída em 14/07/2026. O Prompt 1 havia sido pulado antes da
migration aditiva; ele foi retomado antes da aprovação definitiva da Etapa 2.

## Entregas

- [glossário e índice canônico](architecture/README.md);
- ADR-001 a ADR-010 com status, contexto, alternativas, decisão,
  consequências, invariantes, compatibilidade, rollout e rollback;
- [diagramas de entidade e fluxos](architecture/domain-flows.md) para palpite,
  provider/sync, ranking, evento, backup e restore;
- [registro de decisões abertas](architecture/open-decisions.md) com
  responsável, data-limite relativa e consequência.

As decisões fecham Competition, CompetitionSeason, Stage, Round, Pool,
PoolMembership, PoolSeason, ownership de Match/Prediction/Score/ranking,
capabilities, instante de fechamento, rulesets, provider/mapping/override,
expand–migrate–contract, aliases da Copa, sessão/CSRF/RBAC, outbox/SSE e
backup/observabilidade.

Nenhuma decisão de schema necessária à Etapa 2 ficou aberta. Os itens OD-01 a
OD-05 pertencem a providers/go-live, retenção operacional, contract futuro e
notificações.

## Gate

```text
node scripts/check-markdown-links.mjs
links locais dos documentos Markdown válidos.
```

Nenhuma migration ou mudança de comportamento runtime foi introduzida pelo
Prompt 1; as alterações runtime existentes no mesmo worktree pertencem à
conclusão anterior do Prompt 0.

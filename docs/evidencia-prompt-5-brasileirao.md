# Evidência — Prompt 5, Brasileirão 2026

A temporada é preparada como `DRAFT`; as quatro flags persistidas (`read`,
`write`, `UI` e `sync`) começam
desligadas e a ausência do registro também falha fechada. O loader exige 20
clubes, 38 rodadas, 380 referências oficiais, 20 standings e dez partidas com
horário oficial na rodada 20 antes de escrever.

O fluxo importa `TEAMS`, `SCHEDULE`, `RESULTS` e `STANDINGS`, repete a carga e
exige zero inserts e quarentenas na segunda passagem. Jogos sem data/hora não
recebem horário fictício. O bolão inicia na rodada 20; partidas anteriores
alimentam a classificação esportiva, mas não são pontuáveis no pool.

Código principal: `brasileirao-2026.service.ts`, `load-brasileirao-2026.ts`,
`cbf-serie-a-2026.provider.ts` e `standings.logic.ts`. O procedimento operacional
está em [runbook-brasileirao-2026.md](runbook-brasileirao-2026.md).

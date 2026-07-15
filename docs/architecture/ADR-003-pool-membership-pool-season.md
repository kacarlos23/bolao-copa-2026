# ADR-003 — Pool, PoolMembership e PoolSeason

- Status: Aceito
- Data: 2026-07-14

## Contexto

Usuários, ranking e palpites eram globais. É necessário separar o grupo social
da edição esportiva e impedir que papel ADMIN global conceda participação.

## Alternativas

1. Um pool implícito global: rejeitada por impedir isolamento futuro.
2. Membership diretamente na season: rejeitada por perder identidade social.
3. Pool permanente + membership + PoolSeason: escolhida.

## Decisão

Pool possui N PoolMembership e N PoolSeason. Membership tem papel/status
social; User.role continua RBAC global. PoolSeason liga exatamente um Pool e uma
CompetitionSeason, referencia rule set imutável e declara `scoreableFrom` e
`startsAtRound`. A coluna aditiva antiga `scoreableFromRound` permanece como
alias de transição e será retirada apenas na contract phase.

Prediction é única por `(poolSeasonId,userId,matchId)`. Score, snapshot,
palpites de mata-mata e conquistas carregam poolSeasonId diretamente, mesmo
quando também derivável, para isolamento e consulta auditável.

## Consequências

Toda leitura/escrita social valida membership ACTIVE server-side. Admin global
não aparece no ranking sem membership de participante e regra explícita.

## Invariantes testáveis

- `(poolId,userId)` e `(poolId,seasonId)` são únicos.
- PoolSeason.seasonId coincide com Match.seasonId em todo palpite/score.
- User precisa membership ACTIVE no pool.
- Histórico anterior a scoreableFrom/startsAtRound não pontua.

## Compatibilidade, rollout e rollback

O backfill cria pool padrão e memberships sem mudar User/Prediction IDs. Dual
write preenche contexto da Copa nas rotas antigas. Rollback de aplicação volta
ao ranking legado; entidades de pool não são apagadas.

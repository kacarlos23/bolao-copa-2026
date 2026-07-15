# ADR-006 — convivência e unificação futura do mata-mata

- Status: Aceito
- Data: 2026-07-14

## Contexto

KnockoutFixture/KnockoutPick guardam regras específicas e dados da Copa. Uma
unificação prematura ameaçaria IDs, chaves e scores existentes.

## Alternativas

1. Converter tudo para Match na Etapa 2: rejeitada pelo risco de preservação.
2. Manter para sempre dois domínios: rejeitada por duplicar regra.
3. Conviver agora e unificar em release posterior por Tie: escolhida.

## Decisão

Etapa 2 adiciona seasonId/poolSeasonId ao legado e o backfill da Copa, mas não
remove nem recria KnockoutFixture/KnockoutPick. Stage/Round descrevem o
calendário. Na unificação futura, Tie agrupará um ou dois Match e a migração
manterá aliases/IDs de origem até paridade comprovada.

Fechamento da geração e de cada fixture é revalidado na transação. Empate de
palpite exige advancingTeamId válido.

## Consequências

Há convivência temporária, compensada por contexto e testes de paridade. A
Etapa 3 não cria condicional por slug; usa capability KNOCKOUT.

## Invariantes testáveis

- Fixtures/generation da Copa pertencem a world-cup-2026.
- Bracket, pick e score pertencem ao mesmo PoolSeason da generation/season.
- Nenhum ID/pick/score legado muda no backfill.
- Fixture iniciada ou geração fechada não aceita escrita.

## Compatibilidade, rollout e rollback

Leituras/escritas legadas continuam durante expand. A futura conversão exige
shadow read e telemetria. Rollback mantém tabelas antigas como fonte ativa; a
contract phase não tem data até a Etapa 9.

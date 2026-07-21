# Evidência do Prompt 0 — expansão das copas 2026

Data da execução: 21/07/2026. Ambiente: máquina de testes. Branch inicial: `main`. HEAD inicial e `origin/main`: `f6cd99096bc90f4a0568912a56e15e4723756d9c`. O worktree estava limpo antes da execução.

## Decisão

**GO técnico para iniciar exclusivamente o Prompt 1.** O P0 de massa histórica foi resolvido pela restauração validada do backup de produção na máquina de testes. Nenhum P0/P1 bloqueia o início do Prompt 1. As lacunas P1 de runtime permanecem não implementadas e têm owner, gate e ordem definidos abaixo; elas bloqueiam os prompts dependentes, não o início sequencial do plano.

Esta decisão não autoriza produção, deploy, feature flag pública nem execução agrupada de prompts.

## Backup de origem e restore

Conjunto recebido da produção:

- dump custom `bolao-world-cup-2026-20260721-214046795Z.dump`, 1.998.830 bytes, SHA-256 `0f9bc342fef0d2166906d9c85a7cd9dc904d460e3aa4e7fb8230b872d3260bb8`;
- metadata criada em `2026-07-21T21:40:48.963Z`, com nome, tamanho e hash conferidos;
- inventário de globais sem senhas, SHA-256 `2162f3c1954da0548f559dc296f77367c25d703c2a2cf7fb07f57379c77a0ee1`;
- arquivo de cinco avatares, SHA-256 `4d2be5557843ebec85493a93ff21969299b8493db94562e139e0ed03c78d6bbf`, com cada item conferido contra o manifest.

O dump foi produzido por PostgreSQL 18.3 no formato custom 1.16. O `pg_restore` local 16.13 não lia esse catálogo. Foi usado `pg_restore` 18.4 em contêiner apenas para validar e materializar SQL efêmero. Como o servidor de testes é PostgreSQL 16.13, removeu-se somente `SET transaction_timeout = 0`, parâmetro de sessão introduzido depois dessa versão. A carga foi aplicada com `ON_ERROR_STOP=1` e terminou com 46 tabelas.

Antes da promoção:

- a restauração completa foi ensaiada em `bolao_restore_verify_prod_20260721`;
- migrations, constraints, índices, contagens e snapshot foram validados;
- o banco local anterior recebeu dump completo validado em `backups/test-pre-production-restore-20260721/`;
- o banco local anterior foi mantido como `bolao_copa_2026_pre_prod_restore_20260721`;
- não havia conexão da API ou do frontend aberta.

O banco restaurado foi promovido por renomeação para `bolao_copa_2026`. Os cinco avatares foram extraídos no diretório local vazio e revalidados individualmente. O snapshot do banco isolado e o do banco ativo são idênticos, SHA-256 `725c15f24834375d5bab9eec932c607bd3a503d32e49aa1ce581c682023c9cce`.

## Baseline de dados

| Escopo | Estado verificado |
| --- | --- |
| Copa do Mundo | `ACTIVE`; 2 stages; 9 rounds; 48 times; 72 partidas `FINISHED`; 1.041 palpites de partida; 681 simulações; 320 picks de mata-mata; 1.041 scores de grupo; 270 scores de mata-mata; 24.523 snapshots de ranking; 32 fixtures de mata-mata; 2.165 sync runs |
| Brasileirão | `DRAFT` com flags `read/write/ui=true`; 1 stage; 38 rounds; 20 times; 235 partidas, sendo 182 `FINISHED` e 53 `SCHEDULED`; 62 palpites; 23 scores; 209 snapshots de ranking; 3.806 sync runs |
| Usuários/pool | 24 usuários ativos; 1 pool; 2 pool seasons |
| Schema | 14 migrations concluídas até `20260720010000_add_team_profiles`; 0 FKs não validadas; 0 índices inválidos |

O Brasileirão usa `scoreableFrom=2026-07-16T03:00:00Z` e `historicalMatchesScoreable=false`. A combinação `status=DRAFT` com flags públicas verdadeiras foi preservada como dado real, não normalizada durante o restore; sua semântica operacional é gate explícito do Prompt 9.

Hashes escopados da Copa:

- `Match`: `45c8629c75b8af760657432a46c7141757d28e1777ba4a186eb933665d4c2efb`;
- `Prediction`: `47d357283b3d3e66088a6abba7f54ad7e6f3159914f8e1083fc84fcbe634b4eb`;
- `PredictionScore`: `927fd583e676727a083e01d498f3588d561cb2f517bb7786fa145ad25fc05ddc`;
- `RankingSnapshot`: `108f0cef61dfbbd20fbe54711e476bb77e3ba3c929d01e2d07d66e31cfbb3e78`.

Hashes de negócio globais, cobrindo conjuntamente Copa e Brasileirão e ignorando apenas colunas estruturais/temporais definidas pelo snapshot:

- `Match`: `efd1b342e7285b0870d4e3af12c9d9fbbeec283cf25875da71f1b59fe8d16393`;
- `Prediction`: `2836bf11fb1792ea4abfa7b0a876c9392c545eddd223e8534d7d4434da455745`;
- `PredictionScore`: `f6c287a799b2121f408f489b0eac1e9f780cfe3fa3d07d730168d4491fbb0892`;
- `RankingSnapshot`: `1806839991de2e5b661402713b1f4e5829b004265f049985601e7632bacd88c7`.

## Matriz de execução

| Prompt | Estado | Evidência |
| --- | --- | --- |
| 0 | CONCLUÍDO | Backup real restaurado em banco isolado e promovido; avatares, hashes, migrations, integridade, lint, testes, build e Prisma aprovados; esta evidência registra a baseline |
| 1 | NÃO INICIADO | Rotas, navegação, workspace, sync, scheduler e filtros ainda possuem enumerações/fallbacks específicos; prompt agora tem teste negativo e allowlist explícita |
| 2 | NÃO INICIADO | Não existe `Tie`; `KnockoutFixture`/`KnockoutPick` permanecem como legado da Copa |
| 3 | NÃO INICIADO | Não existe `SeasonProviderConfig`; provider e perfil de clube ainda têm acoplamento CBF/Série A |
| 4 | NÃO INICIADO | Slug, carga e provider da Sul-Americana não existem |
| 5 | NÃO INICIADO | Slug, carga e provider da Libertadores não existem |
| 6 | NÃO INICIADO | Slug, carga e provider da Copa do Brasil não existem |
| 7 | NÃO INICIADO | UI comum para grupos/mata-mata/híbrido e testes de isolamento ainda não existem |
| 8 | NÃO INICIADO | Ranking/conquistas das novas pool seasons e filtros por capability ainda não existem |
| 9 | NÃO INICIADO | Scheduler/configuração multi-provider e semântica operacional entre status/flags ainda não foram implementados |
| 10 | NÃO INICIADO | Canário das três novas competições depende dos Prompts 1–9 |

Não há prompt `BLOQUEADO`. A ordem continua estritamente sequencial.

## P0/P1 e responsabilidade

| Risco | Situação após esta execução | Owner/gate |
| --- | --- | --- |
| P0 — massa local vazia não provava preservação | Resolvido com backup real, contagens não vazias e hashes reproduzíveis | Prompt 0 concluído |
| P1 — condicionais por slug e fallback para Brasileirão | Planejado, ainda não implementado | Prompt 1; competição híbrida fictícia deve navegar sem request do Brasileirão e sem case por slug |
| P1 — mata-mata legado sem `Tie` | Planejado, ainda não implementado | Prompt 2; migration expand-only, shadow-read com paridade e legado preservado |
| P1 — provider escolhido no runtime e scheduler sem configuração persistida | Planejado, ainda não implementado | Prompt 1 cria a abstração sem migration; Prompt 3 cria `SeasonProviderConfig` auditável como fonte única |
| P1 — perfil de clube com conceitos exclusivos da CBF | Planejado, ainda não implementado | Prompt 3; DTO comum internacional e compatibilidade do Brasileirão |
| P1 — turno/standings expostos a formatos incompatíveis | Planejado, ainda não implementado | Prompt 1 remove fallback; Prompts 7/8 comprovam UX e ranking por capability |
| P1 — `DRAFT` com flags públicas verdadeiras | Baseline preservada, sem mutação oportunista | Prompt 9 define matriz de estados, alertas e fail-closed antes do canário |

## Gates executados

| Comando/check | Resultado |
| --- | --- |
| `git pull --ff-only origin main` | `Already up to date`; HEAD e `origin/main` iguais |
| checksum do dump e manifests | aprovado |
| `pg_restore 18 --list` | 434 entradas; dump 18.3/custom 1.16 legível |
| restore isolado com `ON_ERROR_STOP=1` | aprovado; 46 tabelas |
| snapshot isolado versus ativo | igualdade byte a byte; SHA-256 registrado acima |
| `npx prisma migrate status --schema apps/api/prisma/schema.prisma` | 14 migrations; database up to date |
| `npx prisma validate --schema apps/api/prisma/schema.prisma` | schema válido |
| `npm run lint` | aprovado |
| `npm test` | 229 testes aprovados: 18 preservação, 16 shared, 130 API e 65 web |
| `npm run build` | shared, API e bundle web aprovados |
| `npm run test:migration:constraints` | 3 cruzamentos de escopo rejeitados; transação revertida |
| `npm run audit:dependencies` | aprovado: 0 high, 0 critical; 13 moderadas transitivas do Expo permanecem sem correção compatível no SDK atual |
| `npm run gate:pr` | aprovado após sincronizar dependências pelo lock, gerar o Prisma Client e estabilizar o escopo dos testes shared |

O primeiro ensaio de `gate:pr` expôs `node_modules` desatualizado em relação ao lock, Prisma Client ausente após `npm ci` e transitivos high/critical. Foram aplicadas somente correções compatíveis sem `--force`: `tar 7.5.21`, `shell-quote 1.10.0`, `brace-expansion 1.1.16/5.0.7` e `body-parser 1.20.6`. O gate agora gera o Prisma Client explicitamente, e o pacote shared limita o Vitest a `src` para não executar novamente testes compilados em `dist`.

Artefatos temporários de snapshot permanecem fora do Git e devem ser removidos ao final da auditoria. Dumps e avatares também permanecem ignorados pelo Git.

## Checklist antes do Prompt 1

- [x] branch e HEAD confirmados;
- [x] backup real, manifests e checksums validados;
- [x] restore isolado concluído antes da promoção;
- [x] rollback do banco de testes disponível por banco preservado e dump validado;
- [x] avatares restaurados e conferidos;
- [x] 14 migrations aplicadas e schema Prisma atualizado;
- [x] Copa e Brasileirão com massa não vazia e hashes registrados;
- [x] lint, testes e build aprovados;
- [x] lacunas P1 atribuídas a prompts e gates específicos;
- [ ] commit/push desta documentação, somente quando autorizado e após revisão do diff.

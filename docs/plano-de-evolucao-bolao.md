# Plano de evolução do Bolão — revisão técnica, UX/UI e gamificação

> Revisão do código-base em 14 de julho de 2026. Documento canônico de diagnóstico e estratégia do monorepo `bolao-copa-2026`. Para executar o plano, use somente o [arquivo canônico de prompts](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md), começando pela pré-execução.

## 1. Resumo executivo

O monorepo tem uma fundação válida e não deve ser reescrito: TypeScript estrito, Express, Prisma/PostgreSQL, sessões persistentes, SSE, Expo/React Native Web, Zod compartilhado, logs estruturados e testes unitários já funcionam. Na revisão, `npm test` aprovou **38 testes**, `npm run lint` e `npm run build` concluíram com sucesso.

Os testes atuais não cobrem, porém, banco real, sessões PostgreSQL, concorrência no fechamento de palpites, frontend ou fluxos ponta a ponta. O principal risco da expansão é misturar dados da Copa e do Brasileirão: o schema não possui `Competition`, `Season` ou `PoolSeason`; `MatchDay.date` é globalmente único; rankings e prêmios contêm contagens fixas da Copa; e o frontend/API não carregam um contexto obrigatório de temporada.

Antes da expansão, há correções críticas:

1. o callback assíncrono de `session.regenerate` lança erro fora do pipeline do Express e pode derrubar o processo;
2. o pool PostgreSQL criado para `connect-pg-simple` não é encerrado, e o shutdown não drena SSE nem aguarda `server.close`;
3. usuários bloqueados mantêm a autorização contida na sessão até ela expirar; um administrador bloqueado pode continuar usando rotas administrativas;
4. autenticação por cookie não tem proteção CSRF explícita nas rotas mutáveis;
5. a checagem do prazo e o `upsert` do palpite não são atômicos;
6. atualizações periódicas do frontend podem sobrescrever rascunhos ainda não salvos;
7. o fluxo “Salvar todos” pode salvar parcialmente palpites regulares e depois falhar no mata-mata;
8. o sincronizador externo não tem timeout, limite de resposta ou circuit breaker;
9. `RankingSnapshot` cresce indefinidamente, e recálculos escrevem linha por linha;
10. o backup cobre o PostgreSQL, mas não `uploads/avatars`; Docker também não persiste avatares em volume.

O `npm audit --omit=dev` apontou 17 avisos. Os itens de ação imediata são o `multer@2.1.1`, afetado por dois avisos de DoS, e a triagem do `undici@6.26.0` transitivo do Expo. Atualizações forçadas do Expo não devem ser feitas no go-live; dependências diretas devem receber patch isolado e testes.

A expansão completa não deve ser comprimida em dois dias. A CBF informou que os primeiros jogos da Série A após a pausa serão em **16 de julho de 2026**. O go-live do Brasileirão só deve ocorrer se os gates de backup, isolamento por temporada, carga validada, fechamento por partida, rollback e smoke test forem atendidos; caso contrário, a abertura do bolão deve começar em uma rodada posterior já validada. Fonte: [CBF — tabela detalhada das rodadas 19 a 24](https://www.cbf.com.br/futebol-brasileiro/noticias/campeonato-brasileiro/campeonato-brasileiro-serie-a/cbf-divulga-tabela-detalhada-das-rodadas-19-a-24-do-brasileirao-serie-a).

## 2. Evidências e achados priorizados

### 2.1 Segurança

| ID | Severidade | Evidência | Impacto | Correção e mitigação |
|---|---|---|---|---|
| SEC-01 | Alta | `apps/api/src/middleware/auth.ts:4-18` confia apenas em `req.session.user`; `apps/api/src/services/admin.service.ts:24-49` bloqueia usuário sem invalidar/revalidar a sessão | Usuário ou administrador bloqueado pode conservar acesso compatível com o papel armazenado na sessão | Middleware assíncrono deve revalidar `status`, `role` e `sessionVersion`; alteração de status, papel ou senha deve revogar sessões. Até lá, reduzir TTL e auditar sessões ativas |
| SEC-02 | Alta | `apps/api/src/app.ts:53-72` usa cookie de sessão; `apps/web/src/api.ts:3-13` envia `credentials: 'include'`; não há token CSRF | Requisições mutáveis dependem de `SameSite=Lax` e CORS, proteções úteis mas incompletas para todos os cenários same-site | Adotar token CSRF e validação de `Origin`/`Sec-Fetch-Site`; anexar cabeçalho no cliente central. Confirmar política no proxy |
| SEC-03 | Alta | `apps/api/package.json` declara `multer`; lock atual resolve `2.1.1`; `npm audit` reportou DoS por campos profundamente aninhados e limpeza incompleta em abortos | Upload de avatar pode consumir recursos ou deixar arquivos temporários | Atualizar para patch corrigido após teste, limitar campos/partes no proxy e no Multer, limpar arquivo em aborto/falha e adicionar testes de upload interrompido |
| SEC-04 | Média | `apps/api/src/services/avatar.service.ts:39-60` confia no MIME informado pelo cliente; `apps/api/src/app.ts:89` serve arquivos na mesma origem | Arquivo disfarçado ou órfão; política de conteúdo depende apenas do cabeçalho enviado | Validar magic bytes, reencodar imagem, definir `nosniff`/cache, armazenar fora da raiz pública e servir por rota controlada |
| SEC-05 | Média | `apps/api/src/config.ts:10`, `internal.routes.ts:16-21` e `ge-score-sync.service.ts:627` permitem fallback do segredo interno para `SESSION_SECRET` | Comprometimento de um segredo amplia o alcance para outro canal | Exigir segredo interno distinto em produção, rotação independente e rate limit da rota interna |
| SEC-06 | Média | IDs em `admin.routes.ts:78,87` e `match-day.routes.ts:21,29` não passam por schema; schemas compartilhados não usam `.strict()` e não rejeitam IDs duplicados | Contratos permissivos, erros inconsistentes e carga desnecessária; Prisma evita injeção SQL, mas não substitui validação de domínio | Schemas estritos para params/query/body, arrays com máximo e unicidade, erro padronizado com `requestId` |
| SEC-07 | Baixa/Média | Não há 404 JSON explícito antes de `errorHandler`; headers do shell web só existem se ele for servido pela API | Respostas e headers variam conforme o modo de deploy | 404 padronizado; testar CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy` e `Permissions-Policy` no endpoint público real |

Não foram encontrados `$queryRawUnsafe`, SQL concatenado, execução de shell com input HTTP, `dangerouslySetInnerHTML`, `eval` ou segredos no bundle. Prisma usa queries parametrizadas e as rotas principais já aplicam Zod, Helmet, CORS com origem explícita, limite JSON, Argon2 e rate limit de login. Esses controles devem ser preservados.

### 2.2 Correção, concorrência e recursos

| ID | Prioridade | Evidência | Risco | Ação |
|---|---|---|---|---|
| REL-01 | P0 | `auth.routes.ts:35-36` faz `throw` dentro do callback de `session.regenerate`; logout ignora erro em `:44-47` | Exceção não chega ao `errorHandler`; resposta ou processo podem falhar | Promisificar `regenerate`/`destroy`, propagar `next(error)` e testar falhas |
| REL-02 | P0 | `app.ts:69` cria `new Pool`; `server.ts:14-21` só chama `server.close()` e `prisma.$disconnect()` | Pool órfão e shutdown que pode ficar preso em conexões SSE | Criar módulo de recursos, expor `closeSessionStore`, drenar SSE, aguardar `server.close`, ter timeout e handlers idempotentes |
| REL-03 | P0 | `prediction.service.ts:251-264` verifica o prazo e só grava em `:266`; fluxo similar em `knockout.service.ts:604-733` | Palpite aceito após o fechamento por corrida TOCTOU | Transação interativa com relógio único e rechecagem dentro da transação; teste com fake timers no limite |
| REL-04 | P0 | `competitionV2.tsx:328-346` reidrata o draft e `:352-365` atualiza a cada 30 s | Palpite digitado pode ser substituído pelo valor antigo do servidor | Estado `dirtyByMatchId`, merge que não toca campos sujos, abort/request-id e aviso de alterações não salvas |
| REL-05 | P0 | `competitionV2.tsx:406-466` salva palpites comuns e mata-mata em chamadas separadas | Sucesso parcial apresentado como falha total | Não misturar domínios no “Salvar todos”; exibir confirmação parcial ou criar endpoint transacional coerente |
| REL-06 | P1 | `realtime/sse.ts:5-29` usa timer por cliente, ignora backpressure/erro e só remove em `close` | Memória acumulada em cliente lento; shutdown incompleto | Heartbeat global, `close/error/aborted`, limite de clientes, backpressure e `closeAllSseClients()` |
| REL-07 | P1 | `ge-score-sync.service.ts:315-393,621` usa `fetch` sem timeout | Job pode travar e manter `activeRun` indefinidamente | `AbortSignal.timeout`, limite de bytes, retry com jitter, lock distribuído e circuit breaker por provider/season |
| REL-08 | P1 | `ranking.service.ts:150-176,699-714` faz upserts sequenciais e snapshots append-only | Latência e crescimento sem retenção | `createMany`/transação por lote, snapshot por evento/intervalo, retenção/particionamento e índices por temporada |
| REL-09 | P1 | `knockout.service.ts:164-224` executa até 32 upserts ao carregar infraestrutura | Leitura de tela dispara trabalho de bootstrap | Mover bootstrap para migração/seed idempotente; leitura não deve escrever |

### 2.3 TypeScript e arquitetura

- `strict: true` está ativo, mas há escapes em `ranking.service.ts:316-346`, `prediction.service.ts:89` e `App.tsx:289-297`. Criar DTOs compartilhados e remover `any` antes de generalizar o domínio.
- `apps/web/src/api.ts` replica tipos do backend em vez de consumir contratos de `packages/shared`; não há validação das respostas externas no cliente.
- `apps/web/App.tsx` possui 6.123 linhas, `predictionBoard.tsx` 2.966 e `competitionV2.tsx` 1.826. Componentes antigos e V2 coexistem por flag, aumentando bundle, divergência e custo de teste.
- O build web gerou um bundle JS principal de aproximadamente 1,97 MB e vários font files completos de ícones. A divisão por rota/feature e a redução de famílias de ícones devem entrar no orçamento de performance.
- `MatchDay @@unique([date])`, rankings globais e entidades paralelas do mata-mata inviabilizam isolamento de competições sem migração aditiva.

### 2.4 UI/UX e acessibilidade

1. **Palpites:** score inputs não possuem `accessibilityLabel`, descrição de mandante/visitante, estado inválido ou anúncio de sucesso. No mata-mata, empate exige selecionar classificado, mas a relação entre placar e escolha deve ser explícita e anunciada.
2. **Rascunhos:** falta indicador persistente `Não salvo/Salvando/Salvo às HH:mm`, proteção contra troca de tela e recuperação por usuário+temporada. O draft local do chaveamento usa apenas o ID da geração.
3. **Feedback:** ainda há `window.alert`; erros são strings genéricas sem código, ação de tentar novamente ou foco. Trocar por toast acessível e mensagens inline próximas ao campo.
4. **Loading:** várias telas substituem todo o conteúdo por `ActivityIndicator`, provocando saltos. Usar skeleton, manter dados anteriores e diferenciar carregamento inicial, atualização silenciosa e sincronização externa.
5. **Responsividade:** a classificação é uma tabela horizontal larga e o chaveamento depende de canvas/scroll. No mobile, oferecer resumo do usuário fixo e navegação por fase; no desktop, cabeçalho sticky e primeira coluna fixa.
6. **Ranking:** existe pódio e estante de troféus, mas o “movimento” atual compara filtros, não posição desde a última visita. Exibir posição do usuário primeiro, distância para o rival acima, pontos da rodada e legenda de desempate.
7. **Acessibilidade:** tabs e filtros precisam de `accessibilityRole="tab"`, `accessibilityState`, foco visível, alvo mínimo de 44 px e suporte consistente a `prefers-reduced-motion`. Cores de acerto/erro não podem ser o único sinal.

### 2.5 Gamificação recomendada

- **Streaks:** contar somente resultados finais e consecutivos numa sequência ordenada de partidas elegíveis. Manter `currentStreak`, `bestStreak`, tipo (`qualquer acerto`, `resultado`, `exato`) e janela. Resultado ao vivo não consolida streak.
- **Conquistas:** catálogo versionado e eventos idempotentes, por exemplo primeiro palpite, primeiro exato, três acertos seguidos, líder da rodada, virada no ranking e chave perfeita. Separar badge concedido de card visual.
- **Líder da rodada:** ranking por `roundId`, empate resolvido pelo rule set versionado e destaque apenas após jogos finais; durante a rodada, rotular como provisório.
- **Retorno ao site:** persistir `lastSeenRankingSnapshotId` por usuário/pool/temporada e gerar um resumo: “subiu 2 posições”, “ultrapassou X”, “ficou a 3 pontos de Y”. Não usar apenas estado local do navegador.
- **Rivais:** permitir rival favorito e comparação opt-in, sem rankings humilhantes ou notificações excessivas.
- **Desempates dinâmicos:** `TieBreakerRuleSet` ordenado e versionado, exibido na UI. Nunca alterar o critério de uma temporada iniciada sem criar nova versão e recalcular em modo auditável.
- **Notificações:** começar com inbox in-app e preferências; push/e-mail somente opt-in. Agrupar eventos e impor quiet hours.
- **Integridade:** conquistas e streaks derivam de eventos finais/reprocessáveis, com chave idempotente; não são atualizados por efeitos ad hoc do frontend.

## 3. Arquitetura-alvo

```text
Pool
├── PoolMembership
└── PoolSeason ── ScoringRuleSetVersion
    ├── CompetitionSeason ── Stage ── Round ── Match
    │   ├── SeasonTeam
    │   └── ProviderEntityMapping
    ├── Prediction ── PredictionScore
    ├── RankingSnapshot / RankingMovement
    └── AchievementDefinition / UserAchievement / Streak
```

Regras invariantes:

- toda leitura ou escrita esportiva recebe `seasonId`; ranking/palpite também recebe `poolSeasonId`;
- `Prediction` é único por `(poolSeasonId, userId, matchId)`;
- o backend comprova que match, season e pool pertencem ao mesmo contexto;
- partidas históricas constroem a classificação esportiva, mas só pontuam se `scoreableFrom`/`startsAtRound` permitir;
- horários são armazenados em UTC e exibidos segundo a timezone da temporada;
- provider externo nunca escreve direto nas tabelas finais sem normalização, reconciliação, validação e auditoria;
- pontuação, desempate, conquista e snapshot guardam versão da regra;
- rotas antigas da Copa permanecem aliases temporários até telemetria confirmar que não são usadas;
- o frontend renderiza capacidades (`LEAGUE`, `GROUPS`, `KNOCKOUT`, `TWO_LEGS`) e não slugs em condicionais.

## 4. Plano de implementação faseado

### Fase 1 — Correções críticas e preservação

**Objetivo:** criar uma baseline restaurável e eliminar falhas que podem corromper palpites, manter acesso revogado ou impedir shutdown.

**Arquivos principais:** `apps/api/src/app.ts`, `server.ts`, `routes/auth.routes.ts`, `middleware/auth.ts`, `realtime/sse.ts`, `services/prediction.service.ts`, `services/knockout.service.ts`, `services/avatar.service.ts`, `apps/web/src/api.ts`, `competitionV2.tsx`, scripts de backup/restore e testes.

**Práticas:** fail closed, recursos com ownership explícito, transações Prisma, Zod estrito, idempotência, redaction, fake timers, testes de concorrência e rollback ensaiado.

**Entregas:** corrigir sessão/shutdown/SSE; CSRF; patch do Multer; revalidação/revogação de sessão; rechecagem transacional do prazo; draft sujo; timeouts de provider; backup de DB+avatares com checksum e restore drill.

**Gate:** ranking/palpites da Copa antes e depois são idênticos; nenhum palpite é aceito no instante ou após o fechamento; usuário bloqueado perde acesso; processo encerra sem handles abertos.

**Execução:** use exclusivamente o [Prompt 0 — preservação da Copa e hardening P0](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-0). O bloco operacional não é duplicado neste plano.

### Fase 2 — Fundação multi-competição e migração aditiva

**Objetivo:** isolar Copa e Brasileirão por competição, temporada e pool sem quebrar rotas existentes.

**Arquivos principais:** `schema.prisma`, nova migration, seed/backfill, módulos `competitions`, `seasons`, `pools`, `matches`, `predictions`, `rankings`, `packages/shared` e aliases das rotas atuais.

**Práticas:** expand–migrate–contract, dual read controlado, constraints compostas, serviços coesos, DTOs compartilhados, compatibilidade retroativa e migrations testadas sobre cópia de produção.

**Entregas:** `Competition`, `CompetitionSeason`, `Stage`, `Round`, `SeasonTeam`, `Pool`, `PoolMembership`, `PoolSeason`, mappings; backfill da Copa preservando IDs; `seasonId`/`poolSeasonId` em toda query; remoção da unicidade global de data em favor de escopo composto.

**Gate:** consultas cruzadas falham; ranking legado da Copa mantém hash/fixture esperado; rotas antigas resolvem explicitamente `world-cup-2026`.

**Execução:** conclua, nesta ordem, o [Prompt 1 — decisões arquiteturais](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-1), o [Prompt 2 — schema e backfill](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-2) e o [Prompt 3 — camada genérica](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-3), sempre em interações separadas.

### Fase 3 — Provider genérico e Brasileirão 2026

**Objetivo:** importar e operar a Série A 2026 sem condicionais específicas espalhadas.

**Arquivos principais:** módulos `providers`, `imports`, `standings`, `rounds`, adapter GE atual, `CbfProvider`/CSV/manual, admin de sync e fixtures de importação.

**Práticas:** ports and adapters, normalização tipada, ID externo como chave, idempotência, timeouts, reconciliação auditável, precedência de override manual e observabilidade por temporada.

**Entregas:** 20 clubes, 38 rodadas/380 partidas quando a fonte oficial estiver completa, rodada inicial configurável, classificação interna, ranking geral/rodada/mês/turno, contingência CSV e health do provider.

**Gate:** carga repetida não duplica; horários/resultados têm provenance; rodada histórica não pontua; toda divergência fica auditável. A tabela oficial vigente deve ser consultada no momento da implementação.

**Execução:** conclua, nesta ordem, o [Prompt 4 — providers e sincronização](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-4) e o [Prompt 5 — Brasileirão Série A 2026](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-5), em interações separadas.

### Fase 4 — Refatoração frontend, UX e performance

**Objetivo:** transformar a interface em shell orientado a competição, sem perder rascunhos e com experiência acessível em mobile e desktop.

**Arquivos principais:** extrair `App.tsx`, `predictionBoard.tsx`, `competitionV2.tsx`, `api.ts` para `app/`, `features/`, `components/`, `services/`, `theme/`; `packages/shared` para contratos.

**Práticas:** componentes pequenos, single source of truth, reducer/state machine para drafts, request cancellation, stale-while-revalidate, `memo`/`useCallback` após medição, lazy loading por rota e acessibilidade WCAG.

**Entregas:** seletor de competição/temporada; `TeamBadge`; `ScoreInput` acessível; barra de estado de salvamento; toasts; skeletons; ranking hierárquico; chave mobile por fase; estado SSE visível; budget de bundle.

**Gate:** nenhum polling sobrescreve edição; teclado e leitor de tela completam login/palpite/mata-mata/ranking; fluxos passam em larguras 320/768/1280/1440 e reduced motion.

**Execução:** use exclusivamente o [Prompt 6 — frontend, UX/UI e acessibilidade](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-6).

### Fase 5 — Pontuação, gamificação, administração e qualidade

**Objetivo:** introduzir regras versionadas e gamificação íntegra, com operação segura e suíte obrigatória.

**Arquivos principais:** `packages/shared/src/scoring.ts`, modelos de rule set/tie breaker/achievement/streak, ranking, admin, SSE, inbox de notificações e testes de integração/E2E.

**Práticas:** event-driven idempotente, funções puras, versionamento imutável, outbox transacional, recomputação determinística, RBAC, auditoria before/after e feature flags.

**Entregas:** rule set 15/3/1/0 preservado; desempates versionados; streaks; badges; líder da rodada; resumo desde última visita; preferências; preview/dry-run de recalcular; admin com justificativa e proteção de ações destrutivas.

**Gate:** replay de eventos não duplica conquistas; live não consolida streak; mudança de regra não altera score histórico; admin vê impacto antes de aplicar; cobertura frontend deixa de ser placeholder.

**Execução:** conclua, nesta ordem, o [Prompt 7 — pontuação e gamificação](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-7), o [Prompt 8 — administração](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-8) e o [Prompt 9 — testes e release gates](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#prompt-9), sempre em interações separadas.

## 5. Gates de release e preservação operacional

1. **Baseline:** tag/commit, backup custom do PostgreSQL, checksum SHA-256, export do ranking/palpites/scores/audit e cópia de avatares.
2. **Restore drill:** restaurar em banco isolado, rodar `prisma migrate status`, smoke tests e comparar contagens/hashes. O restore não pode ser testado pela primeira vez em produção.
3. **Migration rehearsal:** medir duração e locks sobre cópia de tamanho real; expand/backfill em lotes; sem `DROP`, `TRUNCATE` ou coluna `NOT NULL` sem backfill.
4. **Compatibilidade:** jobs e scripts recebem season/provider; backups preservam tabelas novas; rotas legadas têm testes de contrato.
5. **Deploy:** feature flags separadas para leitura, escrita e exposição do Brasileirão; canário de admin antes dos usuários.
6. **Observabilidade:** request ID, métricas de SSE, pool, latência de ranking, sync por provider/season, rejeição por prazo e falhas de CSRF.
7. **Rollback:** desligar escrita/exposição, parar sync, reverter aplicação; não desfazer migration aditiva. Restaurar banco apenas para corrupção confirmada e com janela aprovada.
8. **Go/no-go:** sem falha P0/P1 aberta, sem divergência de tabela, clock/timezone testado e usuário real de teste completando palpite em mobile e desktop.

## 6. Sequência recomendada

```text
Etapa 0  Preservação e hardening
Etapa 1  ADRs, contratos e decisões
Etapa 2  Schema aditivo e backfill da Copa
Etapa 3  Módulos e API genérica
Etapa 4  Providers e sincronização
Etapa 5  Brasileirão 2026
Etapa 6  Frontend modular e UX
Etapa 7  Pontuação/desempates/gamificação
Etapa 8  Administração e observabilidade
Etapa 9  Testes, rehearsal e release
```

As etapas 0–5 formam a cadeia mínima para um Brasileirão isolado e seguro. As etapas 6–9 não são cosméticas: eliminam perda de dados de interface, consolidam integridade da competição e tornam a operação sustentável.

Esta sequência descreve **o que** será entregue. Para saber **qual instrução copiar**, siga a ordem única da [Pré-execução e Prompts 0–9](PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md#ordem-execucao). Não copie trechos deste plano como prompts independentes.

# Prompts canônicos — expansão do bolão para o Brasileirão 2026

> Este é o **único arquivo de execução** do plano. Copie prompts somente daqui. Os demais documentos explicam decisões, escopo e critérios de aceite; eles não são fontes alternativas de prompts.

## Como os documentos se relacionam

| Documento | Função | Deve ser copiado como prompt? |
|---|---|---|
| [plano-de-evolucao-bolao.md](plano-de-evolucao-bolao.md) | Diagnóstico, prioridades, fases e visão de produto | Não |
| [PLANO DE EXPANSÃO](<PLANO DE EXPANSÃO>) | Arquitetura-alvo, releases e invariantes | Não |
| `Etapa 0` a `Etapa 9` | Especificação detalhada e critérios de aceite de cada etapa | Não |
| **Este arquivo** | Instruções operacionais prontas para o agente | **Sim** |

<a id="ordem-execucao"></a>

## Ordem única de execução

```text
Pré-execução (uma vez, somente leitura)
  ↓
Prompt 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
  ↓
Prompt final de go-live (opcional, após todos os gates)
```

Use **um prompt por interação**. Aguarde a implementação, a revisão do diff e as evidências dos gates antes de enviar o próximo. Não agrupe etapas e não pule uma etapa bloqueada. Se parte do trabalho já existir, a pré-execução deve comprová-la e indicar o primeiro prompt ainda incompleto.

## Regras herdadas por todos os prompts

As regras abaixo valem para todos os blocos deste arquivo e não precisam ser repetidas pelo usuário:

1. Trabalhar no monorepo existente e ler `README.md`, `docs/plano-de-evolucao-bolao.md`, o documento da etapa corrente e os arquivos reais antes de editar.
2. Preservar integralmente dados, IDs, ranking, palpites, scores, mata-mata, backup/restore e rotas atuais da Copa do Mundo 2026.
3. Usar TypeScript estrito, Zod nas fronteiras, erros padronizados e autorização server-side. Não introduzir `any`, casts inseguros ou DTOs duplicados sem justificativa.
4. Aplicar expand–migrate–contract. Não executar `DROP`, `TRUNCATE`, limpeza destrutiva, alteração retroativa de pontuação ou contract migration sem autorização explícita.
5. Toda operação esportiva nova deve receber `seasonId`; palpite, score, ranking e conquista também devem receber `poolSeasonId`. Validar relações cruzadas no servidor.
6. Usar transações Prisma quando a validação e a escrita precisarem ser atômicas; jobs, imports, eventos e conquistas devem ser idempotentes.
7. Não criar regras por `slug`. Formato e comportamento derivam de capabilities, configuração e rule sets versionados.
8. Armazenar instantes em UTC e usar a timezone declarada pela temporada; para o Brasileirão 2026, `America/Sao_Paulo` enquanto confirmado pela fonte.
9. Dados externos exigem schema, provenance, checksum, reconciliação e fonte oficial verificada no momento da carga. Não inventar clubes, partidas, datas, horários ou regulamento.
10. Não registrar secrets, cookies, tokens, senhas, HTML ilimitado ou dados pessoais em logs, snapshots ou fixtures.
11. Não usar `npm audit fix --force`. Triar atualizações e regressões isoladamente.
12. Não fazer commit, push, merge, deploy, restore de produção ou alteração de serviço externo sem solicitação explícita.
13. Preservar mudanças preexistentes do usuário e limitar o diff ao escopo da etapa.
14. Ao terminar, executar os gates aplicáveis (`lint`, testes, build, Prisma, integração, E2E ou operação), informar comandos e resultados, listar arquivos alterados, riscos residuais e o próximo prompt. Falha de gate impede avançar silenciosamente.

No momento da implementação da Etapa 5, confirme novamente a agenda e o regulamento em fonte oficial da CBF. Datas registradas em revisão anterior são contexto, não constantes de código.

---

<a id="pre-execucao"></a>

## Pré-execução — auditoria e escolha do próximo prompt

Execute este prompt uma única vez no início ou quando não houver certeza sobre o estágio atual. Ele é somente leitura.

```text
Atue como engenheiro sênior responsável pela pré-execução do plano de expansão do repositório bolao-copa-2026.

Leia integralmente README.md, docs/plano-de-evolucao-bolao.md, docs/PLANO DE EXPANSÃO, docs/Etapa 0 até docs/Etapa 9 e docs/PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md. Inspecione o código, schema Prisma, migrations, scripts, testes e estado do Git.

Não altere arquivos, banco, dependências ou serviços. Para cada Etapa 0–9, classifique como NÃO INICIADA, PARCIAL, CONCLUÍDA ou BLOQUEADA e cite evidências verificáveis em arquivos/testes. Execute apenas verificações locais não destrutivas necessárias para confirmar a baseline.

Entregue:
1. resumo do estado real e divergências entre documentação e código;
2. matriz Etapa × status × evidência × gate faltante;
3. riscos P0/P1 ainda abertos;
4. primeiro prompt canônico que deve ser executado;
5. comandos de validação executados e seus resultados.

Não considere uma etapa concluída apenas porque seu documento existe. Não implemente correções nesta interação.
```

**Gate para continuar:** o primeiro prompt incompleto foi identificado com evidências e não há dúvida sobre a baseline a preservar.

---

<a id="prompt-0"></a>

## Prompt 0 — preservação da Copa e hardening P0

**Pré-requisito:** pré-execução concluída. Especificação: [Etapa 0](<Etapa 0 — Preservação do bolão da Copa>).

```text
Implemente exclusivamente a Etapa 0 do plano do repositório bolao-copa-2026.

Antes de editar, confirme a baseline e inspecione app/server, auth e sessões, SSE, Prisma, palpites simples e mata-mata, upload de avatar, provider GE, cliente HTTP/SSE do frontend, scripts de backup/restore e testes. Não crie entidades multi-competição nesta etapa.

Implemente, em mudanças pequenas e testáveis:
1. manifesto da Copa com commit, migrations, timezone, contagens e hashes determinísticos de ranking, palpites e scores;
2. backup custom do PostgreSQL com SHA-256 e inclusão versionada de uploads/avatars; ensaie restore em destino isolado e compare o manifesto;
3. propagação segura dos erros de session.regenerate/session.destroy ao pipeline Express;
4. revalidação de status/papel e revogação de sessões em bloqueio, reset de senha ou mudança de privilégio, usando sessionVersion ou mecanismo equivalente;
5. proteção CSRF compatível com web cookie-auth e cliente nativo, complementada por Origin/Fetch Metadata quando aplicável;
6. ownership e shutdown idempotente de HTTP server, Prisma, pool de sessões, jobs, timers e clientes SSE, com timeout e drenagem;
7. verificação do fechamento dentro da mesma transação da gravação do palpite, considerando fechado quando now >= closesAt;
8. preservação de drafts dirty em polling/SSE e estados Não salvo, Salvando, Salvo e Falhou; sucesso parcial não pode ser mostrado como total;
9. atualização segura do Multer, limites de upload, validação real do conteúdo, reencode e limpeza de órfãos;
10. timeout, limite de resposta, retry controlado e retenção de snapshots do provider.

Adicione testes negativos, de falha, fake timers, concorrência no limite e shutdown. Execute lint, todos os testes, build e npm audit --omit=dev; documente a triagem sem usar correção forçada. Entregue evidências do restore drill, dos hashes preservados e dos riscos residuais.
```

**Gate para continuar:** restore recupera banco e avatares; hashes da Copa são iguais; acesso revogado falha; CSRF inválido retorna 403; fechamento é atômico; processo encerra sem handles próprios abertos.

---

<a id="prompt-1"></a>

## Prompt 1 — decisões arquiteturais e contratos

**Pré-requisito:** Prompt 0 aprovado. Especificação: [Etapa 1](<Etapa 1 — Decisões arquiteturais e documentação>).

```text
Execute exclusivamente a Etapa 1 do plano do repositório bolao-copa-2026. Esta etapa é de decisão e documentação: não crie migration e não altere comportamento runtime.

Inspecione schema, rotas, serviços, frontend, contratos compartilhados, operação e evidências da Etapa 0. Produza ADR-001 a ADR-010 conforme a Etapa 1, cada um com contexto, alternativas, decisão, consequências, invariantes testáveis, compatibilidade, rollout e rollback.

Feche explicitamente:
- Competition, CompetitionSeason, Stage, Round, Pool, PoolMembership e PoolSeason;
- ownership/cardinalidade de Match, Prediction, Score, ranking e snapshots;
- capabilities para LEAGUE, GROUPS, KNOCKOUT e TWO_LEGS;
- fechamento individual e semântica do instante limite;
- versionamento imutável de pontuação e desempate;
- provider normalizado, mapping, override manual e provenance;
- estratégia expand–migrate–contract e aliases temporários da Copa;
- sessão, CSRF, RBAC, eventos SSE/outbox versionados, backup e observabilidade.

Atualize diagramas de entidades e fluxos de palpite, sync, ranking, evento, backup e restore. Use um glossário único. Valide todos os links Markdown e entregue decisões abertas com responsável e data-limite; não esconda decisões como suposições.
```

**Gate para continuar:** ADRs aprovados, termos sem ambiguidade, invariantes e rollout definidos; nenhuma decisão de schema necessária à Etapa 2 permanece aberta.

---

<a id="prompt-2"></a>

## Prompt 2 — schema aditivo e backfill da Copa

**Pré-requisito:** ADRs aprovados e baseline restaurável. Especificação: [Etapa 2](<Etapa 2 — Migração estrutural do banco>).

```text
Implemente exclusivamente a Etapa 2 do plano do repositório bolao-copa-2026, obedecendo aos ADRs aprovados e ao padrão expand–migrate. Não execute a fase contract.

Crie schema e migration aditivos para Competition, CompetitionSeason, Stage, Round, SeasonTeam, Pool, PoolMembership, PoolSeason, ProviderEntityMapping e a versão inicial do ScoringRuleSet. Adicione seasonId e poolSeasonId onde definido pelos ADRs, inicialmente de forma compatível, com índices e unicidades compostas. Não remova colunas legadas nem unifique ainda KnockoutFixture/KnockoutPick.

Crie backfill idempotente que registre world-cup/world-cup-2026, o pool padrão e seus relacionamentos, preservando IDs e dados. Implemente dual write/shadow read apenas onde previsto e mantenha rotas atuais funcionais.

Ensaie a migration sobre backup restaurado isoladamente. Registre duração e locks, execute novamente o backfill, detecte órfãos/duplicidades/relações cruzadas e compare contagens e hashes da Copa. Adicione testes PostgreSQL de constraints e isolamento negativo. Execute prisma format, validate, generate, migration tests, lint, testes e build. Entregue SQL, mapa de backfill, evidências e rollback de aplicação sem rollback destrutivo do schema.
```

**Gate para continuar:** backfill reexecutável sem duplicação; zero órfãos; hashes da Copa preservados; constraints impedem cruzamento; rollback de aplicação foi ensaiado.

---

<a id="prompt-3"></a>

## Prompt 3 — camada genérica de competições

**Pré-requisito:** Prompt 2 aprovado. Especificação: [Etapa 3](<Etapa 3 — Camada genérica de competições>).

```text
Implemente exclusivamente a Etapa 3 do plano do repositório bolao-copa-2026 sobre a migration aditiva aprovada.

Crie módulos coesos para competitions, seasons, pools, stages, rounds, matches, predictions, standings e rankings, separando controller/route, schema, caso de uso e acesso a dados somente onde houver responsabilidade real. Extraia DTOs e schemas Zod estritos para packages/shared e não exponha modelos Prisma como contratos de API.

Implemente as rotas genéricas definidas na Etapa 3 com contexto seasonId/poolSeasonId, membership server-side, paginação, selects mínimos, erros seguros com code/issues/requestId e fechamento transacional. O backend deve provar Match → Season e PoolSeason → Season antes de ler ou escrever.

Transforme as rotas da Copa em aliases temporários dos mesmos casos de uso, sem duplicar regra e sem condicionais por slug. Inclua eventId, occurredAt, seasonId, poolSeasonId e version nos eventos; publique apenas após commit/outbox. Adicione testes de contrato, paridade legado/novo, autorização e isolamento cruzado. Execute lint, testes e build e reporte telemetria necessária antes de retirar qualquer caminho legado.
```

**Gate para continuar:** rotas novas exigem contexto, cruzamentos falham, aliases da Copa mantêm paridade e eventos/logs são filtráveis por temporada e pool.

---

<a id="prompt-4"></a>

## Prompt 4 — providers e sincronização auditável

**Pré-requisito:** APIs genéricas e isolamento aprovados. Especificação: [Etapa 4](<Etapa 4 — Abstração da fonte de dados>).

```text
Implemente exclusivamente a Etapa 4 do plano do repositório bolao-copa-2026.

Extraia o sincronizador GE atual para o contrato CompetitionDataProvider e uma camada anticorrupção de DTOs normalizados. Implemente mappings por externalId e adapters necessários para GE preservado, fonte oficial/CBF quando tecnicamente viável, CSV e operação manual. Não aceite URL arbitrária controlada pelo usuário.

O pipeline deve oferecer dryRun, diff e apply; idempotency key; lock por provider+season+tipo; timeout; limite de bytes; redirect controlado; retry com jitter; schemas estritos; quarantine de ambiguidade; bulk writes e transações curtas. Registre source, checksum, início/fim, contagens e erro redigido.

Preserve Match ID em remarcação, impeça regressão automática de resultado FINISHED e dê precedência auditada ao override manual. Publique eventos após commit via outbox. Garanta finally para liberar lock/activeRun e shutdown do watch/Prisma.

Adicione fixtures locais e testes de parser, duplicidade, ambiguidade, remarcação, timeout, resposta excessiva, lock, resultado corrigido e override. Execute lint, testes e build; entregue runbook de reconciliação e contingência CSV/manual.
```

**Gate para continuar:** segunda importação gera zero inserts indevidos; timeout libera recursos; ambiguidade é quarantined; override sobrevive ao sync; contingência usa as mesmas validações.

---

<a id="prompt-5"></a>

## Prompt 5 — Brasileirão Série A 2026

**Pré-requisito:** provider e contingência aprovados. Especificação: [Etapa 5](<Etapa 5 — Implementação do Brasileirão 2026>).

```text
Implemente exclusivamente a Etapa 5 do plano do repositório bolao-copa-2026.

Antes de alterar dados, consulte novamente fontes oficiais vigentes da CBF para tabela, horários, clubes e regulamento. Registre URL/documento, collectedAt, timezone e checksum. Não use datas da documentação como constantes e não invente dados ausentes. Se a fonte não for suficiente ou os gates não estiverem completos, proponha iniciar em rodada posterior e pare antes de expor a temporada.

Crie brasileirao-serie-a e brasileirao-serie-a-2026 no domínio genérico, com formato LEAGUE, stage, 38 rounds, 20 SeasonTeams e somente partidas oficialmente reconciliadas. Configure PoolSeason.scoreableFrom/startsAtRound para impedir pontuação retroativa; jogos históricos alimentam standings, não ranking do bolão.

Implemente standings determinísticos J/V/E/D/GP/GC/SG/PTS e desempates versionados conforme regulamento confirmado. Implemente ranking geral, por rodada, mês e turno; política explícita para adiado, cancelado, remarcado e correção de resultado; fechamento individual e atômico.

Execute dry-run/diff, reconcilie e aplique como canário administrativo sob feature flags separadas de leitura, escrita e UI. Prove idempotência, preservação de Match ID, isolamento total da Copa e fallback CSV/manual. Execute lint, testes, build e smoke mobile/desktop antes de recomendar exposição pública.
```

**Gate para continuar:** carga reconciliada e idempotente; histórico não pontua; Copa mantém hashes; fechamento está correto; canário, fallback e rollback por flags foram ensaiados.

---

<a id="prompt-6"></a>

## Prompt 6 — frontend, UX/UI e acessibilidade

**Pré-requisito:** contratos genéricos e temporada em canário. Especificação: [Etapa 6](<Etapa 6 — Refatoração do frontend>).

```text
Implemente exclusivamente a Etapa 6 do plano do repositório bolao-copa-2026, preservando regras e contratos aprovados do backend.

Refatore incrementalmente App.tsx, predictionBoard.tsx, competitionV2.tsx e api.ts em shell, features, componentes, serviços e theme menores. Remova tipos duplicados em favor de contratos de packages/shared validados na entrada. Mantenha V1 atrás de feature flag até provar paridade.

Crie contexto/seletor de competição e temporada orientado a capabilities; TeamBadge com fallback; ScoreInput com label de time, teclado numérico, erros e foco; AsyncState; Toast acessível; skeletons; estados vazios úteis; cliente de requests/SSE com cancelamento, ordenação de resposta, reconnect e indicador Ao vivo/Reconectando/Offline.

Modele drafts pela chave userId+poolSeasonId. Polling, SSE ou resposta antiga não podem sobrescrever campo dirty; avise ao sair e mostre Não salvo, Salvando, Salvo e Falhou por item/lote. No mata-mata, associe inputs aos times e exija classificado no empate. No ranking, destaque usuário atual, líder da rodada, movimento, distância para o próximo e critérios de desempate, com hierarquia visual clara.

Valide 320, 768, 1280 e 1440 px, teclado, leitor de tela, contraste, alvos de toque e reduced motion. Adicione testes de componentes e E2E para login, palpite, mata-mata, troca de temporada, ranking, erros 401/403/409/5xx e reconnect. Meça renders/bundle antes de aplicar memo/useCallback/lazy loading. Execute lint, testes e build.
```

**Gate para continuar:** nenhum draft é perdido; fluxos críticos funcionam mobile/desktop e por teclado/leitor de tela; estados de erro/sync são inequívocos; V1/V2 têm paridade comprovada.

---

<a id="prompt-7"></a>

## Prompt 7 — pontuação configurável e gamificação

**Pré-requisito:** frontend e isolamento aprovados. Especificação: [Etapa 7](<Etapa 7 — Regras de pontuação configuráveis>).

```text
Implemente exclusivamente a Etapa 7 do plano do repositório bolao-copa-2026.

Modele ScoringRuleSetVersion e TieBreakerRuleSet imutáveis. Registre o sistema atual 15/3/1/0 como versão inicial sem recalcular o histórico da Copa e grave versão e breakdown em cada novo score. Faça cálculo e recomputação determinísticos, idempotentes e auditáveis.

Implemente de forma incremental AchievementDefinition, UserAchievement, Streak, RankingSnapshot, RankingMovement e NotificationInbox com chaves idempotentes e outbox transacional. Streak usa somente resultados finais em ordem definida; partidas ao vivo não consolidam conquista. Badges possuem critérios/versionamento; líder da rodada e movimento ficam provisórios enquanto aplicável. O resumo desde a última visita usa snapshot/lastSeen, não comparação acidental entre filtros.

Exiba regra de pontuação e desempate antes do início, progresso sem dark patterns e explicações acessíveis. Comece por inbox in-app; push/e-mail somente com opt-in, preferências e quiet hours.

Adicione testes unitários/property-based das regras, empates, replay, correção de resultado, concorrência e isolamento por PoolSeason. Prove que replay não duplica conquista, alteração de versão não muda score histórico e recomputação é reversível/auditada. Execute lint, testes e build.
```

**Gate para continuar:** placar histórico preservado; regras são versionadas; replay é idempotente; streak/badges/movimentos têm semântica clara e não misturam temporadas.

---

<a id="prompt-8"></a>

## Prompt 8 — administração e operação segura

**Pré-requisito:** domínio, provider e regras versionadas aprovados. Especificação: [Etapa 8](<Etapa 8 — Administração>).

```text
Implemente exclusivamente a Etapa 8 do plano do repositório bolao-copa-2026.

Crie painel e APIs administrativas por módulos coesos para temporadas/rodadas, import/sync, mappings/quarantine, overrides de partida, rule sets, usuários, auditoria, jobs e saúde. Revalide RBAC e sessão em toda ação; admin global não recebe membership social implicitamente.

Toda mutação sensível exige schema Zod estrito, CSRF, justificativa, idempotency key e auditoria before/after com actor, requestId, seasonId e poolSeasonId. Ações de alto impacto exigem preview/dry-run, contagem de registros afetados e confirmação reforçada; nunca expor botão genérico de reset ou exclusão em massa.

Permita visualizar divergências, resolver mapping ambíguo, aplicar override manual com provenance, pausar/reexecutar jobs com segurança e inspecionar health de provider, SSE, pool de conexão, ranking e backup. Reprocessamento deve mostrar impacto e respeitar ruleSetVersion.

Adicione testes negativos de RBAC/membership/CSRF, concorrência, duplicidade, auditoria, replay e proteção contra alteração cruzada de temporada. Execute lint, testes e build e entregue runbook operacional com rollback de cada ação sensível.
```

**Gate para continuar:** ações sensíveis são autorizadas, previstas e auditadas; nenhuma ação cruzada passa; import/override/reprocessamento possuem dry-run e rollback documentados.

---

<a id="prompt-9"></a>

## Prompt 9 — testes obrigatórios e release gates

**Pré-requisito:** Prompts 0–8 implementados. Especificação: [Etapa 9](<Etapa 9 — Testes obrigatórios>).

```text
Implemente exclusivamente a Etapa 9 do plano do repositório bolao-copa-2026. Não use esta etapa para esconder correções funcionais amplas: reporte achados e corrija somente defeitos diretamente comprovados pelos testes, mantendo o escopo explícito.

Substitua o placeholder de testes web e monte a pirâmide definida na Etapa 9:
- unitários de pontuação, desempate, standings, gamificação, timezone, fechamento e providers;
- integração com PostgreSQL real para migration/backfill, constraints, sessão, CSRF, concorrência, import, outbox, ranking e isolamento;
- contrato de API/SSE para schemas, aliases da Copa, membership, reconexão, backpressure, bloqueio e shutdown;
- componentes frontend para drafts, feedback, ranking, mata-mata, erros e reduced motion;
- E2E mobile/desktop para login, palpite, limite, troca de competição, ranking e admin;
- acessibilidade, carga/budget, migration rehearsal, backup+avatares, restore drill e rollback por flags.

Use clock injetável e fixtures locais; o CI não pode depender de GE/CBF ao vivo. Configure CI reprodutível com npm ci e gates separados para PR, release candidate, migration e go-live. Registre duração, flakiness e artefatos sem PII.

Execute toda a matriz disponível, incluindo lint e build. Faça um ensaio completo sobre backup sanitizado, compare hashes da Copa e prove restore e rollback. Produza relatório GO/NO-GO com P0/P1, cobertura por risco e itens que exigem ambiente externo. Não declare go-live se algum gate obrigatório estiver ausente ou falhando.
```

**Gate para continuar:** CI e suítes obrigatórias passam; restore/migration/rollback foram ensaiados; hash da Copa é preservado; nenhum P0/P1 permanece aberto.

---

<a id="prompt-final"></a>

## Prompt final — auditoria de go-live

Este prompt é opcional e somente deve ser executado após a aprovação do Prompt 9. Ele não autoriza deploy.

```text
Faça a auditoria final de go-live do plano de expansão do bolao-copa-2026 em modo somente leitura.

Revise evidências dos Prompts 0–9, diffs, ADRs, migrations, hashes, relatórios de teste, audit de dependências, reconciliação da fonte oficial, feature flags, observabilidade, backup/restore e rollback. Reconsulte a fonte oficial vigente da CBF e compare os dados que serão expostos. Não altere código, banco, configuração externa ou flags.

Entregue:
1. decisão GO ou NO-GO fundamentada por gate;
2. checklist de preservação da Copa;
3. divergências de dados/agenda/regulamento;
4. P0/P1/P2 residuais com owner e ação;
5. sequência operacional de canário, abertura, monitoramento e rollback;
6. evidências que ainda precisam ser coletadas em produção.

Se qualquer gate estiver ausente, declare NO-GO e indique exatamente qual prompt/critério precisa ser retomado. Não execute deploy, push, merge, restore ou abertura de feature flag sem nova autorização explícita.
```

## Regra para retomadas

Se uma etapa falhar ou ficar parcial, reenvie **o mesmo prompt**, acrescentando no início as evidências da execução anterior e pedindo apenas a conclusão dos itens pendentes. Não avance para o número seguinte até o gate estar atendido. Se o código mudar substancialmente ou a documentação ficar dessincronizada, execute novamente a [Pré-execução](#pre-execucao).

# Plano e prompts canônicos — Copa do Brasil, Libertadores e Sul-Americana 2026

> Este é o arquivo canônico para continuar a expansão do Bolão Sirel depois do Brasileirão. Ele reúne diagnóstico, arquitetura, fases, gates e prompts prontos para o Codex no VS Code. Execute um prompt por interação, na ordem indicada.

## 1. Objetivo

Evoluir o monorepo `bolao-copa-2026` para suportar, sem regressão da Copa do Mundo ou do Brasileirão:

- CONMEBOL Sul-Americana 2026;
- CONMEBOL Libertadores 2026;
- Copa do Brasil 2026;
- futuras edições dessas competições apenas por configuração, temporada e provider, sem novas rotas ou regras codificadas por slug.

A expansão deve preservar a regra de pontuação do bolão `15/3/1/0`, o fechamento individual por partida, o ranking por `PoolSeason`, os dados históricos, os snapshots, a auditoria, o SSE e a operação local já existente.

## 2. Baseline observada em 21/07/2026

O repositório já possui:

- monorepo TypeScript com Express, Prisma/PostgreSQL, Expo/React Native Web e pacote compartilhado;
- `Competition`, `CompetitionSeason`, `Stage`, `Round`, `SeasonTeam`, `Pool` e `PoolSeason`;
- APIs genéricas por temporada;
- pontuação e ranking isolados por `PoolSeason`;
- providers com normalização, dry-run, idempotência, mappings, locks, quarentena, checksum e override;
- capabilities `LEAGUE`, `GROUPS`, `KNOCKOUT` e `TWO_LEGS`;
- feature flags, SSE/outbox, auditoria e gates de qualidade;
- Brasileirão 2026 carregado e publicado.

Lacunas que este plano deve fechar:

1. `routes.ts`, `CompetitionSubnav` e partes do workspace ainda conhecem nominalmente apenas Copa do Mundo e Brasileirão.
2. `SeasonWorkspace` usa fallback para o Brasileirão quando a competição selecionada não é uma liga.
3. a sincronização pública ainda instancia diretamente o provider CBF do Brasileirão e valida sua temporada por slug;
4. `KnockoutFixture`/`KnockoutPick` continuam como legado específico da Copa do Mundo;
5. ainda não existe `Tie` para agrupar um ou dois jogos, agregado, pênaltis e classificado;
6. contratos de perfis de clubes ainda contêm conceitos exclusivos da CBF/Série A;
7. ranking e navegação ainda oferecem filtros como turno mesmo em formatos que precisam de fase/grupo/mata-mata;
8. não existem módulos, seeds, providers ou slugs das três novas competições.

## 3. Recorte esportivo oficial de 2026

As fontes abaixo servem como contexto e evidência inicial. Cada prompt de carga deve consultar novamente a fonte oficial antes de persistir clubes, partidas, horários, estádios, fases ou critérios.

### 3.1 Sul-Americana 2026

- fase de grupos com 32 clubes, oito grupos de quatro e seis partidas por clube;
- líder de cada grupo diretamente nas oitavas;
- segundo colocado disputa playoff contra um terceiro colocado da Libertadores;
- playoffs, oitavas, quartas e semifinais em ida e volta;
- final em jogo único em 21/11/2026, em Barranquilla;
- em 21/07/2026 os playoffs já estavam começando.

Fontes oficiais:

- <https://gol.conmebol.com/sudamericana/es/news/por-la-gran-conquista-estos-son-los-grupos-de-la-conmebol-sudamericana-2026>
- <https://gol.conmebol.com/sudamericana/es/news/para-tomar-nota-asi-se-jugaran-los-playoffs-de-octavos-de-final-de-la-conmebol-sudamericana>
- <https://www.conmebol.com/documentos/manual-de-clubes-conmebol-sudamericana-2026/>

### 3.2 Libertadores 2026

- fase de grupos com 32 clubes, oito grupos de quatro e seis partidas por clube;
- dois primeiros de cada grupo nas oitavas;
- terceiros transferidos para os playoffs da Sul-Americana;
- oitavas, quartas e semifinais em ida e volta;
- final em jogo único em 28/11/2026, em Montevidéu;
- oitavas programadas para começar em 11/08/2026.

Fontes oficiais:

- <https://gol.conmebol.com/libertadores/es/news/fechas-y-horarios-asi-se-jugaran-los-octavos-de-final-de-la-conmebol-libertadores>
- <https://gol.conmebol.com/libertadores/es/news/asi-se-disputaran-los-octavos-de-final-de-la-conmebol-libertadores>
- <https://www.conmebol.com/documentos/manual-de-clubes-conmebol-libertadores-2026/>

### 3.3 Copa do Brasil 2026

- 126 clubes e nove fases;
- primeira à quarta fase em partida única, com pênaltis em caso de empate;
- quinta fase, oitavas, quartas e semifinais em ida e volta;
- final em jogo único prevista para 06/12/2026;
- em julho de 2026 a sexta fase já tinha confrontos e tabela divulgados.

Fontes oficiais:

- <https://www.cbf.com.br/futebol-brasileiro/noticias/campeonato-brasileiro/serie-b/cbf-divulga-tabela-basica-plano-geral-de-acoes-e-regulamento-especifico-da-copa-do-brasil-2026>
- <https://www.cbf.com.br/futebol-brasileiro/noticias/copa-do-brasil/sub-20/copa-do-brasil-de-2026-tera-recorde-de-participantes-e-17-estreantes>
- <https://www.cbf.com.br/futebol-brasileiro/noticias/copa-brasil-masculino/a/cbf-divulga-tabela-detalhada-da-6-fase-da-copa-betano-do-brasil>

## 4. Decisões arquiteturais obrigatórias

### 4.1 Um núcleo, três configurações

Não criar `LibertadoresMatch`, `SudamericanaMatch` ou `CopaDoBrasilMatch`. As três competições devem usar:

- `Competition` como identidade permanente;
- `CompetitionSeason` como edição;
- `Stage` como agrupamento de grupos ou mata-mata;
- `Round` como fase/rodada esportiva;
- `Match` como partida individual;
- `Tie` como série eliminatória com um ou dois jogos;
- `PoolSeason` como contexto social e de pontuação.

### 4.2 Estrutura de `Tie`

O modelo final deve representar, no mínimo:

- `seasonId`, `stageId` e `roundId`;
- ordem/chave estável da série;
- `teamAId` e `teamBId`, sem tratar mandante do primeiro jogo como identidade da série;
- quantidade esperada de jogos;
- partidas e respectivos números de perna;
- placar agregado;
- classificado/vencedor;
- método de decisão: agregado, pênaltis, prorrogação, W.O. ou decisão administrativa;
- status, provenance e metadados;
- mapping externo próprio pelo provider.

`KnockoutFixture` e `KnockoutPick` da Copa permanecem durante a fase expand. A migração para `Tie` deve usar shadow read e testes de paridade antes de qualquer contract migration.

### 4.3 Resultado da partida

Não confundir:

- placar no tempo regulamentar;
- placar após prorrogação;
- placar de pênaltis;
- placar agregado da série;
- equipe classificada.

A regra `15/3/1/0` deve declarar qual base de placar utiliza. Para as novas temporadas, o padrão inicial será o placar do tempo regulamentar, salvo decisão expressa e nova versão imutável da regra.

### 4.4 Providers configurados, nunca escolhidos por slug

Criar configuração explícita entre temporada e provider, contendo pelo menos:

- chave do provider;
- prioridade;
- tipos habilitados: times, calendário, resultados, standings e ties;
- cadência e timeout;
- ativo/inativo;
- provenance e configuração não sensível.

O scheduler deve percorrer temporadas ativas e suas configurações. Não usar `if (slug === ...)` para escolher fonte ou comportamento.

### 4.5 Corte temporal e ausência de retroatividade

Cada nova `PoolSeason` deve usar `scoreableFrom` com instante exato. Partidas anteriores:

- podem aparecer como histórico;
- alimentam grupos, chaves e estatísticas;
- não aceitam palpites;
- não geram pontos, conquistas ou movimentos no ranking.

O corte deve ser o primeiro jogo futuro posterior à homologação na máquina de teste. Se o prazo for curto, adiar para a fase seguinte.

### 4.6 Rotas genéricas

Destino esperado:

```text
/competicoes/:competitionSlug
/competicoes/:competitionSlug/jogos
/competicoes/:competitionSlug/palpites
/competicoes/:competitionSlug/classificacao
/competicoes/:competitionSlug/chave
/competicoes/:competitionSlug/ranking
/competicoes/:competitionSlug/times
/competicoes/:competitionSlug/times/:teamId/:section
```

As abas devem ser construídas por capabilities. Liga mostra classificação/turnos; grupos mostram grupos; mata-mata mostra chave; formato híbrido reúne grupos e chave.

## 5. Ordem de execução

```text
Pré-execução — auditoria somente leitura
  ↓
Prompt 0 — baseline, gates e documentação da execução
  ↓
Prompt 1 — runtime verdadeiramente genérico
  ↓
Prompt 2 — Tie e resultado eliminatório
  ↓
Prompt 3 — providers oficiais configuráveis
  ↓
Prompt 4 — Sul-Americana 2026
  ↓
Prompt 5 — Libertadores 2026
  ↓
Prompt 6 — Copa do Brasil 2026
  ↓
Prompt 7 — frontend premium das copas
  ↓
Prompt 8 — ranking, conquistas e sala de troféus
  ↓
Prompt 9 — administração, jobs e observabilidade
  ↓
Prompt 10 — matriz de testes e canário na máquina de teste
  ↓
Auditoria final de produção — somente leitura
```

Não agrupe prompts. Revise o diff e as evidências de um prompt antes de enviar o seguinte.

## 6. Regras herdadas por todos os prompts

1. Trabalhar diretamente na branch `main`, conforme autorização do proprietário. Não criar branch nem pull request.
2. Antes de editar, executar `git status -sb`, confirmar `main` e atualizar com `git pull --ff-only origin main`. Se houver mudanças não relacionadas ou divergência, parar e relatar; não sobrescrever trabalho existente.
3. Ao final de cada prompt implementado, executar os gates aplicáveis, revisar o diff, adicionar somente arquivos do escopo, criar o commit indicado e enviar para `origin/main`. Gate falho impede commit/push.
4. Não fazer deploy, restore, migration ou alteração na máquina/banco de produção. A implementação e as migrations devem ser verificadas primeiro na máquina de teste.
5. Preservar integralmente IDs, dados, palpites, scores, rankings, mata-mata, snapshots, rotas e operação da Copa do Mundo 2026 e do Brasileirão 2026.
6. Usar expand–migrate–contract. Não executar `DROP`, `TRUNCATE`, reset, limpeza destrutiva ou contract migration neste plano.
7. Toda consulta esportiva nova exige `seasonId`; palpite, score, ranking, conquista e notificação exigem também `poolSeasonId`.
8. Não criar comportamento por slug. Usar capabilities, stages, rounds, rule sets e configuração de provider.
9. TypeScript estrito, Zod nas fronteiras, erros padronizados, autorização server-side e transações quando validação e escrita precisarem ser atômicas.
10. Imports, jobs, eventos, conquistas e recomputações devem ser idempotentes e auditáveis.
11. Dados externos exigem fonte oficial revalidada, `collectedAt`, checksum, schema, mapping, reconciliação, dry-run e fallback manual/CSV.
12. Não inventar clube, confronto, data, horário, estádio, classificado, regulamento ou placar.
13. Armazenar instantes em UTC. Exibir pela timezone da temporada, inicialmente `America/Sao_Paulo`, sem perder o offset original da fonte.
14. O frontend nunca consulta CBF ou CONMEBOL diretamente; consome somente a API própria.
15. Não alterar a regra `15/3/1/0` nem adicionar bônus de classificado sem nova versão de regra e autorização expressa.
16. Não usar `npm audit fix --force`.
17. Cada resposta do agente deve informar arquivos alterados, migrations, comandos/gates, resultados, riscos residuais, hash do commit e próximo prompt.

---

## Pré-execução — auditoria e escolha do ponto inicial

Este prompt não altera nem commita arquivos.

```text
Atue como engenheiro sênior responsável pela pré-execução da expansão do Bolão Sirel para Copa do Brasil, Libertadores e Sul-Americana 2026.

Trabalhe no repositório bolao-copa-2026. Leia integralmente README.md, docs/PROMPTS_CODEX_EXPANSAO_BRASILEIRAO_2026.md, docs/architecture/*.md e docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md. Inspecione o estado real do Git, schema Prisma, migrations, APIs, providers, scheduler, frontend, testes e scripts.

Não altere arquivos, banco, dependências ou serviços. Confirme:
- branch, HEAD e limpeza do worktree;
- estado da Copa do Mundo e do Brasileirão;
- quais lacunas listadas no plano ainda existem;
- existência de condicionais por slug, fallbacks para o Brasileirão e código de mata-mata legado;
- gates e checks atualmente disponíveis.

Entregue:
1. matriz Prompt 0–10 × NÃO INICIADO/PARCIAL/CONCLUÍDO/BLOQUEADO × evidência;
2. riscos P0/P1;
3. primeiro prompt ainda necessário;
4. comandos somente leitura executados e resultados;
5. confirmação de que não houve alteração ou commit.

Não considere concluído apenas porque existe documentação. Não implemente correções.
```

Gate: baseline conhecida e primeiro prompt necessário identificado com evidências.

---

## Prompt 0 — baseline, gates e registro da execução

Commit esperado: `docs: registrar baseline da expansão das copas`

```text
Implemente exclusivamente o Prompt 0 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, trabalhando diretamente na main e obedecendo às regras herdadas do documento.

Atualize a documentação de baseline para o HEAD atual. Registre arquitetura real, contagens relevantes, rotas, providers, migrations, testes, scripts e lacunas das três copas. Gere ou atualize artefatos determinísticos de preservação da Copa e do Brasileirão, incluindo hashes de palpites, scores e rankings quando o ambiente local permitir.

Execute npm ci se necessário e rode, no mínimo, lint, testes, build, validação Prisma e preservation gates já existentes. Não corrija funcionalidades fora do escopo; se um gate falhar, investigue, documente e pare sem commit.

Produza um checklist de pré-migration e confirme que o backup/restore ensaiável cobre banco, avatares, manifests e checksums. Nenhuma migration nova deve ser criada neste prompt.

Ao concluir com todos os gates aplicáveis aprovados, revise o diff, faça commit direto na main com a mensagem `docs: registrar baseline da expansão das copas` e envie para origin/main. Informe o hash e o próximo prompt.
```

Gate: baseline reprodutível, hashes preserváveis e suíte atual aprovada antes de mudança estrutural.

---

## Prompt 1 — runtime verdadeiramente genérico

Commit esperado: `refactor: generalizar navegacao e sincronizacao por temporada`

```text
Implemente exclusivamente o Prompt 1 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Elimine os bloqueios que impedem uma terceira competição:
1. substitua o roteamento enumerado por Copa/Brasileirão por parsing e geração genéricos em /competicoes/:competitionSlug/:section, mantendo aliases legados;
2. derive subnavegação e telas por capabilities, não por conjuntos worldCupScreens/leagueScreens;
3. faça SeasonWorkspace e telas de time usarem sempre CompetitionContext/season selecionada; remova fallback para brasileiraoSeasons;
4. generalize pathForLeagueTeam, títulos, primary destinations e seleção de temporada;
5. substitua o assert específico do Brasileirão e a instanciação direta do provider CBF por um registry/factory explícito configurado por temporada;
6. transforme o scheduler em execução por temporadas ativas e providers configurados, sem slug condicional;
7. preserve as rotas, deep links, seleção local, Copa e Brasileirão existentes.

Não crie ainda as três competições e não implemente Tie. Adicione testes de rota genérica, capability, troca de competição, provider registry, scheduler e ausência de mistura de temporada. Inclua teste que seleciona uma competição híbrida fictícia e prova que nenhum dado do Brasileirão é carregado.

Execute lint, testes, build, contratos e E2E aplicáveis. Gate aprovado: faça commit `refactor: generalizar navegacao e sincronizacao por temporada` na main e push para origin/main. Caso contrário, não commite.
```

Gate: uma competição fictícia aparece e navega sem qualquer novo case por slug e sem consultar endpoints do Brasileirão.

---

## Prompt 2 — domínio genérico de mata-mata e `Tie`

Commit esperado: `feat: adicionar series eliminatorias genericas`

```text
Implemente exclusivamente o Prompt 2 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main, usando migration aditiva expand-only.

Leia ADR-006 e implemente o domínio genérico Tie para séries de uma ou duas partidas. Antes do schema, atualize o ADR com a decisão física final e invariantes.

Modele Tie, status e método de decisão, relações com season/stage/round/equipes/vencedor e ligação de Match com tieId/legNumber. Modele de forma não ambígua placar regulamentar, prorrogação, pênaltis, agregado e classificado. Acrescente TIE ao mapping do provider e contratos/DTOs Zod correspondentes.

Não remova nem regrave KnockoutFixture, KnockoutPick ou scores da Copa. Implemente convivência, adapters/aliases e shadow read somente onde necessário. Adicione serviço determinístico para recomputar agregado e classificado, cobrindo um jogo, dois jogos, pênaltis, W.O., correção posterior e série incompleta. O provider não pode promover automaticamente equipe sem dados suficientes.

Se implementar TiePrediction, mantenha eventual bônus de classificado desativado; a regra 15/3/1/0 continua aplicada somente a Match. Garanta unicidades e isolamento por season/pool.

Ensaie a migration em banco isolado/restaurado. Execute Prisma format/validate/generate, testes unitários e PostgreSQL de constraints, lint, testes e build. Compare hashes da Copa/Brasileirão. Gate aprovado: commit `feat: adicionar series eliminatorias genericas` na main e push. Gate falho: não commite.
```

Gate: séries de um/dois jogos e pênaltis funcionam; legado mantém paridade e hashes; zero operação destrutiva.

---

## Prompt 3 — providers oficiais configuráveis para copas

Commit esperado: `feat: preparar providers oficiais para competicoes eliminatorias`

```text
Implemente exclusivamente o Prompt 3 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Estenda CompetitionDataProvider e o pipeline de sync para os dados necessários às três copas: grupo, país, stage, round, tie, leg, estádio, placar regulamentar, prorrogação, pênaltis, método de decisão, classificado e standings por grupo. Preserve compatibilidade com GE, CSV, manual e CBF Série A.

Crie uma configuração persistida e auditável SeasonProviderConfig (ou solução equivalente aprovada no ADR), usada por API, scheduler e ações administrativas. External IDs devem ser namespaced por provider/competição/temporada ou protegidos por chave composta equivalente.

Implemente infraestrutura compartilhada para:
- provider CONMEBOL usado por Libertadores e Sul-Americana;
- provider CBF usado pela Copa do Brasil, sem acoplá-lo ao provider da Série A;
- snapshots/fixtures imutáveis de páginas, PDFs ou respostas oficiais;
- checksum, collectedAt, source, dry-run/diff/apply/verify;
- quarantine de clube, fase, rodada, série, horário ou classificado ambíguo;
- fallback CSV/manual com exatamente os mesmos contratos;
- cache, timeout, limite de bytes, redirect controlado e retry;
- remarcação preservando Match ID e Tie ID;
- resultado FINISHED sem regressão automática.

Não carregue ainda uma temporada real. Use fixtures locais sanitizadas e não dependa de CBF/CONMEBOL ao vivo no CI. Adicione testes de parser, timezone/offset, duplicidade, ida/volta invertida, agregado, pênaltis, correção e fallback.

Execute lint, testes, build, contratos e integração. Gate aprovado: commit `feat: preparar providers oficiais para competicoes eliminatorias` na main e push. Gate falho: não commite.
```

Gate: o mesmo pipeline normalizado representa os três formatos e segunda importação não cria duplicidade.

---

## Prompt 4 — Sul-Americana 2026

Commit esperado: `feat: adicionar conmebol sul-americana 2026`

```text
Implemente exclusivamente o Prompt 4 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Revalide, no momento da execução, o Manual de Clubes, grupos, classificação, playoffs, chave, datas, horários e estádios em fontes oficiais da CONMEBOL. Registre URLs, collectedAt, timezone/offset e checksums. Não invente nem complete lacunas por memória.

Crie:
- Competition slug conmebol-sudamericana;
- CompetitionSeason 2026 com capabilities GROUPS+KNOCKOUT+TWO_LEGS+STANDINGS+LIVE_SCORING;
- stages para fase preliminar histórica, fase de grupos e fase final;
- grupos A–H, rounds 1–6, SeasonTeams e partidas históricas reconciliadas;
- playoffs com segundos da Sul-Americana e terceiros da Libertadores;
- ties das oitavas, quartas, semifinais e final conforme forem oficialmente definidos;
- PoolSeason do bolao-do-trabalho com regra 15/3/1/0 versionada;
- feature flags separadas para read, write, UI e sync.

Como a competição já começou, use historicalMatchesScoreable=false e scoreableFrom com o primeiro jogo futuro posterior à homologação. A meta recomendada é iniciar a pontuação nas oitavas de 11/08/2026; se o prompt for executado depois ou sem antecedência segura, mova o corte para a próxima fase e documente.

Implemente load/reconcile scripts com dry-run, apply e segunda execução de verificação. Histórico deve aparecer em grupos/chave sem gerar pontos. Teste transferência de terceiros da Libertadores sem duplicar Team global.

Execute gates, smoke administrativo e comparação de hashes da Copa/Brasileirão. Gate aprovado: commit `feat: adicionar conmebol sul-americana 2026` na main e push. Não habilite escrita/UI pública automaticamente.
```

Gate: temporada reconciliada, histórico não pontua, ties corretos, import idempotente e flags ainda em canário.

---

## Prompt 5 — Libertadores 2026

Commit esperado: `feat: adicionar conmebol libertadores 2026`

```text
Implemente exclusivamente o Prompt 5 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Revalide Manual de Clubes, grupos, standings, classificados, chave das oitavas, datas, horários e estádios em fontes oficiais da CONMEBOL. Registre provenance e checksums. Reuse o provider CONMEBOL e o domínio criados nos Prompts 2–4; não copie serviços da Sul-Americana.

Crie:
- Competition slug conmebol-libertadores;
- CompetitionSeason 2026 com capabilities GROUPS+KNOCKOUT+TWO_LEGS+STANDINGS+LIVE_SCORING;
- fases preliminares como histórico, fase de grupos A–H e fase final;
- grupos, rounds, times e partidas reconciliadas;
- ties das oitavas, quartas, semifinais e final;
- vínculo explícito dos terceiros colocados exportados para a Sul-Americana, preservando a identidade global de Team;
- PoolSeason do bolao-do-trabalho, rule sets e feature flags.

Use historicalMatchesScoreable=false. Se a implementação estiver homologada com antecedência, scoreableFrom pode começar nas oitavas de 11/08/2026; caso contrário, escolha o primeiro jogo de fase futura completamente verificável. Não gere pontos retroativos.

Implemente scripts load/reconcile idempotentes e testes de grupos, classificação, ties, classificação exportada, correção de placar e isolamento da Sul-Americana. Execute gates e hashes de preservação. Gate aprovado: commit `feat: adicionar conmebol libertadores 2026` na main e push. Mantenha UI/write públicas desativadas até o Prompt 10.
```

Gate: Libertadores reutiliza o núcleo comum, não duplica clubes e não mistura eventos/ranking com Sul-Americana.

---

## Prompt 6 — Copa do Brasil 2026

Commit esperado: `feat: adicionar copa do brasil 2026`

```text
Implemente exclusivamente o Prompt 6 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Revalide o REC, PGA, tabela básica, tabela detalhada e resultados atuais em fontes oficiais da CBF. Confirme o formato de nove fases, participantes, entrada de clubes por fase, mandos, jogos únicos, ida/volta, pênaltis e final. Registre documentos, URLs, collectedAt, timezone e checksums.

Crie:
- Competition slug copa-do-brasil;
- CompetitionSeason 2026 com capabilities KNOCKOUT+TWO_LEGS+LIVE_SCORING;
- rounds/fases 1 a 9;
- ties de um jogo nas fases 1–4;
- ties de dois jogos na quinta fase, oitavas, quartas e semifinais;
- final de jogo único;
- 126 SeasonTeams com metadado de fase de entrada, sem exigir que todos estejam ativos na mesma rodada;
- partidas, resultados, pênaltis e classificados históricos;
- PoolSeason, rule sets e feature flags.

Não force standings de liga/grupo. A UI deve usar chave e lista por fase. Use historicalMatchesScoreable=false e corte no primeiro jogo futuro após homologação; se a sexta fase já tiver iniciado, selecione a fase posterior.

O provider CBF da Copa deve compartilhar infraestrutura HTTP/auditoria com o da Série A, mas ter parser, IDs, readiness e validações próprios. Preserve Match/Tie IDs em remarcação e inversão de mando oficialmente corrigida.

Implemente load/reconcile com dry-run/apply/verify e testes das nove fases, entrada tardia, jogo único, ida/volta, pênaltis, final e 126 clubes. Execute todos os gates e hashes. Gate aprovado: commit `feat: adicionar copa do brasil 2026` na main e push. Não habilite UI/write pública ainda.
```

Gate: nove fases representadas, 126 clubes reconciliados, partidas históricas sem pontos e import idempotente.

---

## Prompt 7 — experiência premium das três copas

Commit esperado: `feat: publicar experiencia generica das copas`

```text
Implemente exclusivamente o Prompt 7 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Finalize a experiência capability-driven para Libertadores, Sul-Americana e Copa do Brasil sem criar telas duplicadas por torneio.

Implemente componentes genéricos:
- CompetitionHero com tema/metadados da competição;
- StageSelector e RoundSelector;
- GroupStandings para grupos A–H;
- KnockoutBracket/TieCard com ida, volta, agregado, pênaltis e classificado;
- MatchPredictionCard com fechamento individual e estado de sync;
- CompetitionTeams sem campos obrigatórios exclusivos da CBF;
- ranking com filtros overall, stage e round; turno somente para ligas;
- estados loading/empty/error/offline e atualização manual;
- deep links genéricos e breadcrumbs.

Remova literais visuais do Brasileirão de componentes genéricos. Diferencie as competições por metadata/theme configurável, com fallback seguro e sem depender de marcas/imagens remotas para funcionar.

Mantenha drafts por userId+poolSeasonId+scope, aviso de não salvos correto, descarte explícito, previsões públicas somente após fechamento, SSE por temporada e atualização manual do contexto ativo.

Valide 320/768/1280/1440 px, teclado, leitor de tela, contraste, reduced motion e navegadores suportados. Adicione component tests e E2E para cada formato: grupos+híbrido, mata-mata puro, ida/volta e final única.

Execute gates. Gate aprovado: commit `feat: publicar experiencia generica das copas` na main e push. Ainda não habilite tudo para usuários sem o canário do Prompt 10.
```

Gate: as três competições usam o mesmo conjunto de componentes e nenhuma seleção apresenta dados de outra temporada.

---

## Prompt 8 — ranking, conquistas e sala de troféus

Commit esperado: `feat: expandir gamificacao para competicoes eliminatorias`

```text
Implemente exclusivamente o Prompt 8 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Expanda ranking e gamificação de forma configurável e isolada por PoolSeason. Preserve a regra de pontos 15/3/1/0 por partida e não ative bônus de classificado sem autorização.

Implemente filtros overall, stage e round, snapshots/movimentos compatíveis com grupos e mata-mata, além de conquistas idempotentes como:
- Mestre da Fase de Grupos;
- Rei dos Playoffs;
- Especialista em Mata-Mata;
- Cravou Ida e Volta;
- Cravou na Final;
- Campeão da Libertadores no Bolão;
- Campeão da Sul-Americana no Bolão;
- Campeão da Copa do Brasil no Bolão.

Adapte PremiumRanking, avatares, pódio, movimentos, streaks, sala de troféus e modais para temporada/fase. Não consolidar conquista com resultado LIVE. Correção oficial deve recomputar de forma auditável, reversível e sem duplicar prêmios.

Se TiePrediction já existir, use escolha de classificado inicialmente para estatística/conquista sem alterar pontos. Qualquer futura pontuação exige ScoringRuleSetVersion nova, preview e aprovação expressa.

Adicione testes de replay, correção, empate, pênaltis, isolamento, histórico fora do corte e troca de temporada. Execute gates. Gate aprovado: commit `feat: expandir gamificacao para competicoes eliminatorias` na main e push.
```

Gate: replay não duplica conquistas, histórico permanece intacto e cada sala de troféus identifica a competição/temporada.

---

## Prompt 9 — administração, jobs e observabilidade

Commit esperado: `feat: operar multiplas competicoes oficiais`

```text
Implemente exclusivamente o Prompt 9 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main.

Generalize administração e operação das três novas competições:
- listar temporadas, provider configurado, última sincronização e próximo job;
- executar dry-run, diff, apply e verify por tipo;
- resolver quarantine/mapping de team, match, stage, round e tie;
- visualizar e aplicar override auditado;
- pausar, retomar e reexecutar job com idempotency key;
- configurar cadência por temporada/fase sem editar código;
- mostrar saúde, source/checksum, contagens e erros redigidos;
- preview do impacto de recomputação de scores/ranking;
- feature flags read/write/ui/sync por temporada.

O scheduler deve aumentar frequência apenas em janela próxima a partidas LIVE/SCHEDULED e reduzir fora dela, respeitando lock, timeout e shutdown. Falha de uma temporada não deve bloquear as outras. O botão Atualizar usa o provider do contexto selecionado e cooldown server-side.

Toda mutação exige RBAC, sessão válida, CSRF, justificativa, auditoria before/after, requestId, seasonId e poolSeasonId. Ações de alto impacto exigem preview e confirmação reforçada.

Adicione testes de isolamento, concorrência, provider indisponível, fallback, lock órfão, timeout, shutdown e auditoria. Execute gates. Gate aprovado: commit `feat: operar multiplas competicoes oficiais` na main e push.
```

Gate: falha de um provider fica contida; operação é observável, auditável e reversível por flags.

---

## Prompt 10 — testes completos e canário na máquina de teste

Commit esperado: `test: validar expansao das copas 2026`

```text
Implemente exclusivamente o Prompt 10 de docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md, diretamente na main. Esta etapa valida a máquina de teste e não autoriza produção.

Monte e execute a matriz final:
1. unitários de score 15/3/1/0, cutoff, standings por grupo, Tie, agregado, pênaltis, final única e gamificação;
2. contratos das APIs e SSE com seasonId/poolSeasonId;
3. integração PostgreSQL de migrations, constraints, imports, idempotência, outbox, correção e ranking;
4. testes de preservação/hash da Copa e Brasileirão;
5. componentes e E2E das quatro competições atuais;
6. timezone e remarcação;
7. provider offline, fallback CSV/manual e recovery;
8. load/performance, acessibilidade, segurança, backup/restore e shutdown;
9. migration rehearsal em cópia do banco de teste;
10. rollback de aplicação por flags sem rollback destrutivo de schema.

Carregue as três temporadas na máquina de teste com UI/write desativadas. Faça canário administrativo, reconcilie contagens com fontes oficiais e só então habilite read. Abra write apenas para um pool/usuário canário, faça palpites, atualize resultados de fixtures controladas, valide pontos/ranking/SSE e reverta as flags.

Produza docs/evidencia-expansao-copas-2026.md com comandos, resultados, contagens, checksums, screenshots ou referências de artefatos, P0/P1, riscos e decisão GO/NO-GO para continuar testes. Não declarar produção pronta se algum gate obrigatório estiver ausente.

Com todos os gates aprovados, commit `test: validar expansao das copas 2026` na main e push. Se houver falha, não commite uma declaração falsa de aprovação; registre o bloqueio somente se a documentação representar fielmente o estado.
```

Gate: canário da máquina de teste aprovado, zero P0/P1 e relatório de evidências completo. Produção continua intocada.

---

## Auditoria final antes da produção — somente leitura

Este prompt não autoriza commit, push, deploy, migration ou acesso à máquina de produção.

```text
Faça uma auditoria final somente leitura da expansão do Bolão Sirel para Copa do Brasil, Libertadores e Sul-Americana 2026.

Leia docs/PROMPTS_CODEX_EXPANSAO_COPAS_2026.md e docs/evidencia-expansao-copas-2026.md. Inspecione HEAD, histórico de commits, diffs, migrations, flags, providers, jobs, resultados de CI e artefatos de teste.

Entregue:
1. matriz Prompt 0–10 com commit e evidência;
2. comparação de hashes/contagens da Copa e Brasileirão;
3. estado de cada nova temporada e seu scoreableFrom;
4. confirmação de imports idempotentes e fontes oficiais;
5. resultado dos ensaios de backup, restore, migration e rollback por flags;
6. P0/P1/P2 residuais;
7. checklist manual para sincronização com a máquina de produção;
8. recomendação GO ou NO-GO fundamentada.

Não altere nada. Mesmo em GO, aguarde autorização específica para qualquer ação de produção.
```

## 7. Definition of Done global

- Copa do Mundo e Brasileirão preservados em dados, IDs, hashes e comportamento.
- Nenhuma regra ou provider escolhido por slug.
- Rotas e componentes genéricos para liga, grupos, mata-mata e formato híbrido.
- `Tie` representa jogo único, ida/volta, agregado, pênaltis e final.
- Libertadores, Sul-Americana e Copa do Brasil isoladas por season/pool.
- Imports oficiais auditáveis, reexecutáveis e com fallback.
- Histórico anterior ao corte visível, mas não pontuável.
- Regra `15/3/1/0` preservada e versionada.
- Ranking, SSE, conquistas, drafts e notificações isolados.
- Administração com dry-run, quarantine, override, auditoria e feature flags.
- Suítes, migration rehearsal, backup/restore, E2E e canário aprovados na máquina de teste.
- Nenhuma alteração de produção realizada por este plano.

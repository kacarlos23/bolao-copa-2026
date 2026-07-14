# Prompts sequenciais para o Codex — expansão do bolão para o Brasileirão 2026

## Objetivo

Executar, com segurança e rastreabilidade, a evolução do repositório
`kacarlos23/bolao-copa-2026` de um bolão específico da Copa do Mundo para uma
plataforma de múltiplas competições, entregando um **MVP funcional do
Brasileirão Série A 2026 antes da abertura da rodada de 16/07/2026**.

Conforme a referência visual fornecida, a Rodada 19 possui partidas a partir de
**16/07/2026 às 19:30, no horário de Brasília**. O objetivo operacional é deixar
a aplicação publicada e validada com antecedência suficiente para os
participantes enviarem seus palpites.

## Documentos obrigatórios

Antes de qualquer alteração, o Codex deve ler integralmente:

- `README.md`;
- `docs/PLANO DE EXPANSÃO`;
- `docs/Etapa 0 — Preservação do bolão da Copa`;
- `docs/Etapa 1 — Decisões arquiteturais e documentação`;
- `docs/Etapa 2 — Migração estrutural do banco`;
- `docs/Etapa 3 — Camada genérica de competições`;
- `docs/Etapa 4 — Abstração da fonte de dados`;
- `docs/Etapa 5 — Implementação do Brasileirão 2026`;
- `docs/Etapa 6 — Refatoração do frontend`;
- `docs/Etapa 7 — Regras de pontuação configuráveis`;
- `docs/Etapa 8 — Administração`;
- `docs/Etapa 9 — Testes obrigatórios`;
- `apps/api/prisma/schema.prisma`;
- os serviços atuais de palpites, ranking, mata-mata, sincronização e SSE;
- `apps/web/App.tsx`;
- `apps/web/src/api.ts`;
- todos os testes existentes relacionados a pontuação, ranking, palpites,
  sincronização e SSE.

---

# Regras gerais para todas as execuções

Estas regras devem ser repetidas ou consideradas vinculantes em todos os
prompts abaixo.

1. Trabalhe em uma branch exclusiva:

   ```text
   codex/multicompeticao-brasileirao-2026
   ```

2. Não altere diretamente a branch `main`.

3. Não reescreva o sistema do zero.

4. Não apague, recrie ou invalide dados existentes da Copa do Mundo 2026.

5. Não execute migração destrutiva antes do go-live do Brasileirão.

6. Use a estratégia **expand–migrate–contract**. Nesta entrega urgente,
   execute apenas **expand** e **migrate**. A fase **contract** ficará para
   depois da estabilização.

7. A Copa do Mundo 2026 deve continuar acessível e com o mesmo ranking,
   palpites, pontuações e mata-mata.

8. A regra vigente de pontuação deve permanecer:

   ```text
   15 pontos — placar exato
   3 pontos  — resultado correto
   1 ponto   — gols corretos de uma das equipes, com resultado incorreto
   0 ponto   — erro
   ```

9. Não introduza regras do tipo:

   ```ts
   if (competition === 'brasileirao') {
     // comportamento especial
   }
   ```

   O comportamento deve decorrer de `format`, `capabilities`, `stage`,
   `round`, `season` e configurações da temporada.

10. Toda consulta de partidas, palpites, pontuações, rankings e snapshots deve
    possuir escopo explícito de temporada.

11. Mantenha temporariamente as rotas antigas da Copa como aliases de
    compatibilidade.

12. O frontend nunca deve consultar diretamente GE, CBF, SofaScore ou qualquer
    provedor externo. Toda integração deve ocorrer no backend.

13. Não invente tabela, horário, resultado, escudo, ID externo ou critério de
    desempate. Use fonte verificada e registre a origem.

14. A importação deve ser idempotente.

15. Em caso de falha de teste, migração ou validação de dados, pare a execução,
    descreva o erro e não avance para a etapa seguinte.

16. Ao final de cada prompt:

    - informe arquivos criados e alterados;
    - informe decisões tomadas;
    - execute as validações exigidas;
    - apresente o resultado dos comandos;
    - registre riscos ou pendências;
    - faça um único commit, com a mensagem indicada;
    - não faça merge.

17. Não misture refatorações estéticas ou melhorias não essenciais com o escopo
    do prompt em execução.

18. Preserve o horário oficial da aplicação em `America/Sao_Paulo`.

19. Não exponha segredos, cookies, strings de conexão ou dados pessoais em
    logs, commits ou documentação.

20. O go-live deve ser controlado pela feature flag:

    ```text
    MULTI_COMPETITION_ENABLED
    ```

---

# Corte de escopo obrigatório para 16/07/2026

## Deve estar funcional antes da rodada

- Copa do Mundo 2026 preservada.
- Entidades de competição, temporada, fase e rodada.
- Temporada `brasileirao-serie-a-2026`.
- Vinte clubes cadastrados.
- Rodada 19 completa, com seus dez jogos e horários verificados.
- Preferencialmente as 38 rodadas importadas, desde que a fonte seja confiável.
- Partidas anteriores importadas apenas para classificação e histórico.
- Palpites abertos somente a partir da rodada definida no `PoolSeason`.
- Fechamento individual por partida.
- Classificação esportiva por pontos corridos.
- Ranking do bolão isolado por temporada.
- Ranking geral e por rodada.
- Seleção de competição no frontend.
- Escudos de clubes por meio de componente genérico.
- Sincronização ou atualização manual de contingência.
- Testes de regressão e procedimento de rollback.
- Feature flag desligada durante a preparação e ligada apenas no go-live.

## Deve ficar para depois da rodada

- Migração definitiva do mata-mata da Copa para uma estrutura única.
- Implementação completa de `Tie`.
- Copa do Brasil, Libertadores e Sul-Americana.
- Refatoração integral das mais de seis mil linhas de `App.tsx`.
- Ranking histórico de carreira.
- Gestão avançada de múltiplos pools pela interface.
- Premiações avançadas.
- Painel completo de divergências.
- Remoção de colunas e rotas antigas.
- Qualquer migração destrutiva.

---

# Protocolo de execução

Execute os prompts rigorosamente na ordem indicada. Cada prompt constitui um
checkpoint. Não agrupe vários prompts em um único commit.

---

## Prompt 00 — Auditoria somente leitura e plano de execução

```text
Atue como arquiteto e mantenedor principal do repositório
kacarlos23/bolao-copa-2026.

Nesta etapa, não altere nenhum arquivo.

Leia integralmente todos os documentos da pasta docs, com prioridade para o
PLANO DE EXPANSÃO e as Etapas 0 a 9. Inspecione o schema Prisma, as migrações
existentes, scripts de backup/restore, seeds, serviços de palpites, ranking,
mata-mata, sincronização GE, SSE, rotas da API, App.tsx, api.ts e testes.

Produza um relatório técnico em tela contendo:

1. estado atual da branch e commit-base;
2. mapa dos arquivos que serão afetados;
3. riscos de regressão da Copa do Mundo 2026;
4. relações e consultas que atualmente não possuem escopo de competição;
5. pontos de acoplamento da Copa no backend e frontend;
6. estratégia expand–migrate sem operações destrutivas;
7. plano de compatibilidade das rotas antigas;
8. plano de backfill dos dados atuais;
9. plano de rollback;
10. sequência exata de implementação;
11. comandos de validação disponíveis no package.json;
12. confirmação de que a entrega urgente não incluirá a migração genérica do
    mata-mata.

Não edite arquivos, não crie migrações e não faça commit.

Critério de aceite:
- relatório identifica todas as consultas globais de ranking, partidas,
  MatchDay, KnockoutFixture e RankingSnapshot;
- relatório identifica o risco do @@unique([date]) em MatchDay;
- relatório confirma a manutenção da pontuação 15/3/1/0;
- relatório indica como preservar IDs e dados atuais.
```

---

## Prompt 01 — Preservação, baseline e mecanismos de rollback

```text
Continue na branch codex/multicompeticao-brasileirao-2026.

Implemente somente a camada de preservação anterior à expansão.

Tarefas:

1. Verifique os scripts atuais de backup e restore.
2. Sem executar ações destrutivas, crie ou ajuste documentação e scripts para:
   - gerar backup completo do PostgreSQL;
   - validar o arquivo produzido;
   - restaurar em banco temporário de verificação;
   - registrar data, tamanho e checksum;
   - impedir que credenciais sejam commitadas.
3. Crie um script de snapshot lógico da Copa contendo, no mínimo:
   - quantidade de usuários ativos;
   - quantidade de partidas;
   - quantidade de palpites;
   - quantidade de pontuações;
   - quantidade de fixtures do mata-mata;
   - ranking final ou atual ordenado;
   - totais de pontos e acertos por usuário.
4. O snapshot deve ser determinístico e adequado à comparação antes/depois.
5. Crie testes ou verificações automatizadas para comparar dois snapshots.
6. Documente os comandos para criar a tag:
   world-cup-2026-final
   Não crie nem mova a tag automaticamente sem confirmação do operador.
7. Adicione MULTI_COMPETITION_ENABLED ao .env.example com valor padrão false.
8. Não altere ainda o schema de domínio.

Validações obrigatórias:
- npm run lint
- npm run test
- npm run build
- execução do snapshot em ambiente de teste, quando possível;
- verificação de que nenhum dado foi alterado.

Entregue:
- arquivos alterados;
- comandos exatos de backup, validação, restore e snapshot;
- riscos pendentes;
- confirmação de que o estado funcional da Copa não mudou.

Commit:
chore: add world cup preservation and rollback baseline
```

---

## Prompt 02 — Modelagem aditiva de competição e temporada

```text
Continue na mesma branch e parta do commit anterior.

Implemente uma migração Prisma estritamente aditiva para suportar múltiplas
competições, sem remover tabelas, colunas, índices ou rotas atuais.

Crie, com nomes e relações coerentes com os documentos:

- Competition;
- CompetitionSeason;
- Stage;
- Round;
- SeasonTeam;
- Pool;
- PoolMembership;
- PoolSeason;
- ProviderEntityMapping;
- ScoringRuleSet.

Adicione de forma inicialmente opcional, quando necessário:

- seasonId em MatchDay;
- seasonId, stageId e roundId em Match;
- seasonId em KnockoutFixture e estruturas relacionadas necessárias para
  preservar o escopo da Copa;
- seasonId, poolSeasonId e roundId em RankingSnapshot;
- poolSeasonId em Prediction e PredictionScore, se a modelagem final exigir;
- campos de tipo e escudo em Team, preservando os campos existentes;
- capabilities e metadata em competição/temporada;
- scoreableFromRound e historicalMatchesScoreable em PoolSeason;
- predictionClosesAt por partida, sem remover o comportamento antigo.

Requisitos:

1. Preserve o externalId atual de Team nesta fase. Não remova sua unicidade antes
   de existir backfill e cobertura suficiente.
2. Substitua a unicidade global de MatchDay por uma estratégia compatível com
   temporada, mas somente após garantir backfill na mesma migração ou em
   migração subsequente segura.
3. Use índices compostos para consultas frequentes por seasonId, roundId,
   status e startsAt.
4. Não torne imediatamente obrigatórias as novas FKs em tabelas legadas.
5. Gere SQL revisável e explique qualquer lock potencial.
6. Crie diagrama textual das relações no documento técnico.
7. Não altere ainda consultas de negócio.

Validações obrigatórias:
- prisma format;
- prisma validate;
- prisma generate;
- aplicação da migração em banco limpo;
- aplicação da migração em uma cópia do banco atual;
- npm run lint;
- npm run test;
- npm run build.

Pare imediatamente se a migração exigir apagar ou recriar dados.

Commit:
feat: add additive multi-competition database model
```

---

## Prompt 03 — Backfill da Copa e pool padrão

```text
Continue na mesma branch.

Implemente o backfill idempotente dos dados existentes da Copa do Mundo 2026.

Crie automaticamente, com IDs ou slugs estáveis:

Competition:
- slug: world-cup
- name: Copa do Mundo

CompetitionSeason:
- slug: world-cup-2026
- name: Copa do Mundo 2026
- status adequado para temporada encerrada ou em andamento, conforme os dados
  reais existentes

Pool:
- slug: bolao-do-trabalho
- nome compatível com o uso atual

PoolSeason:
- vínculo entre bolao-do-trabalho e world-cup-2026

Stage e Round:
- representar a estrutura existente sem mudar a lógica do mata-mata atual

Backfill obrigatório:

1. Vincule MatchDay, Match, KnockoutFixture, RankingSnapshot e registros
   relacionados à temporada world-cup-2026.
2. Vincule todos os usuários participantes ao pool padrão.
3. Vincule palpites e pontuações ao PoolSeason padrão, quando aplicável.
4. Cadastre as seleções atuais em SeasonTeam.
5. Crie ProviderEntityMapping para os IDs externos já conhecidos.
6. Crie o ScoringRuleSet vigente 15/3/1/0 e vincule-o à temporada/pool.
7. Preserve todos os IDs de User, Team, Match, Prediction e scores.
8. O script deve poder ser executado duas vezes sem duplicar ou alterar
   resultados.
9. Gere relatório de backfill com contagens antes/depois.
10. Compare o snapshot da Copa gerado no Prompt 01 antes e depois.

Não altere ainda o comportamento público da aplicação.

Validações obrigatórias:
- backfill em banco limpo com seed;
- backfill em cópia do banco atual;
- segunda execução idempotente;
- comparação dos snapshots;
- nenhum ponto, posição, palpite ou resultado pode mudar;
- npm run lint;
- npm run test;
- npm run build.

Commit:
feat: backfill world cup into default competition season
```

---

## Prompt 04 — Escopo obrigatório de temporada no backend

```text
Continue na mesma branch.

Implemente o escopo de competição/temporada nos serviços e rotas do backend,
preservando compatibilidade com a Copa.

Crie uma camada de contexto de temporada, sem espalhar leitura direta de slugs
por todos os serviços.

Rotas genéricas mínimas:

GET /api/competitions
GET /api/competitions/:competitionSlug/seasons
GET /api/seasons/:seasonId
GET /api/seasons/:seasonId/rounds
GET /api/seasons/:seasonId/matches
GET /api/seasons/:seasonId/standings
GET /api/pools/:poolSlug/seasons/:seasonId/ranking
GET /api/pools/:poolSlug/seasons/:seasonId/predictions
PUT /api/pools/:poolSlug/seasons/:seasonId/predictions

Requisitos:

1. Mantenha /api/match-days, /api/ranking, /api/cup e demais rotas antigas
   funcionando como aliases da temporada world-cup-2026.
2. Todas as consultas novas devem filtrar explicitamente por seasonId.
3. As rotas devem validar:
   - pertencimento da partida à temporada;
   - habilitação da temporada no pool;
   - vínculo do usuário ao pool;
   - prazo do palpite;
   - correspondência entre matchId, roundId e seasonId.
4. Uma partida de uma temporada nunca pode ser usada para salvar palpite em
   outra.
5. RankingSnapshot deve ser gerado por seasonId e poolSeasonId.
6. Chaves de AppSetting que variam por competição devem ser namespaced.
7. Eventos SSE devem transportar seasonId, poolSeasonId e IDs afetados.
8. O serviço da Copa e o mata-mata atual devem continuar operando.
9. Não implemente ainda o Brasileirão.
10. Não remova código legado nesta etapa.

Crie testes de autorização e isolamento suficientes para impedir vazamento
entre temporadas.

Validações obrigatórias:
- npm run lint;
- npm run test;
- npm run build;
- testes das rotas antigas;
- testes das rotas genéricas;
- snapshot da Copa inalterado.

Commit:
feat: scope api predictions and rankings by season
```

---

## Prompt 05 — Testes de isolamento e regressão da Copa

```text
Continue na mesma branch.

Não adicione novas funcionalidades. Fortaleça a cobertura de testes da
arquitetura criada.

Crie testes unitários e de integração para:

1. duas temporadas com partidas na mesma data;
2. MatchDay sem colisão entre temporadas;
3. ranking completamente isolado por seasonId;
4. snapshot isolado por seasonId e poolSeasonId;
5. palpite recusado quando o jogo pertence a outra temporada;
6. usuário sem vínculo ao pool recusado;
7. partida encerrada ou fora do prazo recusada;
8. SSE contendo seasonId e poolSeasonId;
9. AppSetting namespaced por temporada;
10. execução idempotente do backfill;
11. rota legada da Copa retornando exatamente o mesmo contexto anterior;
12. mata-mata da Copa ainda pontuando corretamente;
13. regra 15/3/1/0;
14. resultados ao vivo e finais;
15. ranking atual da Copa comparado ao snapshot baseline.

Não use mocks que ocultem erros de relação do Prisma quando for possível usar
um banco de teste real.

Ao final, apresente uma matriz de testes com:
- cenário;
- camada;
- arquivo de teste;
- resultado;
- risco coberto.

Validações obrigatórias:
- npm run lint;
- npm run test;
- npm run build.

Não avance se houver regressão da Copa.

Commit:
test: cover season isolation and world cup regression
```

---

## Prompt 06 — Fonte normalizada e importação do Brasileirão 2026

```text
Continue na mesma branch.

Implemente a carga do Brasileirão Série A 2026 por meio de uma camada de dados
normalizada e idempotente.

Crie:

Competition:
- slug: brasileirao-serie-a
- name: Brasileirão Série A
- format: LEAGUE
- supportsLeagueStandings: true
- supportsGroups: false
- supportsKnockoutBracket: false
- supportsTwoLeggedTies: false

CompetitionSeason:
- slug: brasileirao-serie-a-2026
- name: Brasileirão Série A 2026
- timezone: America/Sao_Paulo

Stage:
- Série A — pontos corridos
- tipo LEAGUE

Rounds:
- 1 a 38

SeasonTeams:
- os 20 clubes participantes de 2026

PoolSeason:
- pool bolao-do-trabalho
- startsAtRound: 19
- historicalMatchesScoreable: false
- regra 15/3/1/0

Fonte e importação:

1. Crie um formato normalizado JSON ou CSV versionado no repositório.
2. Registre no arquivo:
   - source;
   - sourceUrl;
   - retrievedAt;
   - season;
   - checksum ou versão;
   - timezone.
3. Use uma fonte pública verificável e adequada. Não invente dados.
4. Importe preferencialmente as 380 partidas.
5. Como gate mínimo de lançamento, a Rodada 19 deve conter exatamente dez jogos
   e todos os horários devem estar confirmados.
6. Use a referência visual apenas como conferência. Ela mostra, entre outros:
   - Botafogo x Santos em 16/07/2026 às 19:30;
   - Vitória x Vasco em 16/07/2026 às 19:30.
   Não trate a imagem parcial como fonte completa da rodada.
7. Partidas anteriores à rodada 19 devem ser importadas para histórico e
   classificação, mas não podem gerar palpites retroativos nem pontos no bolão.
8. Crie Team como CLUB, com code, shortName e crestUrl quando disponível.
9. Use ProviderEntityMapping para IDs externos.
10. Implemente importação idempotente:
    - atualização de horário não cria novo jogo;
    - adiamento não duplica partida;
    - mudança de status não altera identidade;
    - segunda execução produz zero duplicidades.
11. Crie um CsvProvider ou importador equivalente como contingência.
12. Se a fonte principal não estiver disponível, não invente a tabela:
    finalize a infraestrutura, gere o template de importação e informe
    precisamente quais dados ainda faltam.

Validações obrigatórias:
- 20 SeasonTeams;
- 38 Rounds;
- 380 Matches, quando a fonte completa estiver disponível;
- exatamente 10 jogos na Rodada 19;
- nenhuma duplicidade;
- horários convertidos corretamente para America/Sao_Paulo;
- duas execuções idempotentes;
- npm run lint;
- npm run test;
- npm run build.

Commit:
feat: import brasileirao 2026 season and fixtures
```

---

## Prompt 07 — Classificação esportiva por pontos corridos

```text
Continue na mesma branch.

Implemente o motor genérico de classificação para competições de formato LEAGUE.

A classificação deve ser calculada a partir dos resultados locais finalizados,
e não depender exclusivamente de uma tabela externa.

Calcule por clube:

- posição;
- jogos;
- vitórias;
- empates;
- derrotas;
- gols pró;
- gols contra;
- saldo de gols;
- pontos;
- últimos cinco resultados.

Requisitos:

1. Use somente partidas FINISHED para a classificação oficial.
2. Partidas LIVE podem alimentar uma classificação provisória separada, caso a
   interface já possua padrão equivalente, sem substituir a oficial.
3. Critérios de desempate devem ser configuráveis e baseados no regulamento
   oficial da temporada, com a fonte registrada na configuração.
4. Não codifique critérios em componentes de interface.
5. Crie serviço puro e testável em packages/shared ou módulo apropriado.
6. Exponha GET /api/seasons/:seasonId/standings.
7. A rota deve rejeitar ou retornar estrutura vazia adequada para temporadas
   sem suporte a classificação de liga.
8. Permita comparação opcional com classificação externa apenas para auditoria.
9. Não misture ranking dos clubes com ranking dos usuários.

Testes obrigatórios:
- vitória, empate e derrota;
- saldo e gols;
- partidas adiadas/canceladas ignoradas;
- desempates;
- rodada incompleta;
- alteração de resultado;
- isolamento entre temporadas;
- últimos cinco jogos;
- classificação com jogos históricos anteriores ao início do bolão.

Validações:
- npm run lint;
- npm run test;
- npm run build.

Commit:
feat: add generic league standings engine
```

---

## Prompt 08 — Palpites e ranking do Brasileirão

```text
Continue na mesma branch.

Implemente o fluxo de palpites e ranking do pool bolao-do-trabalho para a
temporada brasileirao-serie-a-2026.

Requisitos de palpites:

1. Palpites devem ser organizáveis por rodada e por data.
2. O fechamento deve ocorrer individualmente por partida.
3. Use a configuração vigente de minutos antes do jogo.
4. O participante vê apenas o próprio palpite antes do fechamento.
5. Após o fechamento, os palpites públicos seguem a regra atual do sistema.
6. Partidas anteriores a startsAtRound não aceitam palpites.
7. Partidas anteriores ou históricas não geram pontos.
8. Jogos adiados devem reabrir ou permanecer fechados conforme regra explícita
   e testada, sem perder o palpite existente.
9. Mudança de horário deve recalcular predictionClosesAt.
10. Administrador não participa, mantendo a regra atual.

Requisitos de ranking:

1. Ranking geral da temporada.
2. Ranking por rodada.
3. Filtro por período já existente, quando compatível.
4. Últimos cinco resultados do participante limitados à temporada selecionada.
5. Desempate mantendo a ordem atual:
   pontos, placares exatos, resultados, acertos de gols, menos erros e nickname.
6. Snapshot por seasonId, poolSeasonId e roundId quando aplicável.
7. SSE atualizando somente o contexto afetado.
8. Não somar Copa e Brasileirão.
9. Não alterar a pontuação 15/3/1/0.
10. Premiação de campeão da rodada pode ser calculada, mas não deve bloquear o
    lançamento se a UI de prêmios ainda não estiver pronta.

Testes obrigatórios:
- rodada 19 aceita palpites;
- rodada 18 é histórica e não pontua;
- ranking geral;
- ranking da rodada;
- isolamento da Copa;
- fechamento por partida;
- partida ao vivo;
- resultado final;
- adiamento e mudança de horário;
- SSE com contexto correto.

Validações:
- npm run lint;
- npm run test;
- npm run build;
- snapshot da Copa inalterado.

Commit:
feat: add brasileirao predictions and season rankings
```

---

## Prompt 09 — Frontend MVP de múltiplas competições

```text
Continue na mesma branch.

Implemente somente a refatoração mínima do frontend necessária ao lançamento do
Brasileirão. Não tente decompor integralmente App.tsx nesta etapa.

Crie, no mínimo:

- CompetitionContext;
- seletor de competição/temporada;
- TeamBadge genérico;
- tela ou seção de jogos por rodada;
- tela ou seção de classificação esportiva;
- ranking do bolão por temporada e por rodada;
- estado vazio e tratamento de erro;
- persistência da última competição selecionada, sem impedir fallback.

Navegação mínima do Brasileirão:

- Visão geral;
- Jogos e palpites;
- Classificação;
- Ranking do bolão.

Requisitos:

1. A Copa do Mundo 2026 deve permanecer selecionável e funcional.
2. O frontend deve obter capabilities da API.
3. Não use condicionais por slug para montar a navegação.
4. Substitua o conceito visual de bandeira por TeamBadge quando o tipo for CLUB,
   preservando bandeiras para NATIONAL_TEAM.
5. Não chame provedores externos no frontend.
6. Exiba rodada, data, horário e estado do palpite.
7. Exiba claramente quando o jogo está aberto, fechado, ao vivo, finalizado,
   adiado ou cancelado.
8. O formulário deve impedir envio depois do fechamento.
9. Atualizações SSE devem ignorar eventos de outra temporada.
10. Mantenha boa utilização em desktop e mobile.
11. Não realize redesign geral.
12. Mantenha a identidade atual e permita tema por competição somente onde já
    for simples e seguro.

Adicione testes de frontend mínimos para:
- troca de competição;
- isolamento das requisições;
- TeamBadge;
- rodada 19;
- classificação;
- ranking por rodada;
- erro de API;
- estado de carregamento;
- evento SSE de outra temporada ignorado.

Validações:
- npm run lint;
- npm run test;
- npm run build;
- teste manual em viewport desktop;
- teste manual em viewport mobile;
- Copa e Brasileirão navegáveis na mesma sessão.

Commit:
feat: add multi-competition frontend and brasileirao screens
```

---

## Prompt 10 — Sincronização, atualização manual e contingência

```text
Continue na mesma branch.

Extraia do sincronizador atual uma interface mínima de provider sem reescrever
toda a integração da Copa.

Crie o contrato CompetitionDataProvider com operações equivalentes a:

- syncTeams;
- syncSchedule;
- syncResults;
- syncStandings opcional;
- healthCheck.

Implemente:

1. adaptação do sincronizador atual da Copa sem mudar seu comportamento;
2. provider ou importador do Brasileirão;
3. CsvProvider ou ManualProvider como contingência;
4. ApiSyncLog com provider, competitionId, seasonId, tipo, início, fim e
   resultado;
5. reconciliação prioritária por ProviderEntityMapping;
6. fallback por nomes normalizados somente quando o ID externo não existir;
7. prevenção de regressão FINISHED para SCHEDULED;
8. atualização de predictionClosesAt quando startsAt mudar;
9. auditoria de correção manual;
10. lock para impedir duas sincronizações concorrentes da mesma temporada;
11. timeout, retry controlado e logs sem segredos;
12. endpoint administrativo para sincronizar a temporada selecionada;
13. endpoint administrativo para importar arquivo de contingência validado;
14. relatório de divergências sem alterar automaticamente dados ambíguos.

A sincronização do Brasileirão deve poder atualizar:
- horário;
- status;
- placar ao vivo;
- resultado final;
- adiamento;
- cancelamento.

Não dependa de scraping frágil como única forma de operação no dia da rodada.

Testes:
- importação idempotente;
- mudança de horário;
- adiamento;
- resultado final;
- regressão ignorada;
- mapeamento por ID;
- ambiguidade por nome;
- lock de concorrência;
- fallback CSV;
- isolamento entre temporadas.

Validações:
- npm run lint;
- npm run test;
- npm run build.

Commit:
feat: add competition data providers and brasileirao sync fallback
```

---

## Prompt 11 — Painel administrativo mínimo para o go-live

```text
Continue na mesma branch.

Implemente apenas os controles administrativos indispensáveis para operar o
Brasileirão na Rodada 19.

Funcionalidades:

1. selecionar competição e temporada;
2. visualizar equipes, rodadas e partidas importadas;
3. visualizar a contagem esperada e importada;
4. executar sincronização manual;
5. importar arquivo CSV/JSON de contingência;
6. corrigir horário, status e placar de uma partida;
7. informar justificativa obrigatória para correção manual;
8. visualizar o último ApiSyncLog;
9. habilitar ou desabilitar o PoolSeason;
10. definir startsAtRound;
11. visualizar predictionClosesAt;
12. suspender palpites de uma partida em emergência;
13. recalcular pontuações de uma partida;
14. recalcular ranking da temporada;
15. visualizar divergências ou dados incompletos.

Requisitos:

- todas as ações devem exigir ADMIN;
- todas as alterações devem gerar AdminAuditLog;
- a interface deve destacar ações que mudam pontuação;
- não permita editar partidas de outra temporada por engano;
- não implemente ainda o painel administrativo completo descrito na Etapa 8;
- preserve os controles administrativos da Copa.

Testes:
- permissão;
- auditoria;
- temporada incorreta;
- recálculo;
- suspensão;
- importação;
- correção manual.

Validações:
- npm run lint;
- npm run test;
- npm run build.

Commit:
feat: add minimum brasileirao operations admin panel
```

---

## Prompt 12 — Auditoria final, testes end-to-end e ensaio de migração

```text
Continue na mesma branch.

Nesta etapa, não adicione novas funcionalidades. Faça uma auditoria completa da
entrega.

Execute um ensaio em ambiente isolado:

1. restaure uma cópia do banco atual;
2. gere snapshot baseline da Copa;
3. aplique todas as migrações;
4. execute o backfill;
5. importe o Brasileirão;
6. execute a sincronização;
7. gere snapshot pós-migração;
8. compare a Copa;
9. execute os fluxos do Brasileirão;
10. restaure novamente para provar o rollback.

Cenários end-to-end obrigatórios:

- login de usuário existente;
- Copa do Mundo acessível;
- ranking da Copa inalterado;
- seleção do Brasileirão;
- visualização da Rodada 19 completa;
- envio de palpite;
- edição antes do fechamento;
- bloqueio depois do fechamento;
- publicação dos palpites;
- atualização de placar ao vivo;
- finalização da partida;
- cálculo 15/3/1/0;
- ranking geral;
- ranking da rodada;
- classificação dos clubes;
- mudança de horário;
- adiamento;
- usuário sem vínculo;
- administrador;
- SSE;
- mobile;
- desktop;
- reinício da API;
- indisponibilidade do provider com uso do cache local;
- importação de contingência.

Verificações de dados:

- 20 clubes;
- 38 rodadas;
- 10 partidas na Rodada 19;
- ausência de duplicidades;
- nenhuma partida sem seasonId;
- nenhum snapshot novo sem seasonId;
- nenhum vazamento de ranking;
- nenhum segredo em logs;
- índices usados nas consultas críticas;
- tempo de resposta aceitável para o volume atual.

Produza:
- relatório de testes;
- relatório de migração;
- relatório de rollback;
- lista de bloqueadores;
- checklist de go-live;
- lista de itens postergados.

Não considere a etapa aprovada se qualquer teste de regressão da Copa falhar.

Commit:
test: validate multi-competition rollout and rollback
```

---

## Prompt 13 — Preparação de release e feature flag

```text
Continue na mesma branch.

Prepare a release candidata, sem ligar a feature flag em produção
automaticamente.

Tarefas:

1. Atualize README e documentação operacional.
2. Crie RELEASE_CHECKLIST_BRASILEIRAO_2026.md.
3. Documente:
   - backup;
   - snapshot;
   - migração;
   - backfill;
   - importação;
   - smoke tests;
   - ativação da feature flag;
   - desativação;
   - rollback;
   - contatos e responsabilidades operacionais;
   - logs a monitorar.
4. Defina versão e notas de release.
5. Liste variáveis de ambiente novas.
6. Garanta que MULTI_COMPETITION_ENABLED permaneça false por padrão.
7. Gere comandos exatos de implantação, sem incluir segredos.
8. Faça uma última execução:
   - npm run lint;
   - npm run test;
   - npm run build;
   - prisma validate;
   - prisma generate.
9. Compare o snapshot da Copa.
10. Valide que a Rodada 19 contém os dez jogos.
11. Abra ou prepare o texto de um pull request, contendo:
    - resumo;
    - arquitetura;
    - migrações;
    - testes;
    - riscos;
    - rollback;
    - escopo postergado.
12. Não faça merge automático.
13. Não ative a feature flag.

Commit:
docs: prepare brasileirao 2026 release checklist
```

---

## Prompt 14 — Revisão independente do pull request

```text
Atue agora como revisor independente. Não implemente funcionalidades novas.

Revise todo o diff da branch codex/multicompeticao-brasileirao-2026 contra
main.

Procure especificamente:

1. consultas sem seasonId;
2. queries de ranking global;
3. snapshots sem poolSeasonId;
4. MatchDay ainda global por data;
5. risco de exclusão ou recriação de dados;
6. regressão do mata-mata da Copa;
7. alteração involuntária da regra 15/3/1/0;
8. fechamento de palpite baseado no dia em vez da partida;
9. eventos SSE sem contexto;
10. condicionais por slug;
11. chamadas externas no frontend;
12. importação não idempotente;
13. identificação de jogo baseada apenas em nome;
14. partidas históricas gerando pontos;
15. ausência de auditoria administrativa;
16. migrações com lock ou downtime excessivo;
17. credenciais ou dados sensíveis;
18. ausência de fallback;
19. escudos quebrados;
20. problemas em mobile;
21. falta dos dez jogos da Rodada 19;
22. timezone incorreto;
23. rotas legadas quebradas.

Classifique os achados em:
- bloqueador;
- alto;
- médio;
- baixo.

Para cada achado, informe arquivo, linha, impacto e correção recomendada.

Não aprove o PR se houver qualquer bloqueador ou risco alto de perda de dados.
Não altere arquivos nesta execução.
```

---

## Prompt 15 — Correção dos achados da revisão

```text
Continue na branch codex/multicompeticao-brasileirao-2026.

Leia integralmente a revisão independente do prompt anterior.

Corrija somente achados classificados como bloqueador, alto ou médio que afetem:

- integridade de dados;
- segurança;
- regressão da Copa;
- escopo de temporada;
- palpites;
- pontuação;
- ranking;
- classificação;
- sincronização;
- Rodada 19;
- operação do go-live.

Para cada correção:

1. crie ou ajuste teste que reproduza o problema;
2. faça a menor alteração possível;
3. não introduza novas funcionalidades;
4. execute lint, testes e build;
5. gere novamente os snapshots;
6. atualize o checklist de release.

Faça um único commit:

fix: resolve pre-release multi-competition blockers
```

---

## Prompt 16 — Checklist operacional de go-live

```text
Não faça alterações de código nesta etapa.

Gere um roteiro operacional numerado para o responsável pela implantação,
considerando que a primeira partida da rodada está prevista para
16/07/2026 às 19:30 no horário de Brasília.

O roteiro deve conter:

1. congelamento de alterações;
2. verificação do commit e PR aprovados;
3. backup;
4. checksum;
5. snapshot da Copa;
6. migrações;
7. backfill;
8. importação e conferência da Rodada 19;
9. inicialização da aplicação com feature flag false;
10. smoke tests da Copa;
11. smoke tests do Brasileirão;
12. conferência dos dez jogos;
13. conferência dos horários e predictionClosesAt;
14. teste com usuário comum;
15. teste com administrador;
16. teste mobile;
17. teste SSE;
18. ativação de MULTI_COMPETITION_ENABLED;
19. nova rodada de smoke tests;
20. monitoramento de logs;
21. janela e critérios de rollback;
22. procedimento de desativação da feature;
23. comunicação aos participantes.

Defina como meta operacional:
- release candidata concluída até 15/07/2026;
- implantação e smoke tests finais com ampla antecedência;
- nenhuma alteração estrutural de última hora perto do início da rodada.

Inclua campos para registrar:
- horário de cada ação;
- responsável;
- resultado;
- evidência;
- decisão de prosseguir ou reverter.
```

---

# Gate final de aceite

A expansão somente poderá ser considerada pronta quando todos os itens abaixo
estiverem confirmados:

- [ ] Backup criado e restaurado em ambiente de teste.
- [ ] Snapshot da Copa antes e depois idêntico.
- [ ] Copa do Mundo 2026 acessível.
- [ ] Ranking da Copa inalterado.
- [ ] Mata-mata da Copa funcional.
- [ ] Feature flag presente e desligada por padrão.
- [ ] Competition e CompetitionSeason criados.
- [ ] Todas as partidas possuem escopo de temporada.
- [ ] Pool e PoolSeason padrão criados.
- [ ] Brasileirão Série A 2026 criado.
- [ ] Vinte clubes cadastrados.
- [ ] Trinta e oito rodadas cadastradas.
- [ ] Rodada 19 com exatamente dez jogos.
- [ ] Horários conferidos em fonte verificada.
- [ ] Partidas históricas não geram pontos.
- [ ] Palpites fecham individualmente por partida.
- [ ] Regra 15/3/1/0 preservada.
- [ ] Ranking geral isolado.
- [ ] Ranking por rodada funcional.
- [ ] Classificação esportiva funcional.
- [ ] SSE isolado por temporada.
- [ ] Importação idempotente.
- [ ] Fallback CSV/manual funcional.
- [ ] Painel administrativo mínimo funcional.
- [ ] Testes, lint e build aprovados.
- [ ] Migração ensaiada em cópia do banco.
- [ ] Rollback ensaiado.
- [ ] PR revisado sem bloqueadores.
- [ ] Checklist de go-live preenchido.
- [ ] Feature flag ativada somente após smoke tests.

---

# Plano de contingência para o dia da rodada

Caso a sincronização automática não esteja estável, a aplicação poderá entrar em
produção somente se:

1. os dez jogos da Rodada 19 estiverem cadastrados e conferidos;
2. os palpites estiverem funcionando;
3. os horários e fechamentos estiverem corretos;
4. houver atualização manual auditada de placares;
5. o ranking puder ser recalculado manualmente;
6. a Copa permanecer preservada;
7. houver backup e rollback testados.

Não adie a proteção dos dados para priorizar automação. No corte de lançamento,
uma atualização manual segura e auditável é preferível a um scraper instável.

---

# Escopo posterior ao go-live

Após a estabilização do Brasileirão:

1. concluir a refatoração modular do frontend;
2. remover gradualmente aliases legados;
3. tornar FKs novas obrigatórias;
4. executar a etapa contract das migrações;
5. unificar o mata-mata;
6. criar Tie e partidas de ida/volta;
7. implementar Copa do Brasil;
8. implementar Libertadores;
9. implementar Sul-Americana;
10. criar ranking histórico e múltiplos pools;
11. ampliar testes automatizados do frontend;
12. melhorar observabilidade, métricas e alertas.

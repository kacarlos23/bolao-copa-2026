# Auditoria do frontend — redesign do Bolão Sirel

Data da auditoria: 27/07/2026

Repositório: `kacarlos23/bolao-copa-2026`

Baseline: `9996ba2` (`main`, alinhada a `origin/main`)

## Resumo executivo

O frontend é uma aplicação Expo/React Native Web com navegação web própria sobre o Expo
Router. A arquitetura nova, orientada a competição e `capabilities`, convive com telas legadas
mantidas por feature flags. O redesign deve atuar primeiro no shell e nos componentes do caminho
roteado atual, mantendo os aliases e as telas legadas funcionais até que a paridade permita sua
remoção em outro escopo.

Não é necessária alteração de backend, contrato de API, regra de pontuação, autenticação ou
permissão para executar o redesign. A estratégia aprovada é consolidar tokens e primitivas sobre
`StyleSheet`, reaproveitar os componentes existentes e reorganizar somente os dados que já chegam
da API.

### Tese visual

Um estádio digital noturno: azul-marinho profundo, superfícies precisas, tipografia de alta
legibilidade e verde-limão usado como sinal de ação e estado, com energia esportiva contida.

### Plano de conteúdo

1. shell compacto com contexto, navegação e conta;
2. contexto da competição/temporada;
3. superfície operacional da rota atual;
4. ações e estados reais, sem módulos promocionais ou métricas inventadas.

### Tese de interação

- transição curta de entrada ao trocar de rota;
- realce de navegação e mudança de estado por cor, borda e posição;
- feedback de pressão/hover/foco e expansão progressiva dos módulos administrativos;
- todas as transições respeitam `prefers-reduced-motion`.

## Stack e dependências de interface

| Item | Implementação encontrada |
| --- | --- |
| Framework | Expo `54.0.25` |
| UI runtime | React `19.1.0`, React Native `0.81.5`, React Native Web `0.21.0` |
| Navegação base | Expo Router `6.0.24`; uma rota física principal delega para o roteador interno |
| Estilos | `StyleSheet` predominante; NativeWind `4.2.1`/Tailwind `3.4.18` ainda disponível em componentes legados |
| Ícones | `@expo/vector-icons` `15.0.3`, principalmente `Ionicons` |
| Movimento | `Animated`, GSAP `3.15.0` e abstrações em `src/motion.tsx` |
| Testes de componente | Vitest `4.1.10`, Testing Library React |
| Testes de jornada | Playwright `1.61.1` com axe |
| Contratos | Tipos e schemas de `@bolao/shared` |
| PWA/web | export estático do Expo, favicon e metadados em `app.json`/`app/+html.tsx` |

Não há justificativa técnica para adicionar outra biblioteca de componentes ou de ícones.

## Estratégia de estilos atual

- `apps/web/src/theme/tokens.ts` contém cores, raios, espaços, alvo de toque e durações.
- `apps/web/global.css` fornece skip link, foco visível, alvo mínimo, scrollbars e redução de
  movimento.
- `StyleSheet.create` é usado no shell e nas features ativas.
- `apps/web/src/ui.tsx` e a configuração NativeWind permanecem como camada legada, mas não são a
  principal fonte visual do caminho roteado.
- `apps/web/App.tsx` ainda mantém um segundo conjunto grande de cores e estilos para experiências
  legadas.

Problemas encontrados:

- tokens incompletos para tipografia, elevação, estados e breakpoints;
- cores equivalentes repetidas em arquivos de feature;
- raios e alturas definidos localmente;
- breakpoints dispersos em `560`, `650`, `760/768`, `820`, `850`, `900`, `980`, `1180` e
  `1320` px;
- duas linguagens visuais coexistentes entre o shell atual e as telas legadas.

## Navegação e rotas reais

O Expo Router expõe a entrada física em `apps/web/app/index.tsx`. Em web, o roteamento funcional é
interpretado por `src/navigation/routes.ts` e sincronizado com `window.history` em `App.tsx`.

### Rotas globais

| URL | Tela | Componente principal |
| --- | --- | --- |
| `/` | Início | `features/home/HomeScreen.tsx` |
| `/competicoes` | Central de competições | `features/competitions/CompetitionHub.tsx` |
| `/admin` | Administração, somente `ADMIN` | `adminOperations.tsx` |

Rotas inválidas são tratadas como `not-found` e renderizam `RouteState`.

### Rotas por competição

Base: `/competicoes/:competitionSlug`

| Segmento | Seção | Componente/caminho |
| --- | --- | --- |
| sem segmento | visão geral | `SeasonWorkspace` ou workspace legado da Copa |
| `/jogos` | jogos | `SeasonWorkspace`, `DaysScreen` no legado |
| `/palpites` | palpites | `SeasonWorkspace`, `PredictionsScreen` no legado |
| `/classificacao` | classificação esportiva | `SeasonWorkspace` |
| `/chave` e alias `/eliminatorias` | mata-mata | `SeasonWorkspace`/`PredictionBoardScreen` |
| `/ranking` | ranking do bolão | `PremiumRanking` ou ranking legado |
| `/times` | diretório de times | `CompetitionTeams` ou catálogo legado |
| `/times/:teamId/atletas` | atletas do time | `CompetitionTeamProfile` |
| `/times/:teamId/partidas` | histórico de partidas | `CompetitionTeamProfile` |
| `/times/:teamId/estatisticas` | estatísticas do time | `CompetitionTeamProfile` |

A subnavegação é derivada das `capabilities` da competição/temporada. Se uma seção não for
oferecida, a aplicação mostra um estado de indisponibilidade em vez de renderizar uma rota vazia.

### Aliases legados preservados

As telas internas `days`, `predictions`, `knockout`, `ranking`, `cup`, `teams` e `brasileirao`
continuam mapeadas para rotas por competição. Os aliases históricos de slug são resolvidos por
`src/navigation/legacy-route-aliases.ts`.

## Telas públicas realmente existentes

1. autenticação: login e cadastro;
2. início autenticado;
3. central/seletor de competições;
4. visão geral de competição;
5. calendário/jogos;
6. palpites por data e, no legado da Copa, palpites diários;
7. classificação esportiva;
8. chave/mata-mata quando a competição suporta;
9. ranking geral e escopos habilitados pela competição;
10. diretório de times;
11. perfil do time: atletas, partidas e estatísticas;
12. menu de conta: foto, remoção de foto, administração para `ADMIN` e logout;
13. estados de rota inexistente, competição inexistente, seção indisponível e UI desabilitada.

Não existe rota de perfil pessoal completa. A referência de perfil deve ser aplicada somente ao
menu de conta, avatar e informações reais já expostas no ranking/engagement; não será criada uma
nova rota nem um backend de perfil.

## Componentes compartilhados relevantes

| Componente | Responsabilidade |
| --- | --- |
| `AppShell` | fundo, status bar e skip link |
| `AppHeader` | marca, atualização, navegação principal e conta |
| `RoutedWorkspace` | composição do shell, subnav, scroll e lazy loading |
| `CompetitionSubnav` | seções habilitadas, temporada e troca de competição |
| `CompetitionContext` | competição, temporada, capabilities, flags de UI e seleção persistida |
| `AsyncState` | loading, skeleton, vazio, erro, offline e refreshing |
| `RouteState` | erros e indisponibilidades no nível de rota |
| `Toast` | feedback não bloqueante |
| `UnsavedChangesModal` | proteção de navegação com draft sujo |
| `ScoreInput` | entrada numérica acessível de placar |
| `TeamBadge` | bandeira/escudo com fallback |
| `RankingTable` / `PremiumRanking` | ranking responsivo e contexto do usuário |
| `CompetitionHero` | identidade e estado da competição |
| `MatchPredictionCard` | jogo, disponibilidade, placar, save e descarte |
| `StageSelector` / `RoundSelector` | filtros por fase e rodada |
| `PublicPredictionsModal` | palpites públicos após fechamento |

## Estado, dados e atualização

### Estado global/compartilhado

- `CompetitionContext` guarda competições, temporadas, seleção, capabilities, flag de UI,
  loading e erro.
- `App.tsx` guarda autenticação, rota atual, slug/time selecionado, refresh global, posição do
  scroll e proteção de navegação.
- `ToastProvider` fornece feedback global.
- Não há Redux, Zustand ou outro store externo.

### Estado de feature

- `SeasonWorkspace` concentra rodada, fase, partidas, palpites, ranking, regras, engagement,
  awards, arrecadação, status SSE e drafts.
- `draftReducer` diferencia `clean`, `dirty`, `saving`, `saved` e `failed`, persiste por
  usuário/pool/temporada e preserva edição local contra polling/SSE.
- `LatestRequest` e IDs de request descartam respostas obsoletas.
- `RealtimeClient` mantém status `live`, `reconnecting` e `offline`.

### APIs usadas pelo redesign

O frontend usa exclusivamente a API própria em `src/api.ts`/`src/services/api-client.ts`.
Chamadas relevantes incluem:

- autenticação, upload/reset de avatar e logout;
- competições, temporadas, rodadas, partidas, standings, ties e times;
- regras, palpites, ranking, awards, engagement, fundraising e status de sync;
- atualização manual autenticada;
- endpoints administrativos de overview, divergências, jobs, audit, health, refresh, placar,
  reprocessamento e arrecadação.

O cliente mantém cookies, CSRF, timeout, cancelamento, validação de schema e mensagens por status.
Nenhum endpoint novo é necessário.

## Regras e fluxos que não podem mudar

- fechamento do palpite por `predictionClosesAt` ou fallback existente;
- bloqueios por status da partida e política histórica da temporada;
- score e desempates calculados no backend por rule set versionado;
- dirty tracking, merge, persistência, descarte e confirmação de saída;
- idempotência e agrupamento de saves por `matchDayId`;
- divulgação de palpites públicos somente após o prazo;
- filtros por capabilities, temporada, fase e rodada;
- horário no timezone da temporada;
- autenticação por sessão, CSRF, papel `ADMIN` e membership separada;
- feature flags de leitura, escrita, UI e sincronização;
- SSE/polling sem sobrescrever rascunhos;
- operações administrativas com justificativa, preview, confirmação, escopo, versão e auditoria.

## Módulos administrativos realmente existentes

Fonte principal: `apps/web/src/adminOperations.tsx`.

1. carregamento de overview por temporada;
2. seleção de temporada;
3. seleção do bolão vinculado à temporada;
4. resumo de temporadas/rodadas;
5. histórico de import/sync;
6. mappings e quarantine;
7. overrides de partida;
8. rule set fixado;
9. informações operacionais de usuários;
10. contagem de auditoria;
11. saúde do sistema;
12. `FundraisingAdmin`: valor atual, estimativa real, justificativa, preview, código de
    confirmação e aplicação;
13. atualização/reconciliação da competição: providers, prioridade, cadence, timeout, source,
    scheduler, flags, justificativa, relatório, evidências, warnings e checksums;
14. placar manual: partida priorizada por data, placar, status `LIVE`/`FINISHED`, justificativa e
    recálculo;
15. reprocessamento versionado: justificativa, dry-run, impacto, expiração, código e aplicação;
16. jobs: pausa para `QUEUED`/`RUNNING`, retomada para `PAUSED` e retry para `FAILED`;
17. mensagens de sucesso, erro, loading e ausência de dados.

O painel não possui dashboard analítico, CRUDs separados, menus extras nem métricas históricas
para reproduzir a referência desktop.

## Mapeamento das referências

| Referência | Aplicação real | Adaptação permitida |
| --- | --- | --- |
| `01_inicio` desktop/mobile | `/`, `HomeScreen` | contexto atual, CTA de palpites, competições e atalhos reais |
| `02_jogos_competicoes` | `/competicoes` e `/:slug/jogos` | seletor real, fase/rodada, partidas e status reais |
| `03_palpites` | `/:slug/palpites` | agenda, `MatchPredictionCard`, estados do draft e save existente |
| `04_ranking` | `/:slug/ranking` | escopos habilitados, podium/tabela reais, destaque do usuário |
| `05_perfil` | menu de conta + dados já presentes no ranking/engagement | avatar, papel, preferências e logout; sem rota nova |
| `06_admin` desktop | `/admin` | sobriedade, hierarquia, grid e separação dos módulos reais |
| `06_admin` mobile | `/admin` | empilhamento, seções progressivas e ações perigosas preservadas |

## Elementos das imagens que não existem ou não podem ser copiados

- ligas privadas/públicas e ranking de amigos;
- tiers, divisões, nível Ouro/Prata/Diamante e XP;
- confiança do palpite, tendência e pontuação estimada;
- favoritos e lembretes de times/jogos;
- desafios, missões e recomendações automáticas;
- medalhas/troféus que não sejam awards reais retornados pela API;
- perfil pessoal completo, clube do coração e edição de preferências inexistentes;
- dashboard administrativo com competições ativas, total global de usuários/palpites, gráficos,
  CRUDs ou atividade recente não retornada pela API;
- qualquer número, nome de participante, posição ou placar ilustrativo.

As conquistas, streaks, awards, notificações e arrecadação já existentes podem ser exibidos, mas
somente com os dados e estados retornados pelo backend.

## Estratégia responsiva

- tokenizar os breakpoints em `compact: 768`, `content: 1024` e `wide: 1280`, mantendo
  breakpoints especializados somente quando a visualização exige;
- conteúdo principal com largura máxima de 1280 px e gutters fluidos;
- cabeçalho desktop em uma linha e navegação pública inferior no mobile, limitada às quatro rotas
  reais;
- reservar padding inferior com safe area para que a barra móvel não cubra botões/inputs;
- competição e temporada em uma subnav horizontal rolável somente quando necessário;
- tabelas viram listas com colunas essenciais em mobile; tabelas esportivas largas mantêm scroll
  local, nunca overflow da página;
- jogos e palpites passam de colunas para pilha abaixo de 768 px;
- admin usa grid no desktop e módulos empilhados/progressivos no mobile, sem esconder
  confirmações perigosas.

Larguras de aceite: 320, 375, 768, 1024, 1366 e 1920 px.

## Acessibilidade

- preservar skip link, `lang=pt-BR`, foco visível e alvo mínimo de 44 px;
- manter roles, labels, `aria-current`, `aria-checked`, live regions e estados disabled/expanded;
- não comunicar status somente por cor;
- manter ordem DOM coerente em desktop e mobile;
- contraste mínimo WCAG AA para texto e controles;
- respeitar `prefers-reduced-motion`;
- garantir fallback textual para imagens, escudos e avatares.

## Testes e comandos identificados

Scripts de repositório:

- `npm run test:web`
- `npm run test:e2e`
- `npm run lint`
- `npm run build`
- `npm test`

Não existe script `typecheck` no `package.json` da baseline. A verificação TypeScript do web pode
ser feita diretamente pelo compilador instalado com
`npm exec tsc -- --noEmit -p apps/web/tsconfig.json`; os builds de API/shared também executam
`tsc`. A fase de fundação deve adicionar scripts explícitos de typecheck, sem alterar o runtime.

Testes web existentes cobrem navegação, rotas, contexto, capabilities, drafts, score inputs,
modal de alterações não salvas, ranking, competição, fundraising, contratos e cliente de API.
Os E2E cobrem fluxos críticos, responsividade, teclado, axe e perfis de time.

### Resultado da baseline

| Verificação | Resultado |
| --- | --- |
| `npm test` | PASS — 385 testes: 25 preservação, 29 shared, 242 API e 89 web |
| typecheck shared | PASS |
| typecheck API | PASS |
| typecheck web direto | FAIL pré-existente — 99 erros em 19 arquivos |
| `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:budget` | PASS, com apenas 24.251 bytes (~1%) de margem no JavaScript |
| `npm run test:e2e` | FAIL pré-existente — 58/60; seletor “Gerar prévia” ambíguo no mesmo caso desktop/mobile |

As falhas de typecheck se concentram em propriedades web não declaradas nos tipos React Native,
spreads tipados como `never`, tipos Node ausentes, contratos opcionais e alguns erros reais do
caminho legado. O E2E falha antes de testar a operação porque há dois botões com o mesmo nome
acessível; a ação administrativa não apresentou falha funcional nessa baseline.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| coexistência V1/V2 e `App.tsx` monolítico | alterar fronteiras compartilhadas primeiro; manter flags e aliases |
| regressão de draft por reorganização de markup | não mover regras/reducer; manter testes e E2E de save/bloqueio |
| seções variam por capabilities | gerar menus somente com `competitionSectionEnabled` |
| CSS web em objetos RN | validar export Expo e navegador, não somente typecheck |
| overflow em rankings/chaves/tabelas | scroll local e teste em 320/375 px |
| admin contém ações de alto impacto | preservar handlers, payloads, idempotência, preview e confirmação |
| cor de destaque muito clara | usar texto escuro sobre accent e checar contraste/foco |
| menu de conta absoluto | validar z-index, teclado, mobile e fechamento após ação |
| pacote visual está não versionado na baseline | tratá-lo como entrada do usuário; não remover ou sobrescrever |
| ausência de script typecheck | criar script explícito e executá-lo a cada fase seguinte |

## Plano de alteração por arquivo

### Fase 1 — fundação

- `src/theme/tokens.ts`: consolidar paleta, tipografia, espaços, raios, sombras, estados e
  breakpoints.
- `global.css`: fundo web, seleção, foco, hover suportado e reduced motion.
- `src/components/DesignSystem.tsx`: primitivas realmente repetidas de superfície, cabeçalho,
  chip, botão e container.
- `src/components/AsyncState.tsx`, `RouteState.tsx`, `ScoreInput.tsx`, `Toast.tsx`,
  `UnsavedChangesModal.tsx`: alinhar estados e acessibilidade aos tokens.
- `package.json` e workspaces: scripts explícitos de typecheck.

### Fase 2 — shell

- `src/app/AppShell.tsx`: novo fundo sóbrio.
- `src/app/AppHeader.tsx`: header desktop compacto e barra pública inferior mobile.
- `src/app/RoutedWorkspace.tsx`: gutters, safe area e largura.
- `src/app/CompetitionSubnav.tsx`: contexto e abas reais com estado ativo.
- testes de navegação do shell.

### Fase 3 — início

- `src/features/home/HomeScreen.tsx`: reorganizar contexto e atalhos com informação real.
- testes de loading, vazio e navegação.

### Fases 4 e 5 — jogos e palpites

- `src/features/competitions/CompetitionHub.tsx` e `CompetitionSelector.tsx`: seleção clara.
- `src/features/competitions/SeasonWorkspace.tsx`: hierarquia, filtros, agenda e responsividade.
- `src/features/competitions/CompetitionExperience.tsx`: hero operacional, linhas de jogos e
  cartões de palpite.
- `src/components/ScoreInput.tsx`: estados e entrada móvel, sem mudar validação.
- testes de competição, draft, save, status e disponibilidade.

### Fase 6 — ranking e conta

- `src/features/rankings/PremiumRanking.tsx` e `components/RankingTable.tsx`: tabela/lista,
  escopos e destaque do usuário.
- `src/app/AppHeader.tsx`: acabamento do menu de conta existente.
- testes de ordenação, escopos, movimento e menu.

### Fase 7 — administração

- `src/adminOperations.tsx`: reorganizar os mesmos módulos, seletores, estados e ações.
- `src/features/admin/FundraisingAdmin.tsx`: aplicar tokens sem mudar o fluxo de preview/apply.
- `src/adminOperations.logic.test.ts` e `FundraisingAdmin.test.tsx`: preservar prioridade,
  confirmação e payloads.

### Fases 8 e 9 — acabamento e entrega

- `src/motion.tsx` e componentes alterados: transições curtas e reduced motion.
- `e2e/critical-flows.spec.ts`: ampliar assertivas de navegação/layout sem acoplar a pixels.
- `docs/redesign/relatorio-final.md`: matriz de fases, arquivos, regressões, comandos e descartes.
- `docs/redesign/screenshots/`: capturas desktop/mobile do build validado.

## Critérios de aceite

- zero mudança em endpoints, payloads, regras de pontuação ou permissões;
- rotas e aliases existentes continuam navegáveis;
- drafts e confirmação de saída permanecem corretos;
- estados loading, vazio, erro, offline, salvo e bloqueado são legíveis;
- navegação pública funciona por teclado e leitor de tela;
- admin mantém justificativa, preview, confirmação, idempotência e ações condicionais;
- nenhuma feature ou métrica fictícia;
- sem overflow horizontal global em 320 px;
- foco e contraste adequados;
- testes aplicáveis, typecheck, lint e build verdes;
- screenshots finais em desktop e mobile.

## Itens expressamente excluídos

- mudanças de backend, banco, API ou scoring;
- nova biblioteca de UI/ícones;
- nova rota de perfil pessoal;
- novas ligas, tiers, confiança, favoritos, lembretes, missões, XP ou gráficos;
- remoção das experiências legadas/flags;
- push, merge, deploy ou publicação;
- dados mockados na aplicação final.

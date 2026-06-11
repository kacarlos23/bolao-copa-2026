# Plano do Bolao da Copa do Mundo 2026

## Objetivo

Criar um sistema de bolao para a Copa do Mundo 2026, voltado inicialmente para pessoas do trabalho. O sistema deve permitir cadastro, login, envio de palpites por dia de jogos, exibicao publica dos palpites apos o fechamento, ranking ao vivo e administracao completa.

## Escopo

### Incluido

- Cadastro aberto de participantes.
- Login com nome de usuario e senha.
- Nickname publico personalizavel.
- Palpites por dia de jogos.
- Fechamento dos palpites 30 minutos antes do primeiro jogo do dia.
- Exibicao dos palpites de todos apos o fechamento do bloco diario.
- Ranking geral com pontuacao provisoria durante jogos ao vivo.
- Fixacao da pontuacao de cada jogo apos o encerramento da partida.
- Painel administrativo completo.
- Integracao inicial com a WorldCupAPI.
- PostgreSQL local com Prisma.
- Frontend em Expo com React Native Web.
- Backend em Express.
- Backups diarios as 12:00 e 19:00.
- Operacao local exposta por subdominio via Cloudflare Tunnel.

### Fora do escopo inicial

- Recuperacao automatica de senha por e-mail.
- Aplicativo desktop nativo empacotado.
- Hospedagem externa gerenciada.
- Alta disponibilidade distribuida com multiplas regioes.
- Suporte a competicoes alem da Copa do Mundo 2026.

## Usuarios e Acesso

O cadastro sera aberto. Cada participante informa:

- `username`: nome de usuario usado para login.
- `nickname`: nome publico exibido no ranking e nas telas.
- `password`: senha de acesso.

Regras:

- `username` deve ser unico.
- `username` nao deve permitir espacos.
- `username` deve ser normalizado para evitar duplicidade por diferencas de caixa.
- `nickname` pode ser mais livre e editavel.
- Login sera feito com `username` e `password`.
- Senhas devem ser armazenadas com hash forte, preferencialmente `argon2id` ou `bcrypt`.

O primeiro administrador sera criado por configuracao inicial ou seed, nunca pelo cadastro publico.

## Regras de Palpite

Os palpites serao organizados por dia de jogos.

Cada dia de jogos tera um bloco de palpites contendo todos os jogos daquele dia. O participante deve preencher os palpites desse bloco antes do fechamento.

Regras:

- O bloco diario fecha 30 minutos antes do primeiro jogo do dia.
- Depois do fechamento, nenhum participante pode criar ou alterar palpites daquele dia.
- Antes do fechamento, cada participante ve apenas seus proprios palpites.
- Apos o fechamento, todos os palpites daquele dia ficam visiveis para todos os participantes.
- O fechamento deve usar o horario local configurado para o sistema.

## Regras de Pontuacao

A pontuacao sera calculada por jogo:

| Situacao do palpite | Pontuacao |
| --- | ---: |
| Acertou o placar exato | 7 pontos |
| Acertou o vencedor ou empate, mas errou o placar | 3 pontos |
| Acertou gols de uma das equipes, mas errou resultado | 1 ponto |
| Errou tudo | 0 ponto |

Durante jogos ao vivo, a pontuacao sera provisoria usando o placar atual. Ao final da partida, a pontuacao daquele jogo sera recalculada com o resultado final e marcada como definitiva.

O ranking pode somar pontuacoes finais e provisionales, mas a interface deve indicar quando existem jogos em andamento e posicoes ainda podem mudar.

## Arquitetura Escolhida

A arquitetura base sera um monolito modular.

Componentes:

- `apps/web`: frontend em Expo com React Native Web.
- `apps/api`: backend Express.
- `packages/shared`: tipos, validacoes e utilitarios compartilhados, se necessario.
- PostgreSQL local como banco principal.
- Prisma como camada de acesso e migracao do banco.
- WorldCupAPI consumida apenas pelo backend.
- SSE para atualizacoes em tempo real do ranking e placares.

O frontend nunca deve chamar a WorldCupAPI diretamente e nunca deve receber a chave da API.

## Backend

Responsabilidades do backend Express:

- Autenticacao.
- Sessao segura.
- Cadastro de usuarios.
- Regras de permissao.
- CRUD de palpites.
- Leitura de jogos e dias de jogos.
- Ranking.
- Painel administrativo.
- Integracao com a WorldCupAPI.
- Sincronizacao de placares e status.
- Calculo de pontuacao.
- Exposicao de eventos SSE.
- Logs de sincronizacao.
- Auditoria de acoes administrativas.

## Frontend

O frontend sera feito com Expo e React Native Web, acessado por navegador em desktop e mobile.

Telas principais:

- Login.
- Cadastro.
- Lista de dias de jogos.
- Tela de palpites do dia.
- Palpites publicos apos fechamento.
- Ranking geral.
- Detalhe de pontuacao por usuario.
- Painel administrativo.

O design deve priorizar clareza, leitura rapida e uso frequente durante os dias de jogos.

## Modelo de Dados Inicial

Entidades principais:

- `User`
- `Session`
- `Team`
- `Match`
- `MatchDay`
- `Prediction`
- `PredictionScore`
- `RankingSnapshot`
- `ApiSyncLog`
- `AdminAuditLog`
- `AppSetting`

### User

Representa participante ou administrador.

Campos esperados:

- `id`
- `username`
- `nickname`
- `passwordHash`
- `role`
- `status`
- `createdAt`
- `updatedAt`

### Team

Representa uma selecao.

Campos esperados:

- `id`
- `externalId`
- `name`
- `code`
- `flagUrl`
- `metadata`

### MatchDay

Agrupamento operacional por data local.

Campos esperados:

- `id`
- `date`
- `firstMatchStartsAt`
- `predictionsCloseAt`
- `status`

Status possiveis:

- `open`
- `closed`
- `in_progress`
- `finished`

### Match

Representa uma partida sincronizada da WorldCupAPI.

Campos esperados:

- `id`
- `externalId`
- `matchDayId`
- `homeTeamId`
- `awayTeamId`
- `startsAt`
- `status`
- `homeScore`
- `awayScore`
- `finalHomeScore`
- `finalAwayScore`
- `rawPayload`
- `lastSyncedAt`

### Prediction

Representa o palpite de um usuario para um jogo.

Campos esperados:

- `id`
- `userId`
- `matchId`
- `predictedHomeScore`
- `predictedAwayScore`
- `createdAt`
- `updatedAt`

Deve haver restricao unica para impedir mais de um palpite do mesmo usuario no mesmo jogo.

### PredictionScore

Guarda a pontuacao calculada de um palpite.

Campos esperados:

- `id`
- `predictionId`
- `matchId`
- `userId`
- `points`
- `scoreType`
- `isFinal`
- `calculatedAt`

`scoreType` pode representar placar exato, resultado, gols de uma equipe ou erro.

## Sincronizacao com WorldCupAPI

A WorldCupAPI sera a fonte inicial para:

- Lista de times.
- Lista de jogos.
- Horarios.
- Status das partidas.
- Placar ao vivo.
- Resultado final.

O backend deve salvar uma copia local dos dados relevantes no PostgreSQL.

Fluxo:

1. Job de sincronizacao chama a WorldCupAPI.
2. Backend compara resposta externa com dados locais.
3. Partidas novas ou alteradas sao persistidas.
4. Se placar ou status de partida mudou, pontuacoes afetadas sao recalculadas.
5. Ranking e snapshots sao atualizados.
6. Evento SSE e emitido para clientes conectados.
7. Resultado da sincronizacao e registrado em `ApiSyncLog`.

### Frequencia Recomendada

A frequencia deve ser configuravel por variaveis de ambiente.

Valores iniciais:

- Jogo ao vivo: a cada 10 a 15 segundos.
- Ate 1 hora antes do primeiro jogo do dia: a cada 1 minuto.
- Dia com jogos, mas sem jogo ao vivo: a cada 5 minutos.
- Fora de dias de jogo: a cada 30 a 60 minutos.

Caso a API falhe, o sistema deve manter os dados locais, registrar erro, aplicar retry com backoff e alertar no painel admin apos falhas repetidas.

## Tempo Real

A recomendacao inicial e usar Server-Sent Events.

Motivos:

- O fluxo principal e servidor para cliente.
- Mais simples que WebSocket.
- Suficiente para 30 a 100 participantes frequentes.
- Evita que cada cliente fique consultando o ranking continuamente.

Eventos esperados:

- Atualizacao de placar.
- Alteracao de status de jogo.
- Atualizacao de ranking.
- Mudanca de estado de um dia de jogos.
- Aviso de falha de sincronizacao para admin.

## Painel Administrativo

O painel admin deve incluir:

- Listagem de usuarios.
- Bloqueio e desbloqueio de usuarios.
- Alteracao de papeis.
- Redefinicao de senha de usuarios.
- Visualizacao de jogos sincronizados.
- Execucao manual de sincronizacao.
- Visualizacao de logs da WorldCupAPI.
- Configuracao das regras de pontuacao.
- Ajustes manuais de partidas em casos excepcionais.
- Visualizacao de ranking e pontuacoes.
- Auditoria de acoes administrativas.

Ajustes manuais devem ser registrados em log e tratados como excecao. O desenho final da implementacao deve definir se ajuste manual sobrescreve temporariamente a API ou se so corrige dados finalizados.

## Seguranca

Requisitos:

- Hash seguro de senha.
- Sessao segura com cookie HTTP-only.
- Protecao CSRF em rotas sensiveis, se for usada autenticacao por cookie.
- Rate limit em login e cadastro.
- Validacao forte de entrada no backend.
- Separacao clara entre usuario comum e admin.
- API key da WorldCupAPI somente no backend.
- Logs de acoes administrativas.
- Protecao contra edicao de palpites apos fechamento.
- Restricoes no banco para evitar duplicidade de palpites.

## Disponibilidade e Operacao

O sistema rodara localmente e sera exposto por Cloudflare Tunnel.

Para atender o requisito de alta disponibilidade dentro desse contexto, sao necessarios:

- Aplicacao rodando como servico com reinicio automatico.
- Cloudflare Tunnel rodando como servico.
- Healthcheck HTTP.
- Logs persistentes.
- Monitoramento de falhas de sync.
- Monitoramento de falhas de backup.
- Plano documentado de restauracao do banco.
- Preferencialmente no-break ou mitigacao para queda de energia.
- Reinicio automatico apos reboot da maquina.

Opcoes para processo:

- PM2.
- Servico do Windows.
- Docker com restart policy.

## Backups

Backups do PostgreSQL devem ser executados todos os dias:

- 12:00.
- 19:00.

Recomendacoes:

- Usar `pg_dump`.
- Nomear arquivos com data e horario.
- Definir politica de retencao.
- Armazenar copia fora do disco principal quando possivel.
- Testar restauracao periodicamente.
- Registrar sucesso ou falha do backup.

## Testes

Prioridades de teste:

- Regra de pontuacao.
- Fechamento de palpites.
- Visibilidade dos palpites apos fechamento.
- Cadastro e login.
- Permissoes admin.
- Redefinicao de senha por admin.
- Sincronizacao com WorldCupAPI usando mocks.
- Recalculo de ranking.
- Eventos SSE.

Tipos de teste:

- Unitarios para pontuacao e regras de dominio.
- Integracao para rotas do backend.
- Testes de frontend para fluxos principais.
- Testes manuais em mobile e desktop via navegador.

## Criterios de Aceite do MVP

- Usuario consegue se cadastrar.
- Usuario consegue fazer login.
- Usuario consegue enviar palpites de todos os jogos de um dia.
- Sistema bloqueia alteracoes 30 minutos antes do primeiro jogo do dia.
- Palpites ficam ocultos antes do fechamento.
- Palpites ficam visiveis para todos apos o fechamento.
- Ranking calcula pontos conforme as regras definidas.
- Ranking atualiza durante jogos ao vivo.
- Pontuacao de jogo finalizado fica definitiva.
- Admin consegue redefinir senha de usuario.
- Admin consegue bloquear usuarios.
- Admin consegue executar sincronizacao manual.
- Sistema registra logs de sincronizacao.
- Backups rodam as 12:00 e 19:00.
- Aplicacao e tunnel reiniciam automaticamente apos falha ou reboot.

## Decision Log

| Decisao | Alternativas consideradas | Motivo |
| --- | --- | --- |
| Fonte inicial: WorldCupAPI | API oficial da FIFA, outras APIs | Fonte pratica e adequada para jogos, resultados e placares |
| Frontend: Expo + React Native Web | React web puro, app desktop nativo | Uma base para mobile e desktop via navegador |
| Backend: Express | NestJS, Fastify | Simples, direto e suficiente para o escopo inicial |
| Banco: PostgreSQL + Prisma | SQLite, Supabase/Postgres externo | PostgreSQL ja esta instalado e Prisma foi escolhido para modelagem |
| Arquitetura: monolito modular | API e worker separados desde o inicio | Menos manutencao local e ainda permite evoluir depois |
| Hospedagem: local via Cloudflare Tunnel | VPS, hospedagem gerenciada | Alinha com a infraestrutura disponivel |
| Cadastro aberto | Convite, admin cria usuario | Simplicidade para entrada dos participantes |
| Login por username e senha | Nickname como login, login social | Username e mais adequado para identificacao unica |
| Admin inicial por seed/config | Primeiro usuario vira admin, codigo secreto | Evita risco em cadastro aberto |
| Palpites por dia | Por jogo, por rodada oficial | Rodadas podem se estender por mais de um dia |
| Fechamento 30 min antes do primeiro jogo do dia | No inicio de cada jogo, antes da Copa | Regra simples e clara para todos |
| Palpites ocultos ate fechamento | Visiveis sempre, visiveis so ao fim | Evita influencia entre participantes |
| Ranking ao vivo provisório | Ranking apenas ao fim dos jogos | Melhora engajamento durante partidas |
| SSE para tempo real | WebSocket | Fluxo principal e servidor para cliente |
| Polling adaptativo | Polling fixo constante | Evita sobrecarga e mantem atualizacao rapida durante jogos |
| Recalcular pontuacao por jogo alterado | Atualizacao incremental complexa | Mais confiavel e suficiente para 30 a 100 usuarios |
| Recuperacao de senha via admin | Reset por e-mail | Mais simples para o MVP |
| Backups as 12:00 e 19:00 | Backup manual ou unico diario | Atende requisito de disponibilidade e recuperacao |

## Riscos e Mitigacoes

| Risco | Impacto | Mitigacao |
| --- | --- | --- |
| WorldCupAPI indisponivel | Ranking ao vivo pode atrasar | Cache local, retry com backoff e logs |
| Limite de requisicoes da API | Atualizacao pode precisar ser reduzida | Polling adaptativo e configuravel |
| Queda da maquina local | Site fica indisponivel | Auto-restart, tunnel como servico, backup e plano de recuperacao |
| Queda de internet/energia | Site fica indisponivel externamente | No-break, monitoramento e plano de contingencia |
| Falha de backup | Risco de perda de dados | Log, alerta e teste de restauracao |
| Erro na regra de pontuacao | Ranking incorreto | Testes unitarios fortes e recalculo reproduzivel |
| Edicao indevida de palpites | Quebra de confianca | Validacao no backend e restricoes no banco |
| Credenciais expostas | Risco de abuso | API key apenas no backend e variaveis de ambiente |

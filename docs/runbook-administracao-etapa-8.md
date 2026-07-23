# Runbook — administração e operação segura multi-competição

## Princípios obrigatórios

Toda mutação administrativa usa uma sessão revalidada no banco, papel global `ADMIN`, CSRF, `Idempotency-Key`, justificativa com no mínimo 10 caracteres e `x-request-id`. O papel global não cria `PoolMembership`: acesso social continua dependendo de membership explícita.

## Atualização de uma competição

`GET /api/admin/overview` lista cada temporada com status, flags e estado do
registro (`VALID`, `MISSING`, `INVALID` ou `RESTORED_DRAFT`), providers por prioridade, última
sincronização, cadência efetiva (`LIVE`, `SCHEDULED_NEAR` ou `IDLE`), horário do
próximo poll elegível e o próximo `AdminJob` pendente. Registro de flags ausente,
parcial ou inválido gera alerta interno e é apresentado como as quatro flags
desligadas.

Em **Administração → Central de operação segura**, selecione a temporada e use
**Buscar e atualizar <competição>**. O painel consulta a `SeasonProviderConfig`
ativa da temporada e executa, na ordem, equipes, estrutura, confrontos,
calendário, resultados e classificação conforme as capacidades daquele
provider. Não há seleção de competição codificada no frontend.

Cada execução mostra URL, `collectedAt`, timezone/offset, checksum do snapshot e
dos artefatos, além das contagens de itens lidos, inseridos, atualizados,
inalterados e enviados para quarentena. A operação é auditada como
`SYNC_REQUESTED` e uma segunda execução sem mudança oficial deve retornar
`UNCHANGED`.

Uma indisponibilidade isolada de perfis de atletas aparece como aviso no
relatório; equipes, tabela, resultados e classificação já reconciliados não são
revertidos nem ocultados.

O clique é uma atualização administrativa manual. Ele nunca altera
`readEnabled`, `writeEnabled`, `uiEnabled` ou `syncEnabled`; o relatório confirma
explicitamente que as quatro flags foram preservadas. A configuração atual usa
FIFA oficial na Copa do Mundo, CBF oficial no Brasileirão, CONMEBOL oficial na
Libertadores/Sul-Americana e CBF Copa do Brasil na competição nacional. Uma
temporada sem provider ativo exibe o botão desabilitado até receber uma
configuração persistida e auditável.

Ações de alto impacto seguem duas requisições distintas:

1. gerar `preview`/`dry-run` com chave idempotente própria;
2. revisar diff e `affectedCount`;
3. copiar literalmente a confirmação `CONFIRMAR <contagem> <prova>`;
4. aplicar com nova chave idempotente, `previewId` e confirmação;
5. conferir `GET /api/admin/audit` pelo `requestId`.

Não há endpoint ou botão de reset genérico, truncamento ou exclusão em massa. Arquivamento é lógico.

## Matriz única de status e flags

As quatro flags são sempre enviadas juntas. Alteração parcial é recusada.

| Status | Estados permitidos |
| --- | --- |
| `DRAFT` | tudo desligado; somente `sync`; ou o estado restaurado legado com `read/write/ui=true` |
| `ACTIVE` | tudo desligado; sync de bastidor; leitura; leitura+sync; exposição pública com `read` obrigatório |
| `FINISHED` | fechado ou leitura/UI; `write` e `sync` desligados |
| `ARCHIVED` | fechado ou leitura/UI; `write` e `sync` desligados |

`writeEnabled` e `uiEnabled` nunca podem ficar ligados sem `readEnabled`. O
estado restaurado `DRAFT` do Brasileirão é classificado pela combinação de
estado/flags, sem seleção por slug, e não é normalizado por migration ou
startup. Para o registro histórico que não contém `syncEnabled`, a leitura
preserva `read/write/ui=true` e assume `sync=false` somente em memória; nenhum
write de normalização é executado.

Use `POST /api/admin/seasons/:seasonId/features/preview` e depois `PUT
/api/admin/seasons/:seasonId/features`, com nova chave idempotente, `previewId`
e confirmação reforçada. O apply registra `requestId`, actor, `seasonId`,
before/after e publica o evento na outbox dentro da mesma transação. Rollback é
uma nova aplicação auditada das quatro flags do estado anterior.

Uma mudança de `CompetitionSeason.status` também valida as flags persistidas
contra a mesma matriz. Se o novo status não aceitar as flags atuais, feche-as
primeiro pelo fluxo acima.

## Cadência do scheduler

A cadência base e a política operacional são configuradas sem editar código:

1. `POST /api/admin/seasons/:seasonId/providers/:providerKey/cadence/preview`;
2. revise `before/after`;
3. `PUT` no mesmo caminho sem `/preview`, com confirmação reforçada e nova
   chave idempotente.

`operationalCadence` possui `liveSeconds`, `scheduledSeconds`, `idleSeconds`,
`nearWindowMinutes` e até 100 overrides em `phases`. Cada override exige
`stageId` ou `roundId` pertencente à mesma temporada; se ambos forem enviados,
a rodada precisa pertencer à fase. A frequência só aumenta para partida `LIVE`
ou `SCHEDULED` dentro da janela próxima. Fora dela, usa a cadência `IDLE`.

O scheduler mantém lock por provider/temporada/tipo, remove lock órfão expirado,
respeita timeout do adapter e aguarda poll em andamento no shutdown antes de
desconectar o Prisma. A falha de uma temporada é registrada de forma redigida e
não impede as demais.

## Preparação e diagnóstico

1. Selecione `seasonId` e, quando a ação afetar o bolão, `poolSeasonId` em `GET /api/admin/overview`.
2. Confirme que o `PoolSeason` retornado está dentro da temporada. Não copie IDs entre abas ou temporadas.
3. Consulte `GET /api/admin/health?seasonId=...&poolSeasonId=...`. Provider sem falha recente, locks expirados, SSE sem backpressure, conexão saudável, ranking recente, outbox sem retry e backup com menos de 24 horas são o estado esperado.
4. Abra `GET /api/admin/divergences?seasonId=...` e resolva quarentenas antes de apply/reprocessamento.

## Temporadas e rodadas

- Temporada: `POST /api/admin/seasons/:seasonId/status/preview`, depois `PATCH` no mesmo recurso sem `/preview`.
- Rodada: `POST /api/admin/rounds/:roundId/status/preview`, depois `PATCH` sem `/preview`.
- `predictionPolicy=KEEP` não altera janelas; `SUSPEND` fecha os jogos da rodada; `REOPEN` reabre somente jogos futuros e conserva o fechamento de cinco minutos.

Rollback de temporada: gere nova prévia para o status anterior e aplique. Rollback de rodada: gere nova prévia para o status anterior e escolha explicitamente a política de palpites. Nunca corrija status diretamente no banco.

## Import e sync

`POST /api/admin/providers/sync` usa o mesmo schema para dry-run e apply. O dry-run deve ter `dryRun=true`, justificativa e chave própria. A resposta inclui `diff`, contagens e `authorization`. Apply usa `dryRun=false`, nova chave, `authorization.previewId` e a confirmação devolvida.

Rollback:

1. desabilite/pare a origem automática;
2. preserve `ProviderSyncRun`, mappings, quarantine, auditoria e outbox;
3. para poucos jogos, aplique override manual com provenance;
4. para lote amplo, restaure o backup validado em ambiente isolado, gere novo dry-run e só então decida o restore de produção;
5. nunca reverta Match IDs nem apague mappings para “tentar de novo”.

## Mappings e quarantine

Use `POST /api/admin/mappings/:quarantineId/resolve/preview` e depois `PUT /api/admin/mappings/:quarantineId/resolve`. O alvo precisa existir em `SeasonTeam` ou `Match` da mesma temporada.

Rollback: não apague a quarentena. Corrija por uma nova divergência/documento e gere nova resolução auditada. Se um mapping incorreto já alimentou partidas, aplique override ou sync corrigido depois de dry-run.

## Override de partida

Use `POST /api/admin/seasons/:seasonId/matches/:matchId/override/preview` e `PUT` no caminho sem `/preview`. A prévia mostra placar/status/horário before/after e quantos palpites/scores podem ser afetados. A fonte automática não sobrepõe campos cobertos pelo override ativo.

Rollback explícito:

1. `POST .../override/rollback-preview`;
2. confirme o estado original guardado em `MatchOverride.before`;
3. `POST .../override/rollback` com nova chave e confirmação;
4. gere dry-run do provider antes de devolver precedência à fonte.

## Rule sets

Liste versões em `GET /api/admin/rule-sets?seasonId=...`. Atribuição usa `POST /api/admin/rule-sets/assignment/preview` e `PUT /api/admin/rule-sets/assignment`. O servidor aceita somente versões globais ou da mesma temporada e bloqueia mudança depois do primeiro palpite.

Rollback antes do primeiro palpite: atribua novamente a versão anterior via preview. Depois do primeiro palpite, crie uma nova versão e execute migração/reprocessamento aprovada; não edite JSON versionado.

## Usuários e sessões

`PATCH /api/admin/users/:userId/access` altera papel/status e pode incrementar `sessionVersion`. Bloqueio/rebaixamento próprio é recusado. O endpoint não cria, promove nem remove membership.

Rollback: aplique o papel/status anterior com nova justificativa. A sessão revogada não é restaurada; o usuário autentica novamente. Revise memberships separadamente no contexto social adequado.

## Reprocessamento e jobs

1. Leia `scoringRuleSetVersionId` do `PoolSeason`.
2. `POST /api/admin/reprocess/preview` com `SCORES`, `RANKING` e/ou `ACHIEVEMENTS`.
3. Revise as contagens e aplique em `POST /api/admin/reprocess`.
4. Acompanhe `GET /api/admin/jobs`. O worker compara novamente `seasonId`, `poolSeasonId` e `ruleSetVersionId` antes de escrever.
5. Pause em `POST /api/admin/jobs/:jobId/pause`.
6. Retome job `PAUSED` em `POST .../resume`; a execução reinicia o plano
   idempotente. Reexecute somente job `FAILED` em `POST .../retry`. São no
   máximo três tentativas.

Rollback: scores guardam auditoria de recomputação e cálculo idempotente. Para reversão lógica, corrija o resultado/override ou selecione a versão aprovada e reprocese de novo. Se o efeito pretendido for restauração pontual de banco, valide o backup fora de produção antes do restore.

## Auditoria e resposta a incidente

Filtre `GET /api/admin/audit` por `seasonId`, `poolSeasonId`, `actorId`, `action` ou `requestId`. Cada mutação nova contém actor, request, origem, justificativa, before/after e contagem. `AdminOperation` registra replay, preview consumida e chave; `AdminJob` registra progresso e regra fixada.

Em incidente, pause jobs, preserve logs, capture o `requestId`, consulte a operação idempotente e compare before/after. Não remova evidência. Credenciais, cookies, tokens CSRF e payload externo integral não devem ser copiados para tickets.
Erros persistidos e emitidos pelo scheduler/worker passam por redação de URL
remota, authorization, cookie, token, secret e password.

## Validação de backup

Execute `npm run backup`, depois `npm run backup:validate`. Um arquivo recente apenas indica frescor; o gate operacional exige validação e, antes de mudança ampla, restore drill fora de produção. O restore de produção segue o runbook geral e requer janela aprovada.

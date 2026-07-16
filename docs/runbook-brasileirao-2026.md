# Runbook — Brasileirão Série A 2026

## Estado de exposição

A temporada nasce como `DRAFT` e canário administrativo. As flags persistidas
`readEnabled`, `writeEnabled` e `uiEnabled` começam desligadas. A UI também exige
`EXPO_PUBLIC_BRASILEIRAO_UI=1`; portanto uma publicação do bundle, isoladamente,
não expõe a competição.

O comando `npm run build` usa `apps/web/scripts/build-production.mjs` e injeta
explicitamente as flags públicas aprovadas no bundle de produção. A exposição
continua condicionada a `uiEnabled=true` no banco; não publique o frontend com
`expo export` diretamente, pois esse atalho ignora o perfil de release. O build
também limpa o cache do Metro para impedir a reutilização de flags compiladas
por uma publicação anterior.

O início operacional dos palpites é `2026-07-16T03:00:00.000Z` (00:00 em
`America/Sao_Paulo`). `PoolSeason.scoreableFrom` é a autoridade: qualquer jogo
oficial agendado ou remarcado a partir desse instante pode receber palpites,
mesmo quando pertence nominalmente a uma rodada anterior. Jogos com início
anterior ao corte permanecem no campeonato e na classificação esportiva, mas
não aceitam palpites nem geram score. Os gates por rodada ficam nulos para não
bloquear partidas adiadas.

## Autoridades consultadas

- Tabela vigente: <https://www.cbf.com.br/futebol-brasileiro/tabelas/campeonato-brasileiro/serie-a/2026>
- Endpoint fixo por rodada: `https://www.cbf.com.br/api/cbf/jogos/campeonato/1260611/rodada/{1..38}/fase/1993`
- Tabela oficial fixada (742.577 bytes; SHA-256 `7ee848ecac23d92be55222e5adec6c992cddbf6eb457d814e5be3d3306224782`): <https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/Tabela_Detalhada_BSA_2026_16_01_7a2261a9d7.pdf>
- Regulamento específico (598.606 bytes; SHA-256 `1dadb33c3b2174540a0ff46489ff9b8392072118c47b334240d1351335d76f6a`): <https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Brasileiro_Serie_A_2026_c984f8cf05.pdf>

A coleta registra URL, `collectedAt`, timezone `America/Sao_Paulo`, tamanho e
SHA-256 dos documentos, além do checksum determinístico dos DTOs normalizados.
O adapter não recebe URL do cliente. Redirect é recusado, e cada resposta tem
timeout, limite de bytes e retry com jitter.

## Preparação e carga canário

Configure `DATABASE_URL` e execute:

```powershell
npm run snapshot:copa -- --output snapshots/copa-before-brasileirao.json
npm run reconcile:cbf-2026
npm run prisma:migrate
npm run load:brasileirao-2026
npm run snapshot:copa -- --output snapshots/copa-after-brasileirao.json
npm run snapshot:compare -- snapshots/copa-before-brasileirao.json snapshots/copa-after-brasileirao.json
```

O loader para antes de qualquer escrita se não encontrar exatamente 20 clubes,
380 referências na tabela e 10 partidas com horário na rodada 20, usada como
gate de completude da fonte — não como corte de palpites. Em seguida executa
`dryRun`, `apply` e uma segunda importação para `TEAMS`,
`SCHEDULE`, `RESULTS` e `STANDINGS`. O processo falha se a segunda carga produzir insert ou
quarentena.

Os mesmos passos podem ser acionados pelo admin:

1. `POST /api/admin/brasileirao-2026/prepare`;
2. `POST /api/admin/providers/sync` com provider `cbf-serie-a-2026`, uma chave de
   idempotência nova e os tipos na ordem `TEAMS`, `SCHEDULE`, `RESULTS`, `STANDINGS`;
3. repetir com novas chaves e conferir inserts/quarentenas zerados;
4. consultar `/api/admin/providers/sync-runs` e
   `/api/admin/providers/quarantine`.

## Reconciliação

Antes de liberar leitura, conferir:

- 20 `SeasonTeam`, 38 rodadas e 10 jogos na rodada 20;
- apenas jogos com data e horário oficiais; “A Definir” não vira data fictícia;
- standings internos contra a tabela CBF, incluindo J/V/E/D/GP/GC/SG/PTS;
- desempate `cbf-rec-2026-art-15-v1`: pontos, vitórias, saldo, gols pró,
  confronto direto apenas entre dois clubes, menos vermelhos, menos amarelos e
  fallback determinístico enquanto um sorteio oficial não existir;
- nenhuma `Prediction` ou `PredictionScore` para partida anterior a
  `2026-07-16T03:00:00.000Z`;
- snapshot da Copa idêntico antes/depois.

Ambiguidade ou referência ausente fica em `SyncQuarantine`. Resolva pelo endpoint
administrativo de reconciliação, com justificativa, e repita o mesmo payload com
nova chave. Nunca edite o mapping diretamente no banco.

## Política de jogos e resultados

- **Adiado:** mantém Match ID e palpite; bloqueia edição até a CBF publicar a
  remarcação. A nova data recalcula o fechamento individual.
- **Remarcado:** atualiza `startsAt`, `MatchDay` e fechamento sem recriar a
  partida ou o palpite. A nova data é comparada com `scoreableFrom`; portanto
  um jogo de rodada antiga remarcado após o corte fica elegível.
- **Cancelado:** bloqueia palpite e remove eventual score ao recalcular; o
  registro histórico permanece auditável.
- **Resultado corrigido:** `FINISHED -> FINISHED` é aceito, recalcula os scores e
  o ranking do `PoolSeason`; regressão automática de `FINISHED` é recusada.
- **Override manual:** tem precedência sobre provider, exige justificativa e
  continua ativo após sincronizações futuras.

Eventos de agenda, resultado, ranking e flags são gravados na outbox dentro da
transação e publicados somente após commit.

## Contingência CSV/manual

CSV e manual passam pelos mesmos DTOs estritos, mappings, quarentena,
idempotência, locks, overrides, transações e outbox do provider oficial.

1. Exporte a última resposta oficial já reconciliada; não informe URL remota.
2. Para CSV, use `provider=csv`, `sourceDocument` com nome local e um tipo por
   execução. Limite: 750 KiB.
3. Para operação manual, use `provider=manual` e o mesmo formato normalizado.
4. Sempre execute `dryRun=true`, revise o diff, depois aplique com outra chave.
5. Repita a carga e exija zero inserts e zero quarentenas.

Campos de resultado aceitos: IDs externos, clubes, horário opcional, placar,
status e contagens opcionais de amarelos/vermelhos. Agenda `SCHEDULED`, `LIVE` ou
`FINISHED` exige `startsAt` com offset; `POSTPONED`/`CANCELLED` sem data só pode
atualizar uma partida já mapeada.

## Liberação e rollback

Libere nesta ordem, com justificativa auditada:

1. `readEnabled=true` para canário autenticado;
2. `writeEnabled=true` depois do smoke de fechamento;
3. `uiEnabled=true` e deploy com `EXPO_PUBLIC_BRASILEIRAO_UI=1` somente após os
   gates.

Rollback operacional: desligue primeiro `writeEnabled`, depois `uiEnabled` e
`readEnabled`. Isso não apaga dados nem IDs. Para restaurar serviço sem provider,
use CSV/manual. Não faça rollback destrutivo de migrations.

## Verificação final

```powershell
npm run lint
npm test
npm run build
```

Faça smoke web em 390×844 e 1440×1000: login, abrir Brasileirão, trocar o dia,
salvar um palpite aberto (incluindo um adiado de rodada anterior), confirmar a
mensagem, conferir classificação e alternar
ranking geral/rodada/mês/turno. Ao terminar, restaure as três flags para `false`
se a exposição pública não tiver sido aprovada.

# Runbook — CONMEBOL Libertadores 2026

## Estado seguro inicial

A temporada deve permanecer `DRAFT`, com `readEnabled`, `writeEnabled`,
`uiEnabled` e `syncEnabled` desligadas até o Prompt 10. O histórico é
administrativo e `historicalMatchesScoreable=false` impede pontuação retroativa.

## Coleta, carga e verificação

Com `DATABASE_URL` e `SESSION_SECRET` configurados, a temporada 2026 da
Sul-Americana precisa existir antes do `apply`, pois o gate exige o vínculo
bilateral dos oito terceiros colocados.

```powershell
npm run collect:libertadores-2026
npm run reconcile:libertadores-2026 -- --dry-run
npm run load:libertadores-2026 -- --dry-run
npm run load:libertadores-2026 -- --apply
npm run load:libertadores-2026 -- --verify
npm run reconcile:libertadores-2026 -- --verify-db
```

O coletor consulta apenas as fontes CONMEBOL registradas em
[evidencia-prompt-5-libertadores-2026.md](evidencia-prompt-5-libertadores-2026.md),
recalcula tamanho/SHA-256 e só substitui o snapshot depois de validar todas as
cardinalidades. O `apply` usa o provider CONMEBOL comum e sincroniza, em ordem,
times, estrutura, ties, agenda, resultados e standings. O `verify` é read-only
e falha diante de qualquer insert, update ou quarentena pendente.

## Identidade global e isolamento

Cada terceiro colocado precisa ter exatamente dois mappings sazonais com o
mesmo `internalId`: origem Libertadores e destino Sul-Americana. O metadata
`qualificationTransfer` registra rota, temporadas, grupo, posição, checksum e
instante de coleta nos dois `SeasonTeam`.

Nacional/Atlético Nacional e Racing argentino/uruguaio são desambiguados por
país/federação. Não resolva homônimos editando mappings manualmente; uma
ambiguidade deve ir para `SyncQuarantine`.

O gate de banco precisa manter em zero:

- scores de partidas anteriores ao corte;
- `RankingSnapshot` com `seasonId` de uma copa e `poolSeasonId` da outra;
- `OutboxEvent` com a mesma combinação cruzada;
- `Match.externalId` presente nas duas temporadas.

## Corte e chave futura

O corte homologado é `2026-08-11T22:00:00.000Z`: Fluminense x Independiente
Rivadavia, no Maracanã. Revalide o horário e o estádio antes de qualquer futura
abertura de escrita. Se não houver antecedência operacional segura, mova o
corte para o primeiro jogo completamente confirmado de uma fase posterior e
repita coleta, apply, verify e evidência.

Quartas, semifinais e final já possuem rounds, janelas e caminhos oficiais, mas
os participantes dependem dos vencedores. Quando a CONMEBOL os definir:

1. execute nova coleta;
2. confirme os dois clubes concretos de cada tie;
3. gere novo snapshot e checksum;
4. execute dry-run, apply e verify;
5. confirme a promoção da chave sem mudar IDs já reconciliados.

Nunca crie clubes `Unknown` ou participantes fictícios.

## Correção e contingência

Um resultado `FINISHED` pode receber correção oficial; a reconciliação deve
recalcular standings e o tie de forma auditável. Resultado finalizado não pode
regredir automaticamente para `LIVE` ou `SCHEDULED`.

Durante incidente, desligue `writeEnabled`, depois `syncEnabled`, `uiEnabled` e
`readEnabled`. Esse rollback por flags preserva IDs, histórico e auditoria. Não
reverta migrations nem apague temporadas para corrigir dados oficiais.

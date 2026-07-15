# Runbook de sincronização e reconciliação de providers

## Escopo e invariantes

O pipeline aceita apenas os adapters registrados `ge`, `cbf-official`, `csv`
e `manual`. Nenhum endpoint recebe URL de fetch. GE usa URLs fixas no código;
CBF consome export oficial local até existir feed público estável e contratado.
CSV e manual passam pelos mesmos schemas normalizados estritos.

Uma execução é identificada por `provider + seasonId + type + idempotencyKey`.
Repetir a chave retorna a execução concluída sem novo fetch ou escrita. Uma nova
chave com o mesmo conteúdo recalcula o diff, mas mappings e checksums impedem
inserts de domínio duplicados.

## Preparação

1. Faça backup e valide a restauração conforme o runbook do ambiente.
2. Execute `npm run prisma:migrate` e `npm run prisma:generate`.
3. Confirme a temporada em `GET /api/seasons/:seasonId`.
4. Mantenha o sync automático desabilitado durante reconciliações extensas.
5. Use uma chave legível e única, por exemplo
   `ops-2026-07-16-results-v1`.

## Dry-run, diff e apply

Use `POST /api/admin/providers/sync` autenticado como administrador. O dry-run
é o primeiro passo obrigatório na operação. Exemplo GE:

```json
{
  "provider": "ge",
  "seasonId": "competition-season-world-cup-2026",
  "type": "RESULTS",
  "dryRun": true,
  "idempotencyKey": "ops-2026-07-16-ge-results-dry-v1"
}
```

Revise `counts` e `diff`. Para aplicar, envie a mesma carga com `dryRun: false`
e uma nova chave terminada em `apply-v1`. Nunca reutilize a chave do dry-run:
a idempotência deliberadamente devolverá o resultado anterior.

Os tipos devem ser executados nesta ordem quando a fonte trouxer carga
completa: `TEAMS`, `SCHEDULE`, `RESULTS`, `STANDINGS`. Resultado `FINISHED`
pode receber correção de placar permanecendo `FINISHED`, mas não regride
automaticamente. Uma remarcação atualiza o `Match` encontrado pelo mapping e
preserva seu ID.

## Reconciliação de quarantine

Liste pendências com:

```text
GET /api/admin/providers/quarantine?seasonId=<seasonId>&unresolvedOnly=true
```

Para `AMBIGUOUS_NAME`, compare o payload, o documento de origem e os times ou
jogos da temporada. Não escolha apenas pela semelhança do nome. Depois de obter
evidência inequívoca, grave o mapping:

```text
POST /api/admin/providers/quarantine/<id>/resolve
```

```json
{
  "internalId": "id-interno-confirmado",
  "externalId": "id-externo-do-jogo-ou-time",
  "justification": "Conferido no documento oficial CBF de 16/07/2026, jogo 42."
}
```

O alvo precisa pertencer à mesma temporada. A ação grava mapping, ator,
justificativa e resolução. Em seguida repita o dry-run com nova chave; aplique
somente quando a ambiguidade desaparecer. Duplicidade dentro do próprio
payload deve ser corrigida na origem, não reconciliada manualmente.

## Override manual

Use override apenas para uma decisão editorial confirmada. Exemplo:

```text
PUT /api/admin/seasons/<seasonId>/matches/<matchId>/override
```

```json
{
  "justification": "Súmula oficial corrigiu o placar após revisão disciplinar.",
  "values": {
    "status": "FINISHED",
    "homeScore": 2,
    "awayScore": 1,
    "finalHomeScore": 2,
    "finalAwayScore": 1
  }
}
```

O sync posterior registra o valor recebido, mas mantém os campos cobertos pelo
override. Para retirar a precedência, use `DELETE` no mesmo caminho com uma
justificativa. A retirada não altera o jogo imediatamente; execute novo
dry-run/apply para aceitar a fonte automática.

## Contingência CSV

O CSV é texto UTF-8, separado por vírgula, com header exato e até 750 KiB. Não
adicione colunas livres. Para resultados:

```csv
externalId,matchExternalId,homeTeamExternalId,awayTeamExternalId,homeTeamName,awayTeamName,startsAt,homeScore,awayScore,status
result-42,match-42,team-a,team-b,Time A,Time B,2026-07-16T19:00:00-03:00,2,1,FINISHED
```

Envie o conteúdo em `csv`, o nome local em `sourceDocument` e `provider: csv`.
`sourceDocument` não pode ser URL e nunca é aberto pelo servidor. Aplique o
mesmo rito dry-run, reconciliação e apply. Para export CBF normalizado, use
`provider: cbf-official` e `items`; ele passa pelos mesmos DTOs do manual/CSV.

## Falhas, lock e retomada

- Timeout, resposta acima do limite, redirect e schema inválido encerram a
  execução como `FAILED`, com mensagem redigida.
- O bloco `finally` remove o lock por owner e limpa `activeRun`. Confirme que
  não há lock vencido em `ProviderSyncLock`; locks expirados são removidos na
  próxima tentativa.
- Consulte `GET /api/admin/providers/sync-runs` para checksum, início/fim,
  contagens e erro. Não copie HTML ou credenciais para logs operacionais.
- Falha parcial gera `PARTIAL`; itens válidos já aplicados permanecem, e os
  ambíguos ficam em quarantine. Corrija mappings e reaplique com nova chave.
- Eventos são gravados na outbox na transação da mudança e publicados apenas
  após commit. Se o SSE estiver indisponível, o dispatcher retoma pendências.

## Watch e desligamento

O comando `npm run scrape:ge-scores:watch` trata `SIGINT` e `SIGTERM`, impede
novo intervalo, aguarda a execução corrente e desconecta o Prisma. Em
contingência, envie o sinal uma vez e aguarde a mensagem de shutdown; não mate
o processo antes do timeout do provider, salvo incidente maior.

## Rollback operacional

1. Desabilite o sync automático.
2. Não apague mappings, runs, quarantine nem outbox: são evidência de auditoria.
3. Para dado incorreto urgente, crie override justificado.
4. Corrija o adapter/documento e valide por dry-run.
5. Remova o override somente depois do apply correto e de conferir ranking e
   eventos pendentes.

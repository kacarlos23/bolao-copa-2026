# Runbook — CONMEBOL Sul-Americana 2026

## Estado seguro inicial

A temporada deve permanecer `DRAFT`, com `readEnabled`, `writeEnabled`,
`uiEnabled` e `syncEnabled` desligadas. Não altere essas flags como parte da
carga. O histórico é consultável pelo admin, mas não é pontuável.

## Coleta, carga e verificação

Com `DATABASE_URL` e `SESSION_SECRET` configurados:

```powershell
npm run collect:sudamericana-2026
npm run reconcile:sudamericana-2026 -- --dry-run
npm run load:sudamericana-2026 -- --dry-run
npm run load:sudamericana-2026 -- --apply
npm run load:sudamericana-2026 -- --verify
npm run reconcile:sudamericana-2026 -- --verify-db
```

O coletor consulta somente os URLs fixos da CONMEBOL registrados em
[evidencia-prompt-4-sudamericana-2026.md](evidencia-prompt-4-sudamericana-2026.md),
recalcula tamanho e SHA-256 e substitui o fixture somente se todas as
cardinalidades forem válidas. Revise o diff do fixture antes de aplicar.

O dry-run de carga não escreve domínio. O apply executa, nesta ordem: times,
estrutura, ties, agenda, resultados e standings. O verify é uma segunda
execução read-only e falha diante de qualquer diferença ou quarentena.

## Gate antes de abrir palpites

Revalide na CONMEBOL os horários e estádios detalhados das oitavas. O slot usado
na homologação, `2026-08-12T12:00:00.000Z`, ainda estava TBC. Se o primeiro
jogo confirmado ocorrer em outro instante, atualize o fixture e
`PoolSeason.scoreableFrom`, repita dry-run/apply/verify e documente a nova
coleta. Se não houver antecedência operacional segura, mova o corte para a
primeira partida integralmente confirmada das quartas.

Depois, execute os gates do repositório e o smoke administrativo. A ordem de
ativação é `read`, `sync`, `write`, `ui`, sempre com justificativa auditada.
A ativação não faz parte deste prompt.

## Atualização da chave

Os 16 slots TBC das oitavas não são clubes. Não crie `Team` chamado `Unknown`
nem ties com participante fictício. Quando os playoffs forem concluídos:

1. recolha novamente as fontes oficiais;
2. confirme os dois participantes de cada tie;
3. gere um novo snapshot com nova evidência e checksum;
4. execute dry-run, apply e verify;
5. confirme que cada vencedor alimenta o caminho A–H oficial.

Quartas, semifinais e final seguem a mesma regra. O round e o caminho podem
existir antes; o tie concreto somente existe quando seus participantes forem
oficiais.

## Contingência e rollback

Ambiguidade vai para `SyncQuarantine`; não edite mappings diretamente. Durante
incidente, desligue `writeEnabled`, depois `syncEnabled`, `uiEnabled` e
`readEnabled`. Esse rollback preserva partidas, ties, palpites, scores e IDs.
Não reverta migrations nem exclua histórico.

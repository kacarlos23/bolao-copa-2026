# ADR-006 — convivência e unificação do mata-mata por Tie

- Status: Aceito
- Data: 2026-07-14
- Decisão física final: 2026-07-21

## Contexto

`KnockoutFixture` e `KnockoutPick` guardam regras, IDs e scores específicos da
Copa do Mundo. Ao mesmo tempo, competições eliminatórias precisam representar
uma série de uma ou duas partidas sem confundir o mando de um jogo com a
identidade da série, nem placar regulamentar, prorrogação, pênaltis, agregado e
equipe classificada.

Converter o legado no mesmo passo que introduz o novo domínio ameaçaria dados
históricos. A decisão física precisa, portanto, permitir convivência expand-only,
paridade verificável e reversão de aplicação sem reversão destrutiva de schema.

## Alternativas

1. Converter o legado diretamente para `Match`: rejeitada pelo risco de
   preservação e pela ausência de uma entidade para a série.
2. Manter para sempre dois domínios: rejeitada por duplicar regra e integrações.
3. Adicionar `Tie`, manter o legado como fonte efetiva e migrar somente após
   shadow read com paridade: escolhida.

## Decisão

### Forma física

`Tie` é uma série eliminatória pertencente a exatamente uma `CompetitionSeason`,
um `Stage` e um `Round` da mesma temporada. Sua identidade esportiva é formada
por `teamAId` e `teamBId`; ela não deriva de quem manda a primeira partida.

Cada série possui:

- `key` estável e `order` dentro da rodada;
- `expectedLegs` igual a 1 ou 2;
- `status`, `provenance`, `metadata` e timestamps;
- agregado de A e B, vencedor/classificado e método de decisão, todos nulos
  enquanto a informação ainda não for suficiente;
- zero, uma ou duas relações com `Match` por `tieId` e `legNumber`.

`Match` recebe campos aditivos e independentes para:

- placar do tempo regulamentar;
- gols marcados na prorrogação;
- placar da disputa de pênaltis.

Os campos legados `homeScore`, `awayScore`, `finalHomeScore` e
`finalAwayScore` não são removidos, regravados nem reinterpretados por esta
decisão. A regra de pontos `15/3/1/0` continua aplicada exclusivamente a
`Match`, usando a base de placar já versionada; não existe bônus de classificado.

`TieDecisionMethod` admite `AGGREGATE`, `EXTRA_TIME`, `PENALTIES`, `WALKOVER` e
`ADMINISTRATIVE`. `WALKOVER` e `ADMINISTRATIVE` exigem vencedor declarado de
forma explícita. Os demais métodos só podem surgir da recomputação integral dos
jogos concluídos. O placar agregado inclui tempo regulamentar e prorrogação,
mas nunca o placar da disputa de pênaltis.

O serviço de recomputação é puro e determinístico: sempre recalcula a partir
do estado atual das partidas, em vez de acumular deltas. Assim, uma correção
posterior substitui corretamente agregado, método e classificado. Uma série
incompleta, empatada sem pênaltis suficientes ou com partida ainda não
finalizada nunca promove equipe automaticamente.

### Integridade e isolamento

O banco impõe:

- `expectedLegs` em `{1, 2}` e equipes A/B distintas;
- vencedor, quando presente, igual a A ou B;
- agregado em pares, com valores não negativos;
- estado `DECIDED` somente com vencedor e método; demais estados sem decisão;
- unicidade de `key` por temporada, de `order` por rodada e de `legNumber` por
  série;
- `tieId` e `legNumber` ambos nulos ou ambos preenchidos;
- placares de regulamentar, prorrogação e pênaltis em pares e não negativos;
- FKs compostas que impedem cruzar temporada, etapa, rodada ou partida.

Não é criado `TiePrediction` nesta etapa. Portanto, nenhuma nova escrita de
palpite ou score atravessa `PoolSeason`, e as restrições existentes de isolamento
de pool permanecem a única fonte da pontuação.

### Provider e legado

`ProviderEntityType` recebe `TIE`, permitindo mapping externo próprio sem usar
slug de competição para selecionar comportamento. A configuração persistida de
provider por temporada pertence ao ADR/prompt posterior.

`KnockoutFixture`, `KnockoutPick` e seus scores permanecem inalterados e como
fonte efetiva da Copa durante a fase expand. Um alias determinístico permite
associar uma fixture legada a um `Tie` sem mudar IDs. Quando um shadow read for
habilitado para um registro associado, ele obrigatoriamente:

1. normaliza legado e sombra pelo mesmo contrato;
2. emite uma métrica de paridade para `match`, `mismatch` ou `missing`;
3. devolve o legado como valor efetivo;
4. bloqueia o gate de migração diante de qualquer divergência.

Nenhuma escrita dual, backfill destrutivo ou redirecionamento silencioso é
autorizado por este ADR.

## Consequências

Há convivência temporária entre o domínio específico da Copa e o domínio
genérico. O custo é compensado por constraints, adapter explícito, telemetria e
testes de paridade. Novos providers podem mapear `TIE`, mas somente dados
suficientes ou uma decisão manual explícita podem classificar uma equipe.

## Invariantes testáveis

- Séries de uma e duas partidas recomputam o mesmo resultado para a mesma
  entrada, independentemente da ordem das partidas recebidas.
- Pênaltis decidem o classificado, mas não alteram o agregado.
- Prorrogação altera o agregado e identifica `EXTRA_TIME` quando desempata.
- W.O. e decisão administrativa nunca são inferidos.
- Correção posterior remove qualquer classificado que deixe de ser sustentado
  pelos dados atuais.
- Série incompleta ou empatada sem desempate permanece sem vencedor.
- Fixtures, picks, scores e hashes legados da Copa não mudam na migration.
- Toda leitura em shadow emite exatamente uma observação de paridade e mantém o
  legado como fonte efetiva.
- Nenhum `Tie` ou `Match` ligado a ele cruza temporada, etapa ou rodada.

## Compatibilidade, rollout e rollback

A migration é somente expand: cria enums/tabela/índices/constraints e adiciona
colunas opcionais a `Match`; não executa `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`
ou backfill do legado. O rollout começa com leitura e recomputação do domínio
novo. O shadow da Copa só é ativado para aliases existentes e continua servindo
o legado. Rollback de aplicação simplesmente deixa de consultar `Tie`; as tabelas
antigas permanecem fontes ativas. A contract phase não tem data e exige gate
explícito com paridade integral.

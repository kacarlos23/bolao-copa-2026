# Evidência — Prompt 9, administração, jobs e observabilidade

Data da execução: 23/07/2026. Ambiente: máquina de teste. SHA base do
Prompt 9: `5c2afef332d2dba8e92d91da2efe3b5b6575d0b5`.

## Resultado

O Prompt 9 foi implementado sem criar migration, executar carga, alterar feature
flag ou escrever nas temporadas oficiais. A operação de múltiplas competições
passou a compartilhar uma política única, falhar fechada e manter o provider de
uma temporada isolado dos demais.

Entregas:

- visão administrativa por temporada com provider configurado, prioridade,
  timeout, última sincronização, contagens, saúde, próximo job e próxima
  execução automática;
- `DRY_RUN`, `DIFF`, `APPLY` e `VERIFY` por tipo, com mappings de team, match,
  stage, round e tie preservados;
- configuração auditada de cadência por temporada, fase e rodada, com prévia e
  confirmação reforçada;
- scheduler adaptativo para partidas `LIVE`, `SCHEDULED` próximas e período
  ocioso, sem sobreposição e com espera dos polls ativos no shutdown;
- falha de provider contida por temporada, timeout, lock e recuperação de lock
  órfão;
- pausa, retomada e reexecução de jobs como operações distintas e
  idempotentes;
- aplicação de flags em duas etapas, com prévia, matriz de transição,
  revalidação transacional, RBAC, sessão, CSRF, justificativa, requestId,
  seasonId, poolSeasonId, auditoria before/after e outbox;
- resposta e persistência de erros operacionais redigidas, incluindo
  credenciais em URLs, bearer tokens, headers e pares chave/valor;
- botão Atualizar vinculado ao provider persistido da temporada selecionada e
  protegido por cooldown server-side;
- fallback CSV/manual permitido somente quando declarado na configuração
  persistida da temporada.

## Matriz de status e flags

A política central aceita somente estados explicitamente declarados:

| Status | Estados válidos |
| --- | --- |
| `DRAFT` | fechado; sync administrativo; restaurado legado explícito |
| `ACTIVE` | fechado; leitura; leitura+sync; escrita; UI |
| `FINISHED` | fechado; leitura; leitura+UI |
| `ARCHIVED` | fechado; leitura |

`writeEnabled` e `uiEnabled` exigem `readEnabled`. Temporadas finalizadas ou
arquivadas não aceitam escrita nem sync. Configuração ausente, parcial, inválida
ou incompatível com o status falha fechada e gera alerta redigido.

O estado restaurado observado no banco de teste para o Brasileirão é
`DRAFT`, com `readEnabled=true`, `writeEnabled=true`, `uiEnabled=true` e
`syncEnabled` ausente. Ele foi tratado como `RESTORED_DRAFT`: os três valores
persistidos são preservados e `syncEnabled=false` é inferido somente em memória.
Não houve normalização por migration, startup ou escrita incidental.

## Gates

| Gate | Resultado |
| --- | --- |
| testes focados de política, scheduler, provider, jobs, auditoria e shutdown | PASS |
| `npm run gate:pr` | PASS; 23 preservação, 18 shared, 219 API, 75 web e 27 contratos |
| lint, genericidade e preservação | PASS |
| build e budget do frontend | PASS; 2.366.132 bytes JavaScript |
| auditoria de dependências | PASS; 0 high, 0 critical; 13 moderadas já triadas |
| `NODE_ENV=test; npm run gate:release-candidate` | PASS; 7 PostgreSQL, 60 E2E, 2 load tests e duas repetições sem flake |
| Prisma no banco efêmero | PASS; 17 migrations aplicadas por `migrate deploy` no runner isolado |
| snapshots locais antes/depois | PASS; `Snapshots identicos.` |

A primeira execução do release-candidate detectou duas expectativas E2E ainda
acopladas ao botão antigo de aplicação direta das flags. As fixtures foram
ajustadas para afirmar o novo contrato de prévia e aplicação reforçada. A
execução final integral passou. O banco efêmero usado pelo runner não continha
a baseline histórica; a preservação não vazia foi validada separadamente contra
o banco ativo de teste, em transação somente leitura.

## Preservação

Contagens não vazias antes e depois:

| Entidade | Contagem |
| --- | ---: |
| usuários ativos | 24 |
| partidas da Copa | 72 |
| palpites | 2.042 |
| scores | 1.311 |
| fixtures de mata-mata | 32 |

Hashes de negócio protegidos:

- `Match`: `f3b5fcbc57f74006fd7e867841273dd0c287ef14b4fd9cdf75b9f6d5cbd50646`;
- `Prediction`: `86af5bb9497c9609e4ee208a97b795f38b8ffbcf8eebe8c6022747a92dcba351`;
- `PredictionScore`: `66b1ef039914c524e5c2424d67c857729bdd025f9965705d2d4a9ef0624c7b78`;
- `RankingSnapshot`: `c978b9971e09028c9cc2676c73164613476e6d4b98d06959910422d7c250ace0`.

Os snapshots ficaram fora do Git. Nenhum segredo, payload sensível ou URL de
banco foi incluído nesta evidência.

## Estado operacional e riscos

- nenhuma migration foi criada ou aplicada no banco ativo durante o Prompt 9;
- o banco ativo de teste continua três migrations aditivas atrás da `main`;
- as temporadas da Libertadores, Sul-Americana e Copa do Brasil ainda não
  existem nesse banco e serão carregadas, com todas as flags fechadas, somente
  no Prompt 10;
- as quatro flags das novas copas permanecem desligadas nas definições de carga;
- as flags atuais são globais por temporada; isolamento efetivo por pool/usuário
  deve ser provado antes de qualquer abertura de canário;
- o estado restaurado do Brasileirão permanece sem `syncEnabled` persistido e
  sem alteração operacional;
- nenhum P0/P1 funcional do Prompt 9 permanece.

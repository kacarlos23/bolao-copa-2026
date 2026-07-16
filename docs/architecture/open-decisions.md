# Registro de decisões abertas

Nenhuma decisão de schema necessária à Etapa 2 permanece aberta. Os itens
abaixo são deliberadamente posteriores e não autorizam suposição silenciosa.

| ID | Decisão | Proposta implementada | Status | Responsável | Data-limite | Impacto se não fechada |
|---|---|---|---|---|---|---|
| OD-01 | Fonte oficial primária e fallback operacional do Brasileirão | CBF oficial como primária; CSV/manual somente com artefato previamente reconciliado e o mesmo pipeline | **Aguardando aprovação datada** | Product owner + operação | Antes da exposição | Temporada não pode ser exposta. |
| OD-02 | Corte de elegibilidade do pool do Brasileirão | `scoreableFrom=2026-07-16T03:00:00.000Z` (00:00 BRT); a data oficial ou remarcada da partida é a autoridade, sem bloqueio pela rodada nominal; histórico anterior não pontua | **Aprovada em 16/07/2026** | Product owner | Fechada | Jogos anteriores ao corte ficam apenas em standings; adiados de rodadas antigas tornam-se elegíveis quando remarcados após o corte. |
| OD-03 | Janela de retenção de outbox e snapshots em produção | RankingSnapshot 90 dias; nenhum purge de outbox até capacidade, replay e legal hold serem aprovados | **Aguardando aprovação datada** | Operação | Antes de qualquer purge | Defaults conservadores; nenhum purge irreversível. |
| OD-04 | Data de retirada dos aliases e constraints legadas | Sem retirada no go-live; contract somente após telemetria | Aberta, pós-go-live | Tech lead | Após telemetria da Etapa 9 | Contract permanece bloqueado. |
| OD-05 | Canal externo de notificação e quiet hours | Somente inbox in-app | Aberta, fora do go-live | Product owner | Antes de habilitar push/e-mail | Push/e-mail permanecem desligados. |

As datas são gates relativos porque o plano é executado por prompts; cada
responsável deve registrar a decisão com data civil no ADR correspondente
antes de habilitar a feature. A implementação da proposta de OD-01 não
substitui a assinatura de produto/operação exigida pelo gate. OD-02 foi fechada
pelo product owner em 16/07/2026 ao aprovar palpites por dia para os jogos da
semana e partidas adiadas de rodadas anteriores.

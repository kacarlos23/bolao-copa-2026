# Registro de decisões abertas

Nenhuma decisão de schema necessária à Etapa 2 permanece aberta. Os itens
abaixo são deliberadamente posteriores e não autorizam suposição silenciosa.

| ID | Decisão | Proposta implementada | Status | Responsável | Data-limite | Impacto se não fechada |
|---|---|---|---|---|---|---|
| OD-01 | Fonte oficial primária e fallback operacional do Brasileirão | CBF oficial como primária; CSV/manual somente com artefato previamente reconciliado e o mesmo pipeline | **Aguardando aprovação datada** | Product owner + operação | Antes da exposição | Temporada não pode ser exposta. |
| OD-02 | `scoreableFrom`/`startsAtRound` exatos do pool do Brasileirão | Rodada 20; primeiro horário oficial em `2026-07-25T21:30:00.000Z`; histórico não pontuável | **Aguardando aprovação datada** | Product owner | Antes da exposição | Jogos históricos ficam apenas em standings. |
| OD-03 | Janela de retenção de outbox e snapshots em produção | RankingSnapshot 90 dias; nenhum purge de outbox até capacidade, replay e legal hold serem aprovados | **Aguardando aprovação datada** | Operação | Antes de qualquer purge | Defaults conservadores; nenhum purge irreversível. |
| OD-04 | Data de retirada dos aliases e constraints legadas | Sem retirada no go-live; contract somente após telemetria | Aberta, pós-go-live | Tech lead | Após telemetria da Etapa 9 | Contract permanece bloqueado. |
| OD-05 | Canal externo de notificação e quiet hours | Somente inbox in-app | Aberta, fora do go-live | Product owner | Antes de habilitar push/e-mail | Push/e-mail permanecem desligados. |

As datas são gates relativos porque o plano é executado por prompts; cada
responsável deve registrar a decisão com data civil no ADR correspondente
antes de habilitar a feature. A implementação das propostas de OD-01/OD-02 não
substitui a assinatura de produto/operação exigida pelo gate.

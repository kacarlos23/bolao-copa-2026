# Registro de decisões abertas

Nenhuma decisão de schema necessária à Etapa 2 permanece aberta. Os itens
abaixo são deliberadamente posteriores e não autorizam suposição silenciosa.

| ID | Decisão | Responsável | Data-limite | Etapa | Impacto se não fechada |
|---|---|---|---|---|---|
| OD-01 | Fonte oficial primária e fallback operacional do Brasileirão | Product owner + operação | Antes do Prompt 5 | 4/5 | Temporada não pode ser exposta. |
| OD-02 | `scoreableFrom`/`startsAtRound` exatos do pool do Brasileirão | Product owner | Antes da carga do Prompt 5 | 5 | Jogos históricos ficam apenas em standings. |
| OD-03 | Janela de retenção de outbox e snapshots em produção | Operação | Antes do Prompt 8 | 7/8 | Manter defaults conservadores e não executar purge irreversível. |
| OD-04 | Data de retirada dos aliases e constraints legadas | Tech lead | Após telemetria da Etapa 9 | contract futuro | Contract permanece bloqueado. |
| OD-05 | Canal externo de notificação e quiet hours | Product owner | Antes de habilitar push/e-mail | 7 | Usar somente inbox in-app. |

As datas são gates relativos porque o plano é executado por prompts; cada
responsável deve registrar a decisão com data civil no ADR correspondente
antes de habilitar a feature.

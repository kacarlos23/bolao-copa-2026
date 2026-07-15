# Evidência da Etapa 6 — frontend, UX/UI e acessibilidade

## Escopo entregue

A refatoração preserva os contratos e regras do backend e mantém a interface anterior disponível por feature flag. A nova organização incremental separa:

- `src/app`: shell e contexto de competição/temporada;
- `src/features/competitions`: seletor orientado a capabilities e workspace de temporada;
- `src/components`: estados assíncronos, toast, badge de time, placar e ranking;
- `src/services`: request, SSE e persistência/merge de drafts;
- `src/theme`: tokens visuais compartilhados.

Os payloads genéricos são validados na entrada com schemas de `@bolao/shared`. Os tipos locais de competição, temporada, rodada, partida, classificação, palpite e ranking agora são derivados desses contratos.

## Invariantes de draft e sincronização

- A chave persistida é `userId + poolSeasonId + escopo`, incluindo `matchId` ou `generationId` dentro do estado.
- Cada campo possui estado `clean`, `dirty`, `saving`, `saved` ou `failed`.
- Polling, SSE e respostas antigas atualizam apenas campos que não estão dirty.
- A troca de tela, competição ou temporada pede confirmação; `beforeunload` protege o fechamento da página.
- Salvamentos usam chave de idempotência, mantêm o draft em falha e exibem `Não salvo`, `Salvando`, `Salvo às HH:mm` ou `Falhou — tentar novamente`.
- No mata-mata, placares empatados exigem a escolha explícita do classificado antes do envio.

O teste de reducer cobre diretamente o caso em que uma resposta remota chega depois da edição local: o campo dirty permanece intacto e somente o campo limpo recebe a atualização.

## Requests e tempo real

O cliente central oferece timeout, `AbortController`, descarte por ordem de resposta, CSRF, código/status estruturado, validação Zod e mensagens específicas para 401, 403, 409 e 5xx. O cliente SSE valida envelopes, remove eventos duplicados, reconecta com backoff e jitter e expõe os estados `Ao vivo`, `Reconectando` e `Offline`.

## UX e acessibilidade

- `TeamBadge` usa escudo/bandeira e fallback textual estável.
- `ScoreInput` associa o placar ao nome e lado do time, usa teclado numérico, anuncia erro e preserva foco.
- `AsyncState` cobre skeleton, vazio, erro, retry e refresh com dado anterior.
- `Toast` usa live region sem bloquear o foco.
- Ranking destaca o usuário atual, líder da rodada, movimento, distância para o próximo rival e critérios de desempate.
- Alvos interativos têm no mínimo 44 px, foco visível e estado/role acessível.
- CSS, React Native Animated e GSAP respeitam `prefers-reduced-motion`.

## Paridade e flags

| Fluxo | V1 | V2 | Evidência |
| --- | --- | --- | --- |
| Login e navegação | preservado | preservado | E2E por teclado |
| Palpite diário | preenchimento e save individual | preenchimento e save por item/lote | E2E dedicado para cada versão |
| Mata-mata | contrato preservado | time por input e classificado no empate | E2E de empate e envio completo |
| Temporada/competição | Copa existente | seletor por capabilities | E2E de troca para Brasileirão |
| Ranking | ranking existente | contexto, movimento, rival e desempate | E2E de hierarquia e conteúdo |

`EXPO_PUBLIC_COMPETITION_UI_V2=1` habilita a experiência genérica. A tela legada de palpites permanece acessível por `EXPO_PUBLIC_LEGACY_PREDICTIONS=1`; o override `?predictions=v1` existe somente para prova automatizada de paridade. V1 não foi removida.

## Performance medida

Antes da divisão, o bundle principal medido era aproximadamente 1,99 MB. Depois da medição foram aplicadas fronteiras lazy para palpites, mata-mata, Brasileirão e administração:

- entrada principal: 1.975.227 bytes, aproximadamente 1,98 MB;
- `predictionBoard`: 55.012 bytes;
- `brasileirao2026`: 23.817 bytes;
- `brasileiraoAdmin`: 4.616 bytes;
- chunk comum: 48.574 bytes.

O teste com React Profiler registra um commit inicial e apenas um novo commit ao editar o `ScoreInput`. Nenhuma nova fronteira de `memo`, `useMemo` ou `useCallback` foi aplicada sem essa medição; o ganho adotado foi lazy loading no nível de feature.

## Matriz automatizada

Os testes de componente cobrem drafts, contratos de entrada, status HTTP, resposta obsoleta, acessibilidade do placar, estados assíncronos e commits de render. A suíte E2E cobre:

- login por teclado;
- palpite V1 e V2;
- mata-mata empatado;
- troca de competição/temporada;
- ranking;
- erros 401, 403, 409 e 500;
- reconnect/offline do SSE;
- larguras 320, 768, 1280 e 1440 px;
- auditoria WCAG 2 A/AA na entrada e nas telas autenticadas de palpite, mata-mata e ranking, além de reduced motion.

Comandos de gate: `npm run lint`, `npm test`, `npm run test:e2e` e `npm run build`.

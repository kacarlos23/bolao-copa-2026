# Evidência do Prompt 0 — preservação e hardening

Revisão concluída em 14/07/2026 sobre o commit-base `21bf051`. O restore drill
e os hashes anteriores estão em
[evidencia-preservacao-local.md](evidencia-preservacao-local.md); esta evidência
registra as pendências de hardening que foram encontradas e concluídas depois.

## Gates

| Gate | Evidência |
|---|---|
| Banco e avatares restauráveis | Dump custom, SHA-256, ZIP versionado e restore isolado documentados na evidência de preservação; fixture de avatar também foi restaurada e comparada por hash. |
| Hashes da Copa | Snapshot original e restaurado idênticos. `sessionVersion` é metadado de autenticação e foi explicitamente excluído do hash de negócio, sem excluir IDs, palpites, scores ou ranking. |
| Sessão revogada | `sessionVersion` é incrementado em bloqueio/desbloqueio e reset de senha; papel, status e versão são revalidados no servidor a cada request. Clientes SSE do usuário são drenados na revogação. Testes cobrem bloqueio, senha, papel e falha do store. |
| CSRF | Token vinculado à sessão, `Origin` e Fetch Metadata protegem mutações. Cliente web/native busca o token antes de cada mutação. Testes provam `403` para token/origem inválidos e passagem para autenticação com token válido. |
| Fechamento atômico | O prazo é relido e comparado dentro da mesma transação `SERIALIZABLE` do upsert; `now >= closesAt` falha. A chave e a simulação também revalidam geração/fixture dentro da transação. |
| Shutdown | HTTP server, SSE, heartbeat, jobs, pool de sessão e Prisma possuem owners explícitos. O shutdown é idempotente, espera os recursos e possui timeout com fechamento forçado das conexões HTTP. |
| Draft e sucesso parcial | Polling/SSE fora de ordem não sobrescrevem partidas dirty. A UI mostra `Não salvo`, `Salvando`, `Salvo` e `Falhou`, avisa no fechamento da aba e nunca abre o modal de sucesso total quando um dos domínios falha. |
| Avatar | `multer@2.2.0`, memory storage, limites de bytes/partes/campos, magic bytes, decode, limite de pixels, reencode WEBP, escrita atômica e limpeza de órfãos. |
| Provider e snapshots | Fetch externo usa timeout, limite de 5 MiB, redirect bloqueado e até dois retries somente para falhas transitórias. Snapshots têm retenção móvel de 90 dias. |

## Validação local

```text
npm run lint                 aprovado
npm test                     69 testes aprovados no gate integrado dos Prompts 0–2
npm run build                aprovado
npm run audit:dependencies   0 high, 0 critical; 13 moderate triados
```

A suíte inclui falhas de callback de sessão, revogação, CSRF negativo,
fake timers no instante de fechamento, resposta externa excessiva, timeout,
retry, shutdown com timeout, drenagem SSE, conteúdo de avatar disfarçado,
merge dirty e sucesso parcial.

## Triagem de dependências

- `multer` foi atualizado isoladamente de `2.1.1` para `2.2.0` e os testes de
  upload passaram.
- `undici` transitivo do Expo foi fixado em `6.27.0`; os avisos high deixaram de
  aparecer.
- Os 13 avisos moderate restantes pertencem à cadeia Expo 54/CLI
  (`@expo/*`, `postcss`, `uuid`/`xcode`) e a correção sugerida pelo npm exige
  upgrade major para Expo 57. Esse upgrade foi adiado para uma entrega isolada,
  pois não há exploração por payload de negócio no runtime da API e uma
  atualização forçada quebraria a matriz Expo/React Native atual.
- O aviso low de `esbuild@0.28.0` foi removido por atualização compatível.
- `vitest` foi atualizado de 2.1.9 para 4.1.10. Isso removeu a vulnerabilidade
  crítica direta e as duas altas transitivas de Vite/form-data; as suítes e os
  builds foram repetidos depois da atualização.
- Não foi usado `npm audit fix --force`.

Não permanece P0/P1 do Prompt 0 aberto. A repetição de um restore drill no
host atual depende de PostgreSQL ou Docker em execução; o ensaio aprovado e
seus artefatos locais foram preservados e continuam verificáveis.

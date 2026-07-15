# Etapa 9 — testes obrigatórios e release gates

Data da execução local: 2026-07-15 (America/Sao_Paulo).

## Decisão

**NO-GO para go-live.** Os gates locais de PR, release candidate e migration passaram, mas o gate protegido de go-live recusou a promoção porque as evidências externas obrigatórias ainda não foram fornecidas. A Etapa 9 não autoriza promoção enquanto qualquer P0/P1 estiver aberto ou enquanto a execução do workflow no provedor de CI não estiver verde.

## Resultado dos gates

| Gate | Resultado local | Duração observada | Evidência |
| --- | --- | ---: | --- |
| PR | PASS | 98,1 s | lint; 15 preservação/gate; 30 shared; 109 API; 19 componentes; 24 contratos; audit; builds; budget |
| Release candidate | PASS | 155,6 s | PostgreSQL real; 42 E2E; carga; duas repetições de contratos e componentes |
| Migration | PASS | 23,5 s | backup sanitizado; avatar; restore; 12 migrations; backfill dry-run; rollback por flags; hashes |
| Go-live | **FAIL esperado sem ambiente** | — | gate v2 exige smoke, reconciliação, observabilidade e rehearsal operacional assinados |
| Workflow remoto | **NÃO EXECUTADO** | — | requer execução no GitHub Actions após publicação da branch/tag |

O workflow `.github/workflows/release-gates.yml` usa `npm ci` em todos os jobs, Node 24, PostgreSQL 18 real, Chromium instalado no RC e jobs separados para PR, release candidate, migration e go-live. O RC gera manifesto com commit, tag, lockfile, schema, migrations, workflow e provider. O job de go-live usa o ambiente protegido `production` e só aceita JSON sanitizado vindo de secrets, assinado com HMAC e vinculado ao `github.sha`.

## Cobertura por risco

| Risco | Camada/evidência | Situação |
| --- | --- | --- |
| Pontuação, desempate, ranking histórico e gamificação | unitários shared/API; regras versionadas; replay e scoreability | Coberto, PASS |
| Standings, timezone e fechamento no instante exato | unitários e integração com clock/instantes determinísticos | Coberto, PASS |
| Providers, import e dependência externa | fixtures locais de GE/CBF/CSV; idempotência, override, quarantine, documentos fixados e standings | Coberto localmente; CI não acessa GE/CBF ao vivo |
| Dependências | audit completo e de produção, bloqueio de high/critical | PASS: 0 high e 0 critical; 13 moderadas da cadeia Expo 54 triadas |
| Migration/backfill e constraints | banco efêmero PostgreSQL com 12 migrations, dry-run, unicidade e isolamento | Coberto, PASS |
| Sessão, CSRF, concorrência e isolamento entre temporadas | integração PostgreSQL e contratos HTTP | Coberto, PASS |
| Outbox e ranking transacional | commit/rollback, deduplicação e snapshots isolados | Coberto, PASS |
| API/SSE | schemas, aliases da Copa, membership, reconexão, backpressure, bloqueio e shutdown | Coberto, PASS |
| Frontend | drafts, feedback, ranking, mata-mata, erros, estados assíncronos e reduced motion | Coberto, PASS |
| Jornada responsiva | login/logout, palpite, limite, troca de competição, ranking e admin em Desktop Chrome e Pixel 5 | 42/42, PASS |
| Acessibilidade | WCAG A/AA via axe, teclado, nomes acessíveis, contraste, switches e reduced motion | Coberto, PASS |
| Carga e bundle | ranking de 10 mil linhas, SSE 100×50; JS total 2.215.232/2.400.000 bytes | Coberto, PASS |
| Continuidade | backup sanitizado, 1 avatar, restore drill, migration rehearsal e rollback por três flags | Coberto, PASS |
| Produção real | smoke, reconciliação com fonte oficial e observabilidade | **Ausente, FAIL** |

## Ensaio de continuidade e preservação

- Banco de origem criado apenas com fixtures sanitizadas e sem credenciais reais.
- Backup PostgreSQL em formato custom validado, objetos globais sem senhas e arquivo de avatar validado por SHA-256.
- Restore realizado em banco temporário isolado; nenhuma migration pendente após o restore.
- Backfill pós-restore executado em `--dry-run`, sem órfãos, duplicidades ou relações fora do escopo.
- Rollback comprovado com `readEnabled=false`, `writeEnabled=false` e `uiEnabled=false`.
- Hash lógico da Copa antes/depois: `efacdbaed1b48b5080cb4cbe2acbdab9af6c6b33aaebfdcac97de644efd2f63e`.
- `copaContentHashesPreserved=true`; snapshots antes, após migration e após rollback são idênticos.

## Flakiness, duração e artefatos

Budget de flakiness crítico: zero. Foram executadas duas rodadas de contratos e componentes, totalizando quatro execuções e zero flakes. Durações registradas: contratos 10.133/10.937 ms e componentes 8.189/7.724 ms.

Os artefatos locais ficam em `output/release-gates/`. Os relatórios produzidos pelos runners da Etapa 9 declaram `pii:false`; o JSON nativo do Playwright e os snapshots contêm somente nomes, IDs e dados sintéticos. O conjunto inclui `playwright.json`, `postgres-integration.json`, `flakiness.json`, `performance-budget.json`, snapshots da Copa, `migration-restore-rollback.json` e `go-live-external.json`. O diretório é ignorado pelo Git e publicado pelo CI com retenção limitada. Screenshots e traces só são retidos em falha.

## Defeitos comprovados e corrigidos no escopo

1. O cache do export web mantinha um bundle sem flags durante E2E. O servidor E2E agora faz export limpo e determinístico.
2. Fixtures de liga não respondiam regras e engagement, fazendo o carregamento atômico terminar vazio. Foram adicionadas respostas locais aderentes ao contrato.
3. Ações do canário administrativo não expunham papel de botão. Os papéis acessíveis foram adicionados.
4. Switches de preferências não emitiam `aria-checked`. O estado ARIA explícito foi adicionado.
5. O fallback compacto de bandeira tinha contraste insuficiente. A cor foi ajustada para cumprir o gate.
6. O runner de rehearsal perdia aspas em caminhos Windows com espaços. As ferramentas agora são invocadas sem shell intermediário.

Não foram feitas correções funcionais amplas; todos os ajustes acima nasceram de falhas reproduzíveis da matriz da Etapa 9.

## P0/P1 abertos

- P0: nenhum conhecido.
- **P1-EXT-001:** executar smoke autenticado no ambiente real e anexar evidência v2 assinada para mobile e desktop.
- **P1-EXT-002:** reconciliar os dados publicados com a fonte oficial no ambiente real e anexar evidência sanitizada.
- **P1-EXT-003:** comprovar dashboard e ciclo disparo/recuperação dos seis alertas, sem PII.
- **P1-EXT-004:** anexar rehearsal operacional derivado de backup sanitizado de produção, hashes da Copa, flags auditadas e rollback.
- **P1-CI-001:** executar o workflow remoto completo em uma tag `rc-*` ou por `workflow_dispatch` e obter todos os jobs verdes.

Somente após fechar os P1 externos, repetir `workflow_dispatch` com `gate=go-live`. O gate continuará falhando fechado se um secret estiver ausente, inválido, expirado, pertencer a outro commit/ambiente, tiver assinatura incorreta, conteúdo mínimo incompleto ou declarar `pii:true`. O contrato está em [go-live-evidence-contract.md](go-live-evidence-contract.md).

## Comandos de reprodução

```text
npm run gate:pr
npm run gate:release-candidate
npm run gate:migration
npm run gate:go-live
```

O último comando deve falhar fora do ambiente protegido enquanto as quatro evidências externas e a chave HMAC não existirem.

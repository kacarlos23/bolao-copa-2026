# Evidência de remediação da auditoria de go-live — 2026-07-15

## Resultado

As pendências implementáveis no repositório e no ambiente local foram
remediadas. O status de promoção continua **NO-GO**, agora somente pelos gates
que exigem candidato remoto imutável, aprovação humana datada e evidência do
ambiente de produção. Nenhuma flag foi aberta e nenhum deploy, push, tag ou
alteração de produção foi executado.

## Remediações aplicadas

- Gate externo v2: quatro evidências, schema mínimo, ambiente, commit SHA,
  validade máxima, referências HTTPS com SHA-256 e HMAC. Testes cobrem sucesso,
  SHA divergente, expiração, adulteração e recuperação de alerta ausente.
- Feature flags: ausência de registro agora resulta em `false/false/false`.
- CBF: URLs vigentes, SHA-256/tamanho dos PDFs, 38 rodadas, standings oficiais
  e comparação semântica de J/V/E/D/GP/GC/PTS.
- Carga canário local: 20 clubes, 38 rodadas, 380 referências, 235 partidas com
  horário oficial, 145 ainda sem horário, 177 resultados e 20 standings. A
  segunda carga teve zero inserts e zero quarentenas; rodada 20 possui dez jogos.
- Segurança: Vitest 4.1.10 e lockfile atualizado; zero critical/high/low e 13
  moderadas da cadeia Expo 54, registradas para migração major isolada.
- CI: audit no PR/RC, manifesto imutável do candidato/tag e quatro secrets de
  evidência protegida.
- Concorrência: retry limitado com backoff para conflito serializável `P2034`;
  três execuções PostgreSQL consecutivas passaram depois da correção.
- Rastreabilidade dedicada criada para Prompts 4, 5, 7 e 8.

## Evidência local fresca

- `gate:pr`: PASS em 98,1 s; 15 testes de preservação/gate, 30 shared, 109 API,
  19 componentes, 24 contratos, lint, builds e budget de 2.215.232 bytes.
- `gate:release-candidate`: PASS em 155,6 s; integração PostgreSQL, 42/42 E2E,
  dois testes de carga e duas rodadas de contratos/componentes sem flakes.
- `gate:migration`: PASS em 23,5 s; backup sanitizado, avatar, restore isolado,
  12 migrations, backfill dry-run, rollback e snapshots idênticos.
- Reconciliação CBF ao vivo: PASS; checksum determinístico
  `176fb90b4213cba3c1042ab0779443d11eec309b61966215bf2b289a5ad62ffb`
  repetido em duas coletas; zero diferenças de standings.
- Carga local: flags `false/false/false`; snapshot da Copa antes/depois idêntico.
- Regressão de concorrência: unitários focados 6/6 e integração PostgreSQL 3/3.

Os artefatos sanitizados estão em `output/release-gates/` e permanecem
ignorados pelo Git.

## Gates externos ainda fechados

1. Aprovação datada de OD-01/OD-02 por Produto/Ops e OD-03 antes de purge.
2. Commit limpo publicado, tag `rc-*` e jobs GitHub Actions verdes. O branch
   remoto ainda aponta para `8052fba11227e8bf1acdc44d14c5a6809c61ee43` e não
   contém o candidato local auditado.
3. Smoke autenticado de produção em mobile/desktop para o SHA candidato.
4. Dashboard e ciclo real de disparo/recuperação dos seis alertas.
5. Backup sanitizado derivado de produção, restore isolado, hashes da Copa,
   estado/auditoria das flags e rollback vinculados ao candidato.

O contrato para fornecer esses itens está em
[go-live-evidence-contract.md](go-live-evidence-contract.md). O gate continua
fail-closed até que todos pertençam ao mesmo SHA e à mesma janela operacional.

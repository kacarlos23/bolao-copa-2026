# Registro de risco de dependências — 2026-07-29

`npm run audit:dependencies` executa o audit completo e `--omit=dev`, publica
`dependency-audit.json` e bloqueia qualquer vulnerabilidade `high` ou `critical`
que não tenha uma correção upstream verificável e uma exceção exata, curta e
datada.

## Corrigido

- PostCSS `8.4.49` foi substituído por `8.5.19` somente na cadeia
  `@expo/metro-config`. Essa versão cobre os avisos
  `GHSA-6g55-p6wh-862q` e `GHSA-r28c-9q8g-f849` sem exigir a migração
  incompatível para Expo 57.
- As três linhas usadas de `brace-expansion` foram fixadas em `1.1.17`,
  `2.1.3` e `5.0.8`. As linhas 1 e 2 são backports oficiais do mantenedor para
  `CVE-2026-14257` e preservam o contrato CommonJS esperado por
  minimatch/glob antigos.
- O auditor agora falha fechado em erro operacional, JSON inválido, versão
  inesperada, advisory novo, `critical` ou exceção expirada.
- O runtime da API, auditado isoladamente, permanece com zero vulnerabilidades.

## Exceção temporária do feed

O advisory `GHSA-mh99-v99m-4gvg` ainda declara a faixa genérica `<=5.0.7` e,
por isso, marca incorretamente os backports `1.1.17` e `2.1.3`. A exceção em
[`dependency-audit-waivers.json`](dependency-audit-waivers.json) vale apenas
para esse GHSA e somente se todos os nós do lockfile estiverem nas versões
corrigidas. Ela expira em `2026-08-12`; qualquer versão anterior ou qualquer
outro advisory continua bloqueando PR e RC.

Evidências upstream:

- backport v1: <https://github.com/juliangruber/brace-expansion/commit/cb4b9e47cc2ec777c14b2b4492fb431a56f6a031>
- backport v2: <https://github.com/juliangruber/brace-expansion/commit/d13ff455a58b0d56704f0111e3c2a0b16ceb06eb>

## Risco moderado residual

Os avisos moderados restantes pertencem ao toolchain Expo 54 e a `uuid/xcode`.
O `xcode@3.0.1` usa `uuid.v4()`, enquanto o advisory de `uuid` afeta os caminhos
v3/v5/v6 com buffer. Forçar `uuid@11` ultrapassaria a faixa suportada pelo
consumidor. A migração do SDK deve ocorrer em branch própria com
`expo install --fix`, matriz web/native, login, drafts, SSE, acessibilidade,
E2E mobile/desktop, build e novo audit.

Em produção, gere o `dist` estático e configure `EXPO_PUBLIC_API_URL` no build
quando frontend e API estiverem em origens/portas diferentes. Não exponha o
servidor de desenvolvimento Expo/Metro como servidor público permanente.

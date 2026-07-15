# Registro de risco de dependências — 2026-07-15

`npm run audit:dependencies` executa audit completo e `--omit=dev`, publica
`dependency-audit.json` e bloqueia qualquer vulnerabilidade high ou critical.

## Corrigido

- Vitest 2.1.9 → 4.1.10: removeu a crítica direta de servidor UI e as altas
  transitivas de Vite e form-data.
- Atualizações compatíveis de lockfile removeram o aviso low de esbuild.
- Resultado atual: zero critical, zero high, 13 moderate.

## Risco moderado residual

Os 13 avisos pertencem ao toolchain Expo 54 (`expo`, CLI/config/metro,
expo-asset/constants/linking/router, postcss e uuid/xcode). A correção indicada
pelo npm instala Expo 57 e é uma migração major; `npm audit fix --force` não é
permitido no release.

Mitigação atual: o runtime da API não carrega essa cadeia; servidores Expo/Metro
não são expostos em produção; CI usa build estático; high/critical bloqueiam PR
e RC. A migração deve ocorrer em branch própria com `expo install --fix`, matriz
web/native, login, drafts, SSE, acessibilidade, E2E mobile/desktop, build e novo
audit. Critério de saída: zero high/critical e nenhuma regressão funcional; os
moderados remanescentes precisam de exceção datada do responsável de plataforma.

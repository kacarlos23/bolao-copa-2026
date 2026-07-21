# Gate de genericidade do runtime

O arquivo [`runtime-genericity-allowlist.json`](runtime-genericity-allowlist.json) é a fonte
auditável das únicas exceções em que slugs conhecidos podem aparecer em seleção fixa:
aliases de URL anteriores e comandos de seed/backfill explicitamente direcionados.

A allowlist não autoriza escolha de provider, scheduler, standings, workspace/tela ou fallback.
Esses comportamentos devem ser derivados de capabilities, stages, rule sets e da configuração
validada de providers na metadata da temporada. Testes, fixtures e migrations históricas não são
código de seleção do runtime e ficam fora da varredura.

`npm run lint:genericity` falha ao encontrar comparações literais, `switch`, lookup de
comportamento ou busca por slug fixo fora dessa lista. Também falha se a lista crescer para além
do limite revisável ou tentar incluir as camadas proibidas.

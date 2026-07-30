# Auto deploy da produção Windows

Este runbook descreve o deploy automático aprovado para a produção. O fluxo é:

```text
push em main
  -> release-gates em runners Ubuntu
  -> manifesto imutável do SHA aprovado
  -> workflow_run
  -> inspeção no runner bolao-production
  -> deploy automático sem migration
     ou aprovação em production-migration antes da migration
```

O primeiro rollout deve permanecer com `AUTO_DEPLOY_ENABLED=false`. Somente
ative depois do dry-run, do deploy controlado e do ensaio de rollback.

## Limite de segurança

O repositório é público e o runner é persistente. Um workflow malicioso que
alcance esse runner pode comprometer permanentemente a máquina de produção.
Labels e environments não isolam o host. Por isso:

- nenhum evento `pull_request` executa no runner `bolao-production`;
- workflows de colaboradores externos exigem aprovação;
- o checkout de produção não persiste credenciais;
- o workflow recebe apenas `contents: read` e `actions: read`;
- nenhum segredo da aplicação é armazenado no GitHub;
- o usuário do serviço não deve possuir privilégios administrativos;
- o runner deve ser exclusivo deste repositório.

Essas medidas reduzem o risco, mas não tornam seguro um runner persistente em
repositório público. Para eliminar essa classe de risco, migre futuramente para
um repositório privado ou para um agente de deploy isolado e descartável.

## Responsabilidades

O proprietário `kacarlos23` precisa executar as configurações do GitHub e
registrar o runner. Uma conta com permissão `write` não consegue concluir essas
etapas.

Na máquina de produção, use o mesmo usuário Windows que controla o PM2. Não
execute o runner como `LocalSystem` nem com outro `PM2_HOME`.

Pré-requisitos no `PATH` desse usuário:

- Git for Windows;
- Node.js 24 e npm;
- PM2 já associado aos processos `bolao-api` e `bolao-web`;
- cliente PostgreSQL 18 (`psql`, `pg_dump`, `pg_dumpall` e `pg_restore`);
- PowerShell 5.1 ou superior;
- `cloudflared` configurado como serviço.

## Estrutura persistente

O bootstrap cria e valida:

```text
C:\ProgramData\Bolao\
  config\production.env
  releases\<sha>\
  shared\uploads\avatars\
  backups\
  logs\
  state\deployment.json
  state\auto-deploy.disabled
```

O diretório `releases` contém código e builds. Configuração, uploads, backups e
estado ficam fora das releases e sobrevivem a rollback.

Execute em PowerShell, na raiz de um checkout confiável:

```powershell
npm run deploy:bootstrap -- `
  -ProductionRoot "C:\ProgramData\Bolao" `
  -EnvironmentFile "C:\ProgramData\Bolao\config\production.env" `
  -ApplyAcl
```

O bootstrap não inventa segredos nem ativa o deploy. Restrinja a ACL de
`production.env`, `backups` e `state` ao usuário do runner/PM2 e aos
administradores responsáveis.

## Arquivo de ambiente externo

Crie `C:\ProgramData\Bolao\config\production.env` sem colocar valores reais no
GitHub:

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://USUARIO:SENHA@HOST:5432/BANCO?schema=public
SESSION_SECRET=SUBSTITUA_POR_UM_SEGREDO_FORTE
INTERNAL_EVENTS_SECRET=SUBSTITUA_POR_OUTRO_SEGREDO_FORTE
WEB_ORIGIN=https://bolao.example.com
WEB_ORIGINS=https://bolao.example.com
SESSION_COOKIE_SECURE=true
APP_RELEASE_SHA=bootstrap
AVATAR_UPLOAD_DIR=C:\ProgramData\Bolao\shared\uploads\avatars
PRODUCTION_WEB_URL=https://bolao.example.com
PRODUCTION_API_URL=https://api.bolao.example.com
AUTO_DEPLOY_ENABLED=false
```

Use HTTPS. Frontend e API devem estar no mesmo hostname ou em subdomínios do
mesmo domínio registrável. Uma API em site diferente quebra as premissas de
cookie `SameSite=Lax` e da proteção CSRF.

`APP_RELEASE_SHA` é substituído pelo script durante a ativação de cada release.
O script nunca registra `DATABASE_URL`, senhas ou secrets em
`deployment.json`.

## Uploads existentes

Antes do primeiro deploy, o bootstrap pode copiar os avatares legados para
`shared\uploads\avatars`. A validação compara quantidade, tamanho e SHA-256.
Mantenha a origem intacta até a validação final.

```powershell
npm run deploy:bootstrap -- `
  -ProductionRoot "C:\ProgramData\Bolao" `
  -EnvironmentFile "C:\ProgramData\Bolao\config\production.env" `
  -LegacyAvatarDirectory "C:\caminho\atual\apps\api\uploads\avatars"
```

## Baseline obrigatória de rollback

O primeiro deploy automático é recusado enquanto não existir uma release
anterior validada. Antes de habilitar o workflow, faça um rollout manual
controlado do SHA-base com os novos contratos `/health`, `/ready` e SHA da web.
Confirme que esse SHA está ativo no PM2 e registre uma cópia sem `.env`, uploads,
logs, backups nem metadados do runner:

```powershell
npm run deploy:bootstrap -- `
  -ProductionRoot "C:\ProgramData\Bolao" `
  -EnvironmentFile "C:\ProgramData\Bolao\config\production.env" `
  -BaselineReleasePath "C:\caminho\da\release-base-validada" `
  -BaselineSha "<sha-git-completo-da-release-base>" `
  -RegisterBaseline `
  -ApplyAcl
```

O bootstrap confere PM2 e os endpoints locais contra o SHA antes de registrar
`deployment.json`. Não use `-SkipPm2Check` no rollout de produção. Depois,
execute um rollback controlado para a própria cópia registrada e confirme que
ela também inicia fora do diretório antigo.

## Runner self-hosted

No GitHub, como proprietário:

1. Abra **Settings > Actions > Runners > New self-hosted runner**.
2. Escolha Windows x64 e instale em `C:\actions-runner-bolao`.
3. Registre somente neste repositório, com a label exclusiva
   `bolao-production`.
4. Instale como serviço sob o usuário Windows atual que controla o PM2.
5. Confirme nesse mesmo usuário:

   ```powershell
   whoami
   pm2 ping
   pm2 list
   ```

6. Exija aprovação de workflows enviados por colaboradores externos.
7. Bloqueie force-push e deleção da branch `main`.

Não adicione secrets de banco ou da aplicação ao runner ou ao environment do
GitHub. O token temporário do job serve apenas para baixar o artefato aprovado.

## Environments e variáveis

Crie os environments:

- `production`: sem aprovação, para releases sem migration;
- `production-migration`: com aprovação obrigatória de outro colaborador e
  autoaprovação impedida.

Cadastre em ambos apenas estas variáveis não secretas:

| Variável              | Exemplo                                      |
| --------------------- | -------------------------------------------- |
| `PRODUCTION_ROOT`     | `C:\ProgramData\Bolao`                       |
| `PRODUCTION_ENV_FILE` | `C:\ProgramData\Bolao\config\production.env` |
| `PRODUCTION_WEB_URL`  | `https://bolao.example.com`                  |
| `PRODUCTION_API_URL`  | `https://api.bolao.example.com`              |
| `AUTO_DEPLOY_ENABLED` | `false` no primeiro rollout                  |

O kill switch é duplo. Qualquer uma destas condições bloqueia uma nova
ativação:

- `AUTO_DEPLOY_ENABLED=false`;
- existência de
  `C:\ProgramData\Bolao\state\auto-deploy.disabled`.

O bloqueio não derruba a release atual.

## Primeiro rollout

Com o runner configurado e o kill switch ainda ativo:

```powershell
npm run deploy:inspect -- `
  -TargetSha "<sha-de-40-caracteres>" `
  -ManifestPath "<caminho-do-manifesto>" `
  -SourceRoot "<checkout-do-runner>" `
  -ProductionRoot "C:\ProgramData\Bolao" `
  -EnvironmentFile "C:\ProgramData\Bolao\config\production.env"

npm run deploy:production -- `
  -TargetSha "<sha-de-40-caracteres>" `
  -ManifestPath "<caminho-do-manifesto>" `
  -SourceRoot "<checkout-do-runner>" `
  -ProductionRoot "C:\ProgramData\Bolao" `
  -EnvironmentFile "C:\ProgramData\Bolao\config\production.env" `
  -ApiUrl "https://api.bolao.example.com" `
  -WebUrl "https://bolao.example.com" `
  -DryRun
```

O dry-run não recarrega processos nem aplica migration. Depois de revisar o
resultado:

1. remova `state\auto-deploy.disabled`, se existir;
2. altere `AUTO_DEPLOY_ENABLED=true` no arquivo externo;
3. altere a variável pública de ambos os environments para `true`;
4. faça um push controlado em `main`;
5. confirme `/health`, `/ready`, PM2, login, CORS/CSRF e o SHA;
6. execute um ensaio de rollback para a release anterior.

O smoke test operacional pode ser repetido sem credenciais reais:

```powershell
npm run deploy:smoke -- `
  -ExpectedSha "<sha-de-40-caracteres>" `
  -ApiUrl "https://api.bolao.example.com" `
  -WebUrl "https://bolao.example.com"
```

## Migrations e backup

O preflight compara as migrations locais com `_prisma_migrations`. Ele bloqueia
drift, checksum alterado e migration parcialmente aplicada.

Sem migration pendente, o environment `production` segue automaticamente. Com
migration pendente, o job aguarda aprovação em `production-migration`, para
writers conhecidos, cria e valida dump, globais e avatares e somente então
executa:

```powershell
npm run prisma:migrate:deploy
```

Produção nunca executa `prisma migrate dev`, `seed` ou restore automático.
Migrations devem seguir expand–migrate–contract e manter a release anterior
compatível.

Uma falha depois da migration restaura somente o código/processos anteriores.
O banco e o backup são preservados para intervenção humana.

## Rollback e manutenção

Para impedir novos deploys:

```powershell
New-Item -ItemType File -Force `
  "C:\ProgramData\Bolao\state\auto-deploy.disabled"
```

Para reativar, remova somente esse arquivo depois de resolver o incidente e
confirmar `AUTO_DEPLOY_ENABLED=true`.

O deploy faz rollback automático da aplicação quando um healthcheck falha após
o reload. Um rollback manual explícito pode ser feito com:

```powershell
npm run deploy:rollback -- `
  -ProductionRoot "C:\ProgramData\Bolao" `
  -EnvironmentFile "C:\ProgramData\Bolao\config\production.env" `
  -ApiUrl "https://api.bolao.example.com" `
  -WebUrl "https://bolao.example.com" `
  -TargetSha "<sha-anterior>"
```

Nunca use rollback da aplicação como autorização para restaurar ou reverter o
banco.

## Critérios de aceite

Antes de considerar o auto deploy ativo, registre evidência de que:

- o SHA implantado é exatamente o aprovado por `release-gates`;
- um SHA obsoleto ou manifesto adulterado é recusado;
- nenhuma execução de PR chega ao runner;
- migration exige aprovação e backup validado;
- `/health` e `/ready` expõem somente estado e SHA;
- API `3001`, web `8080`, PM2 e URLs Cloudflare passam no smoke test;
- falha de healthcheck restaura a release anterior;
- três releases bem-sucedidas são mantidas e backups não são apagados.

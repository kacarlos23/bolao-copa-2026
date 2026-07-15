# Operação

## Portas

- Frontend Expo Web: `8080`.
- API Express: `3001`.
- PostgreSQL do projeto: `5433`.

O Cloudflare Tunnel atual deve apontar para `http://localhost:8080`.

## PM2

Build inicial:

```powershell
npm install
npm run prisma:generate
npm run build
npm run seed
```

Se estiver usando o cluster PostgreSQL dedicado criado na pasta do projeto, inicie antes:

```powershell
npm run postgres:start
```

Subir processos:

```powershell
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Depois de rodar `pm2 startup`, execute o comando que o PM2 imprimir para registrar o serviço no Windows.

## Cloudflare Tunnel como serviço

Se o tunnel já existe, confirme que ele está instalado como serviço:

```powershell
cloudflared service install
```

Verifique o status no Windows Services ou com:

```powershell
Get-Service cloudflared
```

O tunnel deve encaminhar o subdomínio para `http://localhost:8080`.

## Baseline de preservação da Copa 2026

Todos os comandos abaixo devem ser executados na raiz do repositório. Use variáveis de ambiente da sessão, um cofre de segredos ou um arquivo `.env` local ignorado. Nunca grave a URL real do banco, senha, `.pgpass`, dumps, manifestos ou snapshots no Git. A verificação `npm run lint:preservation` falha se uma dessas classes de arquivo estiver rastreada.

Os scripts não exibem a URL nem passam a senha na linha de comando dos utilitários PostgreSQL. A senha existe apenas no ambiente do processo filho durante a execução. Restrinja também as permissões de leitura do diretório de backup no sistema operacional.

### Credenciais locais de desenvolvimento e teste

Estas credenciais são públicas e deliberadamente fracas. Use-as somente nesta máquina de desenvolvimento, limitada a `localhost`; nunca as reutilize em produção ou em um servidor acessível pela rede.

| Serviço                     | Usuário    | Senha            | Destino                          |
| --------------------------- | ---------- | ---------------- | -------------------------------- |
| PostgreSQL local            | `postgres` | `postgres`       | `localhost:5432/bolao_copa_2026` |
| Administrador do aplicativo | `admin`    | `dev-admin-2026` | Login local da aplicação         |

Para aplicar migrations e semear/redefinir o administrador local:

```powershell
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/bolao_copa_2026?schema=public"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_NICKNAME = "Administrador Local"
$env:ADMIN_PASSWORD = "dev-admin-2026"
npm run prisma:migrate
npm run seed
```

O seed faz `upsert` do administrador e troca seu hash de senha. Portanto, gere a baseline somente depois do seed.

Configuração da sessão:

```powershell
$env:BACKUP_DATABASE_URL = "postgresql://<usuario>:<senha>@<host>:<porta>/<banco-da-copa>"
$env:BACKUP_DIR = "C:\Backups\bolao-copa-2026"
$env:RESTORE_MAINTENANCE_DATABASE_URL = "postgresql://<usuario-com-createdb>:<senha>@<host>:<porta>/postgres"
$env:SNAPSHOT_DATABASE_URL = $env:BACKUP_DATABASE_URL
$env:BACKUP_AVATAR_DIR = ".\apps\api\uploads\avatars"
```

Se os binários PostgreSQL não estiverem no `PATH`, configure `PG_DUMP_PATH`, `PG_DUMPALL_PATH`, `PG_RESTORE_PATH`, `CREATEDB_PATH` e `DROPDB_PATH`. No Windows, os scripts também procuram automaticamente a versão mais recente em `C:\Program Files\PostgreSQL`.

### 1. Snapshot lógico anterior

O snapshot abre uma transação `REPEATABLE READ READ ONLY`. Ele não contém horário de geração nem dados de conexão; com o banco inalterado, duas execuções produzem o mesmo JSON byte a byte.

```powershell
npm run snapshot:copa -- --output .\snapshots\world-cup-2026-before.json
Get-FileHash .\snapshots\world-cup-2026-before.json -Algorithm SHA256
```

O arquivo registra:

- usuários ativos, partidas, palpites, pontuações e fixtures do mata-mata;
- palpites separados entre partidas, chaves e simulações, e pontuações separadas entre fase de grupos e mata-mata;
- ranking atual — ou final quando não houver placares ao vivo — dos participantes ativos;
- pontos, pontos finais e acertos de cada participante, inclusive participantes bloqueados para fins de auditoria.

Além dos totais, `contentHashes` guarda SHA-256 determinístico do conteúdo de cada tabela pública. Assim, uma troca de palpite ou outro valor persistido é detectada mesmo quando as contagens e o ranking continuam iguais. Os valores das linhas, inclusive hashes de senha, não são gravados no snapshot.

O desempate do ranking replica pontos, placares exatos, resultados, um gol de uma equipe, menor número de erros e apelido; `userId` é o desempate final determinístico quando todos os campos anteriores coincidirem.

### 2. Backup completo e validação

Para uma baseline final consistente entre referências do banco e arquivos, interrompa gravações da API e jobs locais durante snapshot e backup.

```powershell
npm run backup
```

O comando produz um conjunto timestampado e indivisível de preservação:

- dump custom completo do banco, sem ownership/ACL;
- `*.globals.sql` com roles, memberships e tablespaces, deliberadamente sem hashes de senha;
- `*.avatars.zip` com todos os arquivos de `apps/api/uploads/avatars` e manifesto contendo tamanho/SHA-256 de cada avatar;
- manifesto principal `*.dump.metadata.json` com data UTC, tamanho, SHA-256 e referências cruzadas dos artefatos.

Antes de concluir, o script exige que `pg_restore --list` leia o catálogo, valida ZIP e arquivos de avatar e confere todos os tamanhos e checksums.

Para validar outra vez, de forma independente:

```powershell
npm run backup:validate -- -BackupFile "C:\Backups\bolao-copa-2026\bolao-world-cup-2026-YYYYMMDD-HHMMSSfffZ.dump"
```

As senhas das roles não são exportadas no arquivo global para evitar material autenticador no backup. Em recuperação para um cluster novo, aplique o `*.globals.sql` como superusuário e defina as senhas a partir do cofre do ambiente; nesta máquina local, use as credenciais públicas de teste documentadas acima.

### 3. Restore drill em banco temporário

O restore cria exclusivamente um banco novo cujo nome começa com `bolao_restore_verify_`. Ele não usa `--clean`, não aceita como destino o banco de manutenção e remove o banco temporário ao terminar. A conta de manutenção precisa de permissão `CREATEDB`.

```powershell
npm run restore -- `
  -BackupFile "C:\Backups\bolao-copa-2026\bolao-world-cup-2026-YYYYMMDD-HHMMSSfffZ.dump" `
  -ExpectedSnapshot ".\snapshots\world-cup-2026-before.json" `
  -VerificationSnapshotFile ".\snapshots\world-cup-2026-restored.json"
```

O fluxo valida dump, globais, avatares e manifestos, cria o banco temporário, restaura com `--exit-on-error`, gera o snapshot lógico do restore, compara com o snapshot esperado, extrai e confere os avatares em diretório isolado e só então remove os destinos temporários. Use `-KeepTemporaryDatabase` ou `-KeepAvatarVerificationDir` apenas para diagnóstico explícito; nesse caso, o operador assume a remoção posterior.

### 4. Comparação antes/depois e prova de não mutação

Depois das mudanças ou de uma verificação operacional, gere um segundo snapshot do banco original e compare:

```powershell
npm run snapshot:copa -- --output .\snapshots\world-cup-2026-after.json
npm run snapshot:compare -- `
  .\snapshots\world-cup-2026-before.json `
  .\snapshots\world-cup-2026-after.json
```

O comparador retorna código `0` apenas para snapshots semanticamente idênticos, `1` para divergência e `2` para arquivo/uso inválido. O teste automatizado do contrato roda em `npm run test`.

Backfills que preenchem as novas FKs devem usar o modo de preservação de dados
de negócio. Ele mantém o snapshot físico existente e acrescenta hashes que
desconsideram somente os campos estruturais esperados:

```powershell
npm run snapshot:copa -- --backfill --output .\snapshots\before.json
npm run snapshot:compare -- --backfill .\snapshots\before.json .\snapshots\after.json
```

O procedimento completo do backfill da Copa está em
[backfill-world-cup-2026.md](backfill-world-cup-2026.md).

Para o rehearsal da migration, use um banco PostgreSQL restaurado e isolado.
Depois de `prisma migrate deploy` e do backfill, valide também as constraints:

```powershell
$env:DATABASE_URL = "postgresql://usuario:senha@localhost:porta/banco_isolado"
npm run test:migration:constraints
```

O teste abre uma transação, tenta cruzamentos de temporada/pool e sempre a
reverte. Não aponte esse comando para produção. A evidência aprovada da Etapa 2
está em
[evidencia-prompt-2-schema-backfill.md](evidencia-prompt-2-schema-backfill.md).

### 5. Tag de baseline — somente após confirmação do operador

Não crie nem mova a tag durante a preparação da baseline. Após backup validado, restore drill aprovado, snapshots idênticos e confirmação humana, fixe a tag no commit revisado:

```powershell
git status --short --branch
git show --stat --oneline HEAD
git tag --list world-cup-2026-final
git tag -a world-cup-2026-final HEAD -m "World Cup 2026 final preservation baseline"
git show --no-patch --decorate world-cup-2026-final
git push origin world-cup-2026-final
```

Se `git tag --list` já retornar a tag, pare. Não use `-f`, não apague e não mova a referência sem um procedimento de mudança aprovado.

### Evidência do ensaio local

O seed, backup completo, restore temporário, comparação de snapshots, verificação de avatares e limpeza executados em 2026-07-14 estão registrados em [evidencia-preservacao-local.md](evidencia-preservacao-local.md).

As correções de sessão, CSRF, shutdown, fechamento transacional, drafts,
upload, provider e retenção, junto da triagem atual do `npm audit`, estão em
[evidencia-prompt-0-hardening.md](evidencia-prompt-0-hardening.md).

## Agendamento de backup

Agendamento recomendado no Windows Task Scheduler:

- Todos os dias às 12:00.
- Todos os dias às 19:00.
- Ação: `powershell.exe`.
- Argumentos: `-ExecutionPolicy Bypass -File C:\caminho\do\projeto\scripts\backup-postgres.ps1`.

As variáveis e permissões necessárias devem existir no contexto da conta que executa a tarefa.

## Healthcheck

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1
```

Endpoints:

- API: `GET /health`.
- Web: `http://localhost:8080`.

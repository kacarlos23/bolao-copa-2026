# Operacao

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

Depois de rodar `pm2 startup`, execute o comando que o PM2 imprimir para registrar o servico no Windows.

## Cloudflare Tunnel como servico

Se o tunnel ja existe, confirme que ele esta instalado como servico:

```powershell
cloudflared service install
```

Verifique o status no Windows Services ou com:

```powershell
Get-Service cloudflared
```

O tunnel deve encaminhar o subdominio para:

```text
http://localhost:8080
```

## Backups

Backup manual:

```powershell
npm run backup
```

Agendamento recomendado no Windows Task Scheduler:

- Todos os dias as 12:00.
- Todos os dias as 19:00.
- Acao: `powershell.exe`
- Argumentos: `-ExecutionPolicy Bypass -File C:\caminho\do\projeto\scripts\backup-postgres.ps1`

Configure no ambiente:

```text
BACKUP_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/bolao_copa_2026
BACKUP_DIR=C:\Backups\bolao-copa-2026
```

## Restore

Para restaurar:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-postgres.ps1 -BackupFile C:\Backups\bolao-copa-2026\bolao-YYYYMMDD-HHMMSS.dump
```

Antes de restaurar em producao local, pare a API para evitar escrita concorrente.

## Healthcheck

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\healthcheck.ps1
```

Endpoints:

- API: `GET /health`
- Web: `http://localhost:8080`

# Perfis de times da CBF

## Objetivo

A área `Times` do Brasileirão serve snapshots validados pelo backend. O navegador nunca consulta a CBF diretamente. Cada snapshot registra URL oficial, horário de coleta e checksum e a substituição dos 20 clubes é atômica.

O recorte importado é deliberadamente mínimo: nome completo, apelido e clube informado para o atleta; partidas concluídas; e estatísticas agregadas. Fotos, nascimento e payload bruto não são persistidos.

## Autorização de conteúdo

Os [Termos de Uso da CBF](https://www.cbf.com.br/termos-de-uso) vedam reprodução e publicação não especificamente autorizadas. Por isso, o importador fica desativado por padrão. Antes de habilitá-lo em qualquer ambiente compartilhado ou de produção:

1. obtenha autorização escrita para importar e republicar os campos utilizados;
2. registre a autorização e seu prazo no processo operacional;
3. aplique as migrações e mantenha um backup válido;
4. execute uma coleta manual e confira os 20 perfis antes de programar recorrência.

## Execução autorizada

```powershell
$env:CBF_TEAM_PROFILES_IMPORT_ENABLED='true'
npm run sync:cbf-team-profiles
```

Sem a variável explícita, o comando termina sem consultar a origem. Uma falha de rede, mudança de schema, ID divergente, atleta duplicado ou estatística inconsistente impede o lote inteiro de substituir o último snapshot válido.

## Verificação

- `GET /api/seasons/:seasonId/teams` deve retornar os 20 clubes e `profileAvailable: true`.
- `GET /api/seasons/:seasonId/teams/:teamId/profile` deve expor somente o contrato de `packages/shared`.
- A interface deve identificar a fonte e a hora da coleta; com mais de 48 horas, exibe aviso de desatualização.
- A lista deve ser descrita como atletas cadastrados na competição, pois o clube atual informado pela CBF pode divergir.

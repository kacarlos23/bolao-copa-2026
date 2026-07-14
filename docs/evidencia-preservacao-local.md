# Evidência de preservação local — 2026-07-14

Esta evidência foi produzida exclusivamente no PostgreSQL de desenvolvimento em `localhost:5432`. Nenhum ambiente de produção foi acessado.

## Seed e credencial local

- Banco: `bolao_copa_2026`.
- Seed executado por `npm run seed`.
- Administrador local: `admin` / `dev-admin-2026`.
- Resultado: usuário `ADMIN`, `ACTIVE`, apelido `Administrador Local` e senha confirmada com Argon2.
- Migrations: quatro encontradas e schema atualizado antes do ensaio.

As credenciais são públicas e válidas somente para desenvolvimento local.

## Snapshot semeado

SHA-256 do JSON determinístico:

```text
fcc8ee1acc2dc4bf86069cc936a7abc8cc643edbded9124ddf85a0e57e31bf28
```

Contagens registradas:

| Item                      | Quantidade |
| ------------------------- | ---------: |
| Usuários ativos           |          3 |
| Partidas                  |         72 |
| Palpites                  |        145 |
| Pontuações                |         20 |
| Fixtures do mata-mata     |         32 |
| Linhas no ranking ativo   |          1 |
| Tabelas públicas com hash |         18 |

O snapshot do banco original após o ensaio e o snapshot do banco restaurado foram semanticamente idênticos ao snapshot anterior.

## Conjunto de backup validado

Prefixo do conjunto:

```text
bolao-world-cup-2026-20260714-233244732Z
```

| Artefato                      | Resultado                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Dump custom PostgreSQL        | 70.904 bytes; SHA-256 `9b2d15e3d6d35119763b100d18b643b53d8e1a1da2c89bd108ee931677a12f0d` |
| Globais do cluster sem senhas | 774 bytes; checksum conferido pelo manifesto principal                                   |
| Arquivo de avatares           | ZIP válido de 22 bytes; zero uploads existentes no diretório real                        |
| Manifestos                    | Tamanho, SHA-256 e referências cruzadas conferidos                                       |

O caminho não vazio do backup de avatares também foi ensaiado separadamente com uma fixture local: um arquivo foi compactado, extraído e manteve o SHA-256 `8524df3fb5895dd6187ccebd5827358b3236dea7c7e0a85fc69d544916011b0d`.

## Restore drill

- Banco temporário: `bolao_restore_verify_20260714_233301`.
- `pg_restore`: concluído com `--exit-on-error`.
- Snapshot restaurado: idêntico ao snapshot anterior.
- Avatares: extraídos e verificados em diretório temporário.
- Limpeza: banco temporário e diretório de avatares removidos.
- Auditoria posterior: nenhum banco `bolao_restore_verify_*` ou diretório `*.restore-avatars` remanescente.

Os objetos globais foram preservados em SQL sem hashes de senha. Eles não foram aplicados no cluster em uso, pois isso tentaria recriar roles já existentes; destinam-se ao bootstrap controlado de um cluster substituto, seguido da definição de senhas pelo mecanismo de segredos do ambiente.

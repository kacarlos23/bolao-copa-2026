# Detalhamento tecnico da agenda

Este documento explica como a agenda do site funciona hoje e como o mesmo conceito pode ser reaproveitado para um calendario de jogos da Copa do Mundo FIFA 2026.

## 1. Objetivo da agenda atual

A agenda atual permite que uma cliente escolha um servico, veja dias e horarios disponiveis, envie uma solicitacao de agendamento e abra uma conversa no WhatsApp para confirmacao.

No painel administrativo, a equipe consegue:

- Ver agenda mensal ou semanal.
- Filtrar reservas por status.
- Confirmar, cancelar, remarcar ou marcar no-show.
- Editar horarios de funcionamento.
- Bloquear um dia inteiro ou um horario especifico.
- Cadastrar feriados/folgas.
- Exportar agendamentos para `.ics` ou Google Calendar.

O ponto principal do sistema e este: o backend calcula os horarios disponiveis com base em regras, reservas ja existentes, bloqueios manuais e feriados. O frontend apenas mostra o resultado e envia a escolha do usuario.

## 2. Arquivos principais

- `src/schedule.js`: funcoes puras de data, horarios e validacao de dias agendaveis.
- `src/app.js`: rotas HTTP, calculo final de disponibilidade, criacao de reservas e rotas administrativas.
- `src/db.js`: estrutura das tabelas SQLite.
- `src/site-store.js`: leitura/gravacao de servicos, horarios de funcionamento e configuracoes.
- `script.js`: calendario publico, modal de agendamento, lista de espera e envio para WhatsApp.
- `admin.js`: agenda administrativa, filtros, status, bloqueios, feriados e reagendamento.
- `index.html`: estrutura do modal publico da agenda.
- `admin.html`: estrutura da agenda administrativa.
- `style.css` e `admin.css`: visual do calendario publico e da agenda admin.

## 3. Modelo de dados atual

### `bookings`

Guarda os agendamentos.

Campos principais:

- `id`: identificador interno.
- `service_id`, `service_name`, `service_price`: copia dos dados do servico no momento da reserva.
- `client_name`, `client_phone`, `client_address`: dados da cliente.
- `date`: data em formato `YYYY-MM-DD`.
- `time`: horario em formato `HH:MM`.
- `status`: `pending`, `confirmed`, `cancelled` ou `no_show`.
- `notes`: observacoes da cliente.
- `admin_notes`: observacoes internas.
- `created_at`, `updated_at`: auditoria.

Existe um indice unico parcial em `date + time` apenas para reservas ativas:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot
  ON bookings(date, time)
  WHERE status IN ('pending', 'confirmed');
```

Isso impede duas reservas pendentes/confirmadas no mesmo horario. Quando uma reserva e cancelada ou marcada como no-show, ela deixa de ocupar o horario.

### `business_hours`

Define os horarios possiveis por dia da semana.

Campos:

- `day_of_week`: numero de 0 a 6, onde 0 e domingo.
- `is_open`: se o dia aceita agenda.
- `times_json`: lista JSON com horarios, por exemplo `["19:00","21:00"]`.

Padrao atual:

- Domingo: fechado.
- Segunda a sexta: `19:00`, `21:00`.
- Sabado: `09:00`, `11:00`, `13:00`, `15:00`, `17:00`, `19:00`, `21:00`.

### `agenda_blocks`

Bloqueios manuais da agenda.

Campos:

- `date`: data bloqueada.
- `time`: horario bloqueado. Se ficar vazio/nulo, bloqueia o dia inteiro.
- `reason`: motivo.
- `active`: se o bloqueio esta ativo.

### `holidays`

Feriados ou folgas.

Campos:

- `date`: data.
- `label`: nome exibido no admin/publico.
- `active`: se esta valendo.

Quando um feriado ativo existe em uma data, essa data nao gera horarios disponiveis.

### `waitlist`

Lista de espera para quando nao ha horarios.

Campos principais:

- Servico desejado.
- Nome e WhatsApp.
- Data preferida.
- Periodo.
- Observacoes.
- Status: `new`, `contacted` ou `closed`.

## 4. Calculo de disponibilidade

A disponibilidade e montada no backend pela funcao `buildAvailability`.

Entrada:

- `from`: data inicial.
- `to`: data final.
- `now`: data/hora atual do servidor.

Saida resumida:

```json
{
  "from": "2026-05-20",
  "to": "2026-05-31",
  "nextAvailable": {
    "date": "2026-05-21",
    "time": "19:00"
  },
  "totalSlots": 18,
  "availableSlots": 12,
  "days": [
    {
      "date": "2026-05-21",
      "isOpen": true,
      "holiday": "",
      "blockedReason": "",
      "slots": [
        {
          "time": "19:00",
          "available": true,
          "status": null,
          "blockReason": ""
        }
      ]
    }
  ]
}
```

Fluxo interno:

1. Normaliza o intervalo pedido, impedindo datas passadas e limitando pelo `bookingMaxDays`.
2. Busca reservas ativas (`pending` e `confirmed`) dentro do intervalo.
3. Busca feriados ativos.
4. Busca bloqueios ativos.
5. Para cada dia do intervalo:
   - Verifica se a data e valida e esta dentro do limite.
   - Verifica se o dia da semana esta aberto.
   - Busca os horarios daquele dia em `business_hours`.
   - Se for hoje, remove horarios que ja passaram.
   - Remove o dia se houver feriado ou bloqueio de dia inteiro.
   - Marca cada horario como livre, ocupado por reserva ou bloqueado.
6. Soma `totalSlots`, `availableSlots` e define o proximo horario livre em `nextAvailable`.

Regra importante: a tela publica nao decide sozinha se um horario esta livre. Ela pede `/api/availability`, mostra o retorno, e o servidor valida tudo novamente no momento do POST da reserva.

## 5. Rotas publicas

### `GET /api/site`

Carrega configuracoes, contato, servicos, posts e horarios de funcionamento.

Usada na abertura do site para montar catalogo, textos, WhatsApp e informacoes gerais.

### `GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD`

Retorna a disponibilidade calculada para o periodo.

Usada em dois momentos:

- Resumo da home: proximos 7 dias.
- Modal de agendamento: mes selecionado no calendario.

### `POST /api/bookings`

Cria uma solicitacao de reserva.

Payload atual:

```json
{
  "serviceId": "volume-brasileiro",
  "clientName": "Cliente",
  "clientPhone": "(73) 99999-0000",
  "clientAddress": "Rua Exemplo, 10",
  "date": "2026-05-21",
  "time": "19:00",
  "notes": "Observacao opcional"
}
```

Validacoes:

- Servico precisa existir e estar ativo.
- Nome, telefone, endereco, data e horario sao obrigatorios.
- Data precisa estar dentro do periodo agendavel.
- Horario precisa existir na grade configurada.
- Nao pode haver feriado ou bloqueio.
- Nao pode haver outra reserva ativa no mesmo horario.

Se tudo estiver correto:

- Insere reserva com status `pending`.
- Retorna os dados da reserva.
- Retorna `whatsappUrl` com mensagem pronta.

### `POST /api/waitlist`

Cria entrada na lista de espera.

Serve como alternativa quando nao ha horario disponivel.

## 6. Fluxo da tela publica

1. O site carrega `/api/site`.
2. A home chama `/api/availability` para mostrar:
   - Proximo horario livre.
   - Quantidade de horarios livres na semana.
3. A cliente escolhe um servico e clica em "Solicitar horario".
4. `openBookingModal` abre o modal e reseta data/horario selecionados.
5. `loadCalendarAvailability` busca disponibilidade do mes atual.
6. `renderCalendar` desenha os dias do mes.
   - Dias sem horarios livres ficam desabilitados.
   - Dias com horarios livres podem ser clicados.
7. `renderTimeSlots` mostra os horarios do dia escolhido.
   - Horarios livres ficam clicaveis.
   - Ocupados/bloqueados ficam desabilitados.
8. Quando servico, data e horario estao selecionados, o botao de confirmar e liberado.
9. `submitBooking` envia `POST /api/bookings`.
10. Em caso de sucesso:
    - Esconde o formulario.
    - Mostra resumo da solicitacao.
    - Abre o WhatsApp.
    - Recarrega disponibilidade para remover o horario recem-ocupado.

## 7. Fluxo administrativo

O admin usa login com cookie HTTP-only e token CSRF para mutacoes.

Rotas principais:

- `GET /api/admin/agenda`: retorna disponibilidade e reservas no intervalo.
- `GET /api/admin/bookings`: lista reservas.
- `PATCH /api/admin/bookings/:id`: altera status e/ou remarca data/hora.
- `GET /api/admin/business-hours`: lista horarios por dia da semana.
- `PATCH /api/admin/business-hours`: salva horarios por dia da semana.
- `GET/POST/PATCH /api/admin/agenda-blocks`: gerencia bloqueios.
- `GET/POST/PATCH /api/admin/holidays`: gerencia feriados/folgas.
- `GET /api/admin/bookings/:id/ics`: exporta evento `.ics`.
- `GET /api/admin/bookings/:id/google-calendar`: gera URL do Google Calendar.

Na interface:

- `loadAgenda` busca o periodo atual.
- `renderAgenda` atualiza estatisticas.
- `renderMonthAgenda` desenha a visao mensal.
- `renderWeekAgenda` desenha a visao semanal.
- `renderAgendaDayDetails` mostra reservas e horarios do dia selecionado.
- `updateBooking` muda status.
- `rescheduleBooking` remarca.
- `submitBusinessHours` salva grade semanal.
- `submitAgendaBlock` cria bloqueio.
- `submitHoliday` cria feriado/folga.

## 8. Adaptacao para calendario de jogos da Copa 2026

Para um calendario de jogos, o conceito visual pode ser reaproveitado quase inteiro, mas a origem dos dados muda.

Na agenda atual, os horarios sao gerados por regra:

```text
dia da semana aberto + lista de horarios - reservas - bloqueios - feriados
```

Para jogos da Copa, os eventos nao devem ser gerados por dia da semana. Eles devem vir de uma tabela de partidas:

```text
partidas cadastradas/importadas - filtros - status da partida
```

Ou seja: o calendario deixa de perguntar "quais horarios livres existem?" e passa a perguntar "quais jogos existem neste dia?".

### Mapeamento de conceitos

| Agenda atual | Calendario da Copa |
| --- | --- |
| `service` | Competicao, selecao, fase ou categoria de filtro |
| `business_hours` | Nao precisa, pois jogos tem horario fixo |
| `booking` | `match`, ou seja, partida do calendario |
| `availability.days[].slots` | `calendar.days[].events` ou `matches` |
| `status pending/confirmed` | `scheduled`, `live`, `finished`, `postponed`, `cancelled` |
| `agenda_blocks` | Ocultar/postergar partida, manutencao editorial ou aviso |
| `holidays` | Pode ser removido ou virar "dia sem jogos" automatico |
| `waitlist` | Favoritos, lembretes ou "quero ser avisado" |
| `.ics` | Exportar jogo para agenda pessoal |
| Google Calendar | Criar evento do jogo no Google Calendar |

## 9. Modelo sugerido para jogos

Tabela principal:

```sql
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_number INTEGER UNIQUE,
  starts_at_utc TEXT NOT NULL,
  venue_timezone TEXT NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  stage TEXT NOT NULL,
  group_name TEXT,
  home_team TEXT,
  away_team TEXT,
  home_score INTEGER,
  away_score INTEGER,
  venue TEXT,
  city TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  broadcast TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matches_calendar
  ON matches(local_date, local_time, stage, active);

CREATE INDEX IF NOT EXISTS idx_matches_team
  ON matches(home_team, away_team);
```

Campos importantes:

- `starts_at_utc`: data/hora real do jogo em UTC. E o campo mais confiavel para ordenacao.
- `venue_timezone`: fuso horario do estadio.
- `local_date` e `local_time`: facilitam agrupamento por dia no calendario.
- `stage`: fase, por exemplo grupo, oitavas, quartas, semifinal, final.
- `group_name`: grupo, quando aplicavel.
- `home_team` e `away_team`: selecoes.
- `status`: situacao do jogo.
- `broadcast`: onde assistir.
- `active`: permite esconder uma partida sem apagar historico.

Para Copa 2026, e recomendavel manter `starts_at_utc` e `venue_timezone`, porque os jogos podem acontecer em cidades com fusos diferentes. A agenda atual usa data local simples, o que funciona bem para um studio local, mas um calendario internacional precisa controlar fuso com mais cuidado.

## 10. API sugerida para jogos

### `GET /api/matches?from=YYYY-MM-DD&to=YYYY-MM-DD`

Lista partidas no intervalo.

Filtros opcionais:

- `team=Brasil`
- `stage=group`
- `group=A`
- `venue=...`
- `status=scheduled`

Resposta sugerida:

```json
{
  "from": "2026-06-11",
  "to": "2026-06-30",
  "nextMatch": {
    "id": 1,
    "date": "2026-06-11",
    "time": "21:00"
  },
  "totalMatches": 12,
  "days": [
    {
      "date": "2026-06-11",
      "isOpen": true,
      "events": [
        {
          "id": 1,
          "matchNumber": 1,
          "time": "21:00",
          "stage": "group",
          "homeTeam": "Time A",
          "awayTeam": "Time B",
          "venue": "Estadio",
          "city": "Cidade",
          "status": "scheduled"
        }
      ]
    }
  ]
}
```

### `GET /api/matches/:id`

Detalhe completo da partida.

### `GET /api/matches/:id/ics`

Baixa arquivo `.ics` para adicionar o jogo a uma agenda pessoal.

### `GET /api/matches/:id/google-calendar`

Retorna URL para abrir Google Calendar com o jogo preenchido.

### Rotas admin

- `GET /api/admin/matches`
- `POST /api/admin/matches`
- `PATCH /api/admin/matches/:id`
- `POST /api/admin/matches/import`

A importacao pode receber CSV/JSON com a tabela oficial de jogos.

## 11. Funcao equivalente ao `buildAvailability`

Na versao Copa, a funcao pode se chamar `buildMatchCalendar`.

Pseudocodigo:

```js
function buildMatchCalendar(db, from, to, filters = {}, now = new Date()) {
  const range = normalizeCalendarRange(from, to);
  const matches = queryMatches(db, range.from, range.to, filters);
  const days = [];
  let nextMatch = null;

  for (const date of eachDate(range.from, range.to)) {
    const events = matches
      .filter((match) => match.localDate === date)
      .sort((a, b) => a.localTime.localeCompare(b.localTime));

    for (const event of events) {
      if (!nextMatch && event.status === "scheduled" && event.startsAtUtc > now.toISOString()) {
        nextMatch = event;
      }
    }

    days.push({
      date,
      isOpen: events.length > 0,
      events
    });
  }

  return {
    from: range.from,
    to: range.to,
    nextMatch,
    totalMatches: matches.length,
    days
  };
}
```

## 12. Adaptacao da tela publica

Elementos reaproveitaveis:

- Grade mensal.
- Navegacao de mes.
- Selecao de dia.
- Painel lateral/inferior com detalhes.
- Exportacao para calendario.

Mudancas recomendadas:

- Trocar "horarios livres" por "jogos".
- Dias sem jogos ficam desabilitados ou com aparencia neutra.
- Ao clicar no dia, mostrar cards dos jogos.
- O card do jogo deve mostrar:
  - Horario.
  - Selecoes.
  - Fase/grupo.
  - Estadio/cidade.
  - Status.
  - Placar, quando finalizado.
  - Botao "Adicionar a agenda".
  - Botao "Ver detalhes".
- Adicionar filtros por selecao, fase, grupo, cidade/estadio e status.

Resumo da home:

- Proximo jogo.
- Jogos de hoje.
- Jogos da semana.
- Filtro rapido para uma selecao.

## 13. Adaptacao do admin

A agenda admin atual pode virar um painel editorial de partidas.

Manter:

- Visao mensal.
- Visao semanal.
- Painel do dia selecionado.
- Exportacao `.ics`/Google Calendar.
- Status visual por cor.

Trocar:

- Confirmar/cancelar reserva vira editar status da partida.
- Reagendar reserva vira alterar data/hora da partida.
- Bloqueios viram ocultar partida ou adicionar aviso.
- Horarios de funcionamento deixam de existir.
- Lista de espera vira lembretes/favoritos, se fizer sentido.

Status sugeridos:

- `scheduled`: jogo marcado.
- `live`: em andamento.
- `finished`: encerrado.
- `postponed`: adiado.
- `cancelled`: cancelado.

## 14. Cuidados tecnicos importantes

1. O backend deve continuar sendo a fonte da verdade.
2. Nao confiar na disponibilidade ou nos dados renderizados pelo frontend.
3. Usar `YYYY-MM-DD` para agrupamento visual por dia.
4. Usar `starts_at_utc` para ordenacao real e exportacao de calendario.
5. Controlar fuso horario da cidade do jogo.
6. Manter indices no banco para consultas por data, selecao e fase.
7. Separar status editorial de dados historicos; nao apagar partida, apenas inativar se precisar.
8. Para importacao de tabela oficial, validar duplicidade por `match_number`.
9. Para placar, permitir `null` enquanto o jogo nao terminou.
10. Para `.ics`, gerar duracao padrao de 2 horas ou usar duracao configuravel por fase/evento.

## 15. Resumo da adaptacao

O conceito da agenda atual e excelente para a Copa porque ja existe:

- Calendario mensal/semanal.
- Agrupamento por dia.
- Destaque de proximo evento.
- Tela admin.
- Status por cor.
- Exportacao para calendario externo.

A principal alteracao e substituir a logica de "horarios disponiveis para reserva" por "partidas cadastradas em uma tabela". O visual e a navegacao podem ser praticamente os mesmos, mas a regra de negocio muda de agendamento para exibicao/gestao de eventos esportivos.

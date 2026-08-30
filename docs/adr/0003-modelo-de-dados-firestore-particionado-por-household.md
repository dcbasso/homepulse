# 0003. Modelo de dados Firestore particionado por household

Status: Proposto

## Contexto

O schema atual do Firestore é plano e global, sem nenhuma chave de tenant:

| Collection | Documentos | Campos |
|---|---|---|
| `speedtest_results` | N | `timestamp, download_mbps, upload_mbps, ping_ms, jitter_ms, packet_loss_pct, server, isp, external_ip_v4, external_ip_v6, result_url` |
| `heartbeats` | N | `timestamp, external_ip_v4, external_ip_v6` |
| `incidents` | N | `started_at, recovered_at, duration_minutes` |
| `monitor_state` | doc único `current` | `internet_down, consecutive_down_checks, last_down_alert_at, last_recovery_alert_at` |
| `monitor_config` | doc único `current` | `max_minutes_without_data, alert_emails[], recipient_names{}, telegram_recipients[], notify_on_down/recovery, timezone, ...` |

Note que `monitor_config` já suporta múltiplos destinatários de alerta (`alert_emails[]`, `telegram_recipients[]`) — ou seja, já existe "multi-recipient" dentro de uma casa, mas nenhum "multi-config"/multi-tenant. Precisamos de um schema onde múltiplos households coexistam sem colidir nos documentos fixos `monitor_state/current` e `monitor_config/current`, e sem misturar os dados de séries temporais (`heartbeats`, `speedtest_results`, `incidents`) entre households.

## Decisão

Reestruturar o Firestore para particionar por household usando **subcollections sob um documento raiz por household**:

```
households/{household_id}                    (doc: name, status, members[], api_keys[])
households/{household_id}/heartbeats/{doc}
households/{household_id}/speedtest_results/{doc}
households/{household_id}/incidents/{doc}
households/{household_id}/monitor_state/current
households/{household_id}/monitor_config/current
```

O doc raiz `households/{household_id}` carrega `members: [{uid, email, role}]` (allowlist administrada manualmente, ver [ADR 0005](0005-allowlist-administrada-manualmente-para-acesso.md)).

## Alternativas consideradas

- **Campo `household_id` em collections raiz** (`speedtest_results/{doc}` com campo `household_id`, filtrando queries por `where("household_id", "==", ...)`) — mais próximo do schema atual (menos mudança de código de query), mas exige índices compostos (`household_id` + `timestamp`) em todas as collections de série temporal, e a fronteira de segurança em `firestore.rules` precisa inspecionar o conteúdo do documento (`resource.data.household_id`) em vez de apenas o caminho — mais frágil a erro de regra e mais caro em leituras de índice. Descartado em favor de subcollections, onde o isolamento é garantido pelo próprio caminho do documento e as regras de segurança ficam mais simples (`match /households/{householdId}/{document=**}`).
- **Um banco Firestore nomeado por household** (like o atual `speedtest-monitordb-one`, mas N bancos) — descartado por ser operacionalmente equivalente a "projeto por usuário" (ver [ADR 0002](0002-multi-tenancy-particionada-por-household-em-projeto-gcp-unico.md)), sem ganho de isolamento que justifique o custo de gerenciar N bancos.

## Consequências

- Regras de segurança ficam naturalmente escopadas por caminho (`households/{householdId}/...`), reduzindo o risco de uma regra mal escrita vazar dados entre households.
- Não é necessário criar índices compostos adicionais para consultas por household — cada subcollection já é implicitamente filtrada pelo caminho.
- Migração de dados existentes precisa recopiar todo o histórico das collections raiz atuais para `households/{default_household_id}/...` (ver [ADR 0009](0009-migracao-de-dados-do-household-unico-existente.md)) — não é uma mudança incremental, é uma reestruturação.
- Qualquer consulta "cross-household" (ex.: um painel de admin futuro que lista incidentes de todos os households) exige `collectionGroup` queries em vez de uma única collection raiz — mais complexo de implementar, mas não é uma necessidade atual.

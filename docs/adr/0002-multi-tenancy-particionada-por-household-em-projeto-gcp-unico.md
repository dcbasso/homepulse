# 0002. Multi-tenancy particionada por household em projeto GCP único

Status: Proposto

## Contexto

Hoje o HomePulse é, na prática, single-tenant: um projeto GCP inteiro (`<project-id>`), um banco Firestore nomeado (`speedtest-monitordb-one`), uma Service Account, um Cloud Scheduler e três Cloud Functions atendem exatamente um usuário/uma casa. Isso é visível em:

- `frontend/homepulse-web/firestore.rules` — todas as regras comparam `request.auth.token.email` a um literal fixo.
- `backend/homepulse-notification-server/function/main.py::_verify_caller` — mesma checagem, contra a env var `ALERT_EMAIL`.
- `backend/homepulse-notification-server/terraform/variables.tf` — `alert_email` é uma string única, não uma lista/mapa por tenant.
- `client/homepulse-client/src/firestore.rs` — o payload gravado não tem nenhum campo de identificação de usuário/casa (`user_id`, `household_id`, `device_id`).

Queremos suportar múltiplos usuários (households) independentes, com escala esperada de dezenas a poucas centenas de households nos próximos 12 meses.

## Decisão

Adotar multi-tenancy particionada por `household_id` dentro de um **único projeto GCP**, em vez de provisionar um projeto GCP separado por usuário. Cada household é uma partição lógica dos dados (ver [ADR 0003](0003-modelo-de-dados-firestore-particionado-por-household.md)), e toda infraestrutura (Cloud Functions, Scheduler, Firestore) é compartilhada entre todos os households, com isolamento garantido por regras de segurança e autorização na aplicação, não por fronteira de projeto GCP.

## Alternativas consideradas

- **Um projeto GCP por usuário** — isolamento total de dados e de billing por usuário, e exigiria pouquíssima mudança na lógica atual (cada projeto continuaria "single-user" como hoje). Descartado porque o custo operacional cresce linearmente com o número de usuários (N projetos, N Service Accounts, N Cloud Schedulers, N deployments Terraform) e não há visão centralizada de monitoramento/alertas entre households — inviável na escala alvo de dezenas a centenas de usuários administrados por uma única pessoa.
- **Multi-tenancy por campo `household_id` em collections raiz** (em vez de subcollections) — avaliado e descartado em favor da abordagem de subcollections; ver [ADR 0003](0003-modelo-de-dados-firestore-particionado-por-household.md) para o detalhe dessa comparação.

## Consequências

- Custo de infraestrutura cresce sublinearmente com o número de households (compartilha Cloud Functions, Scheduler, Service Accounts), viabilizando a escala alvo com custo incremental de poucos dólares por mês (detalhado no [ROADMAP.md](ROADMAP.md)).
- Toda query, regra de segurança e endpoint de API passa a ter a obrigação de filtrar/autorizar por `household_id` — esquecer esse filtro em um único lugar é uma falha de segurança que vaza dados entre households. Mitigação: testes automatizados de isolamento cross-tenant usando o Firestore emulator antes de qualquer rollout (ver [ADR 0009](0009-migracao-de-dados-do-household-unico-existente.md)).
- Um incidente ou bug na infraestrutura compartilhada (ex.: Cloud Function de alerta) afeta todos os households simultaneamente, diferente do isolamento de um modelo "projeto por usuário". Aceito como trade-off razoável na escala alvo.

# Roadmap de implementação: single-user → multi-user

Este documento traduz os ADRs em [`docs/adr/`](README.md) em fases de implementação concretas. Nenhuma fase foi implementada ainda — este é o plano de execução.

## Fase 1 — Schema de dados e migração
_Referências: [ADR 0002](0002-multi-tenancy-particionada-por-household-em-projeto-gcp-unico.md), [0003](0003-modelo-de-dados-firestore-particionado-por-household.md), [0009](0009-migracao-de-dados-do-household-unico-existente.md)_

- Script de migração (`backend/homepulse-notification-server/scripts/migrate_to_households.py`) recopiando as collections raiz atuais (`speedtest_results`, `heartbeats`, `incidents`, `monitor_state/current`, `monitor_config/current`) para `households/{default_household_id}/...`.
- Criação do doc `households/{default_household_id}` com o usuário atual (`dcbasso@gmail.com`) como `role: owner`.
- Manter as collections antigas intactas até validação completa (ver ADR 0009).

## Fase 2 — Ingest API
_Referências: [ADR 0004](0004-ingest-api-intermediaria-para-o-client-rust.md), [0010](0010-rotacao-e-revogacao-de-api-keys-do-client.md)_

- Nova Cloud Function/Cloud Run (`backend/homepulse-notification-server/function/ingest.py` ou serviço separado) com `POST /heartbeat` e `POST /speedtest`, autenticação por API key (header `Authorization: ApiKey <key>`), resolução de `household_id` a partir do hash da key.
- `backend/homepulse-notification-server/terraform/function.tf`: novo recurso reaproveitando o bucket de source existente.

## Fase 3 — Client Rust
_Referência: [ADR 0004](0004-ingest-api-intermediaria-para-o-client-rust.md)_

- `client/homepulse-client/src/config.rs`: substituir `FirestoreConfig{service_account_key_path, project_id}` por `IngestConfig{api_key, household_id, ingest_url}`.
- `client/homepulse-client/src/firestore.rs` (renomear para `ingest.rs`): remover JWT/OAuth2 (`jsonwebtoken`, `get_access_token`, cache de token); `append_document`/`append_heartbeat` viram chamadas HTTP simples.
- Remover `client/homepulse-client/deploy/<project-id>-sa.json` do fluxo de deploy.

## Fase 4 — Backend de alertas
_Referências: [ADR 0007](0007-scheduler-multi-household-e-limite-do-check-de-status.md), [0008](0008-autenticacao-por-household-em-todos-os-endpoints-da-api.md)_

- `main.py::check_internet_status`: extrair lógica atual (linhas ~643–767) para `_check_household(db, household_id)`, chamada em loop sobre `households` ativos.
- `_verify_caller`/`send_test_alert`: trocar comparação de email fixo por lookup de membership em `households/{household_id}/members`.
- Remover `ALERT_EMAIL` como mecanismo de autorização (mantido só como fallback durante a transição, se necessário).

## Fase 5 — Frontend Angular
_Referências: [ADR 0005](0005-allowlist-administrada-manualmente-para-acesso.md), [0006](0006-firestore-security-rules-baseadas-em-membership-de-household.md), [0008](0008-autenticacao-por-household-em-todos-os-endpoints-da-api.md)_

- `auth.service.ts`: remover comparação `email !== environment.allowedEmail`; novo `HouseholdContextService` resolvendo o(s) household(s) do uid.
- `auth.guard.ts`: manter checagem de autenticação; novo `householdGuard` garantindo household associado.
- `firestore.service.ts` / `settings-data.service.ts`: paths passam a ser `households/${householdId}/...`.
- Nova tela de gerenciamento de membros (só para `owner`/`admin`).
- `environments/environment*.ts`: remover `allowedEmail`.

## Fase 6 — Firestore Rules
_Referência: [ADR 0006](0006-firestore-security-rules-baseadas-em-membership-de-household.md)_

- Reescrever `frontend/homepulse-web/firestore.rules` usando `exists()` sobre `households/{householdId}/members/{uid}`.

## Fase 7 — Terraform
_Referências: [ADR 0004](0004-ingest-api-intermediaria-para-o-client-rust.md), [0007](0007-scheduler-multi-household-e-limite-do-check-de-status.md)_

- `variables.tf`: remover `alert_email` como variável única.
- `function.tf`: adicionar recurso da ingest API.
- `scheduler.tf`: manter `* * * * *`; documentar o limite de timeout conforme N cresce (ver ADR 0007).

## Fase 8 — Segurança e rollout
_Referências: [ADR 0002](0002-multi-tenancy-particionada-por-household-em-projeto-gcp-unico.md), [0009](0009-migracao-de-dados-do-household-unico-existente.md), [0010](0010-rotacao-e-revogacao-de-api-keys-do-client.md)_

- Testes de isolamento cross-tenant com Firestore emulator. **Feito** — `frontend/homepulse-web/firestore-rules-tests/isolation.spec.ts` (`npm run test:rules`), 17 testes contra o emulator real provando que um household não lê/escreve dados de outro via `firestore.rules`, incluindo a regra de `collectionGroup('members')`.
- Validar fluxo de rotação de API key sem downtime do client. **Feito** — `backend/homepulse-notification-server/function/test_ingest.py` (`pytest`), 17 testes provando que duas chaves ativas simultâneas (janela de overlap do ADR 0010) autenticam corretamente e que revogar uma não afeta a outra nem outros households.
- Rollout gradual mantendo dados antigos até validação completa. **Pendente** — plano abaixo.

### Plano de rollout

As Fases 1–7 já estão implementadas e mergeadas em `main`, mas a migração real (não dry-run) de `dcbasso@gmail.com` para o novo schema `households/{id}/...` foi deliberadamente adiada para o fim do roadmap (ver ADR 0009) — rodá-la antes disso deixaria o household único de produção num estado misto sem o restante da pilha pronta para lidar com ele. Ordem de execução em produção:

1. **Confirmar infraestrutura implantada**: Terraform da Fase 7 aplicado (`terraform apply`), Cloud Functions da Fase 2 (`ingest-heartbeat`, `ingest-speedtest`) já respondendo — nenhuma delas depende de um household existir, então podem ir ao ar mesmo sem tráfego ainda.
2. **Dry-run da migração** (`python migrate_to_households.py --owner-email dcbasso@gmail.com --dry-run`) contra o projeto de produção, conferindo que as contagens de documentos por coleção batem com o Firestore atual. Repetir sempre que os dados de produção mudarem significativamente, até a execução real.
3. **Migração real** (sem `--dry-run`) — ponto de não-retorno operacional (ainda que reversível, ver passo 8): cria `households/{household_id}` com `dcbasso@gmail.com` como `owner` e recopia (não move) `speedtest_results`, `heartbeats`, `incidents`, `monitor_state/current`, `monitor_config/current` para as subcoleções novas. As coleções raiz antigas continuam intactas.
4. **Emitir a primeira API key** (`issue_api_key.py`) para o `household_id` gerado no passo 3 e atualizar `client/homepulse-client`'s `config.json` na máquina doméstica (Fase 3) para apontar para a Ingest API. Confirmar no Firestore que novos heartbeats/speedtests estão chegando em `households/{household_id}/...` antes de prosseguir.
5. **Deploy do frontend** (Fase 5) lendo de `households/{householdId}/...` — só depois do passo 3, já que `HouseholdContextService` depende do documento `members` existir para resolver o household ativo do usuário.
6. **Deploy das novas `firestore.rules`** (Fase 6) — precisa ser sincronizado com o passo 5, não antes: as regras antigas liberavam as coleções raiz por e-mail fixo, as novas não cobrem mais essas coleções raiz (nenhuma regra = acesso negado por padrão). Publicar as duas mudanças na mesma janela evita uma janela em que o frontend em produção fica sem conseguir ler nada.
7. **Período de validação** (sugestão: 48h–1 semana) monitorando: alertas de heartbeat/down-up funcionando via `_check_household` (Fase 4), duração de execução do `check-internet-status` no Cloud Monitoring (ver nota de timeout em `scheduler.tf`), e ausência de erros 401 na Ingest API (chave inválida).
8. **Rollback**, caso necessário em qualquer ponto antes do passo 9: as coleções raiz antigas nunca são apagadas pelos passos acima, então basta reverter o deploy do frontend/rules para a versão anterior — os dados antigos continuam íntegros e completos.
9. **Limpeza manual e explícita** das coleções raiz antigas — só depois de confirmado que nada mais as referencia (nenhum código em produção lê `speedtest_results`, `heartbeats`, `incidents`, `monitor_state`, `monitor_config` na raiz). Não automatizado deliberadamente (ver ADR 0009): é a única cópia de segurança até este ponto.

---

## Estimativa de custo (GCP, ordem de grandeza)

**Modelo atual (1 household):** Cloud Scheduler (1 job, free tier), Cloud Functions (~43.200 invocações/mês, dentro do free tier de 2M/mês), Firestore (~130k reads/mês, dentro do free tier), Gmail API (poucas dezenas de envios/mês) — custo total ≈ $0.

**Modelo proposto, para N=100 households:**
- Firestore: ~13M reads/mês (check de status) + ~4,4M writes/mês (heartbeats/speedtests via ingest API) → pós free tier, ordem de **$10–15/mês para 100 households no total** (não por household).
- Cloud Function do scheduler: invocações/mês não crescem com N (continua ~43.200/mês) — o custo de compute cresce com o tempo de execução por invocação, mas permanece dentro do free tier de compute em volumes moderados.
- Ingest API: ~4,33M invocações/mês (heartbeat 1/min + speedtest 1/60min por household) — ultrapassa o free tier de 2M, custo adicional ≈ **~$1/mês para 100 households**.
- Gmail API: risco a monitorar, não custo direto — uma única conta remetente pode esbarrar no limite de envio diário (500/dia para conta normal) se muitos households tiverem outages simultâneos; considerar SendGrid/SES se isso se tornar gargalo.

**Conclusão**: na escala alvo (dezenas a centenas de households), o custo incremental de GCP é da ordem de poucos dólares por mês **para toda a base**, não por household — a arquitetura de "1 scheduler + loop interno" ([ADR 0007](0007-scheduler-multi-household-e-limite-do-check-de-status.md)) evita o custo que existiria com "1 job de Scheduler por household". Os pontos reais de atenção não são custo de GCP, e sim (a) a quota/reputação da conta Gmail remetente única e (b) o timeout de 60s da função conforme N cresce.

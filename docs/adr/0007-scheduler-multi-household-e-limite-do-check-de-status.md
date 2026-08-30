# 0007. Scheduler multi-household e limite do check de status

Status: Proposto

## Contexto

Hoje `backend/homepulse-notification-server/terraform/scheduler.tf` dispara a Cloud Function `check-internet-status` a cada minuto (`* * * * *`), e `main.py::check_internet_status` processa **um único** household implícito: lê o heartbeat mais recente global, `monitor_state/current` e `monitor_config/current` fixos, decide se há outage e envia alerta. A função Gen2 correspondente em `terraform/function.tf` tem `max_instance_count = 1` e um timeout padrão de 60s.

Com múltiplos households, essa mesma execução por minuto precisa avaliar o estado de N households, não apenas um.

## Decisão

Manter **um único Cloud Scheduler job** disparando **uma única invocação da Cloud Function por minuto**, e mover a iteração sobre households para dentro do corpo da função: `check_internet_status` passa a listar `households` ativos (`db.collection("households").where("active", "==", True).stream()`) e, para cada um, repetir a lógica atual de verificação (extraída para uma função `_check_household(db, household_id)`), lendo e escrevendo em `households/{id}/...`.

## Alternativas consideradas

- **Um Cloud Scheduler job + uma invocação de função por household** — isolaria falhas entre households (um erro em um household não afeta os outros) e paralelizaria naturalmente via múltiplas invocações concorrentes do Cloud Functions, mas multiplica o número de invocações por N (custo cresce linearmente com o número de households) e a gestão de N jobs de Scheduler via Terraform é mais complexa que uma única execução. Descartado por não ser necessário na escala alvo e por ir contra a decisão de manter uma única infraestrutura compartilhada ([ADR 0002](0002-multi-tenancy-particionada-por-household-em-projeto-gcp-unico.md)).
- **Fan-out via Pub/Sub** (1 mensagem por household, processada por instâncias separadas da função) — solução correta para quando o processamento sequencial dentro do timeout de 60s deixar de caber, mas é complexidade desnecessária na escala alvo atual (dezenas a centenas de households). Fica registrado aqui como a estratégia de saída quando o limite abaixo for atingido, não implementada agora.

## Consequências

- O número de invocações de Cloud Function por mês permanece constante (~43.200/mês, uma por minuto), independente de N — o custo de invocação não cresce com o número de households, apenas o tempo de execução de cada invocação.
- Existe um limite prático: se cada household leva da ordem de 50–100ms de processamento sequencial (incluindo I/O de Firestore), o timeout de 60s da função comporta algo entre algumas centenas de households no pior caso, mas latência de rede real pode reduzir esse número. Este ADR estabelece como sinal de alerta operacional: monitorar a duração da execução do `check-internet-status` e revisitar esta decisão (paralelização com `asyncio`/threads dentro da mesma invocação, ou fan-out via Pub/Sub) quando a duração se aproximar de ~30s (metade do timeout).
- Uma falha ao processar um household (ex.: erro ao ler `monitor_config/current` de um household específico) deve ser isolada com try/except por household dentro do loop, para não abortar a verificação dos demais households na mesma execução.

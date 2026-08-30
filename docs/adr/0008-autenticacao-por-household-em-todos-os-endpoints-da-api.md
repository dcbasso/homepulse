# 0008. Autenticação por household em todos os endpoints da API

Status: Proposto

## Contexto

Hoje o backend expõe três endpoints (`backend/homepulse-notification-server/function/main.py`, provisionados em `terraform/function.tf` com IAM `allUsers` como invoker — a autenticação real acontece em código de aplicação, não em IAM):

- `check-internet-status` — disparado apenas pelo Cloud Scheduler, sem autenticação de usuário final (ver [ADR 0007](0007-scheduler-multi-household-e-limite-do-check-de-status.md)).
- `whoami` — público, sem dados sensíveis, apenas reporta o IP do chamador.
- `send-test-alert` — protegido por `_verify_caller`, que valida um Firebase ID token e compara o email contra a env var `ALERT_EMAIL` fixa: `if not email or email != os.environ.get("ALERT_EMAIL"): return None`.

Com múltiplos households, cada endpoint que atua em nome de um usuário final precisa saber **para qual household** ele está autorizado a agir, não apenas "é o único usuário permitido".

## Decisão

Cada endpoint que recebe uma chamada em nome de um usuário final (ex.: `send-test-alert`, e futuros endpoints de gerenciamento de membros/configuração) passa a:

1. Validar o Firebase ID token normalmente (como hoje).
2. Receber o `household_id` alvo como parâmetro da requisição.
3. Verificar que o `uid`/`email` do token está em `households/{household_id}/members` antes de autorizar a ação — substituindo a comparação `email != ALERT_EMAIL` por uma consulta de membership.

A ingest API do client Rust ([ADR 0004](0004-ingest-api-intermediaria-para-o-client-rust.md)) usa um mecanismo de autenticação diferente (API key hash, não Firebase ID token), já que o client não é um usuário logado no frontend.

## Alternativas consideradas

- **Custom claim `household_ids` no Firebase ID token** para autorizar sem consulta adicional ao Firestore — mesmo trade-off de propagação discutido no [ADR 0006](0006-firestore-security-rules-baseadas-em-membership-de-household.md) (delay entre mudança de membership e o token refletir isso). Para endpoints de backend (diferente de regras do Firestore), uma consulta direta ao Firestore dentro da própria função é mais simples de manter consistente e não exige gerenciar sincronização de claims.

## Consequências

- Remove a dependência da env var `ALERT_EMAIL` como mecanismo de autorização — ela deixa de ser necessária no backend (pode ser removida do `terraform/variables.tf` e do `secrets`/env do deploy da função).
- Cada endpoint autenticado por usuário final precisa do `household_id` explícito na requisição, exigindo que o frontend sempre envie o household ativo no contexto (`HouseholdContextService`, ver roadmap) junto com qualquer chamada.
- Erros de autorização (usuário tenta agir em um household do qual não é membro) devem retornar 403 de forma consistente, nunca vazando se o household existe ou não para um chamador não autorizado.

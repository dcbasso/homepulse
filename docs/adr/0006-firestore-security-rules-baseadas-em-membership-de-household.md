# 0006. Firestore Security Rules baseadas em membership de household

Status: Proposto

## Contexto

`frontend/homepulse-web/firestore.rules` hoje é a barreira de segurança real do sistema (o guard do frontend, `auth.guard.ts`, só verifica se há um usuário autenticado, não o email):

```
match /speedtest_results/{doc} {
  allow read: if request.auth != null && request.auth.token.email == 'YOUR_ALLOWED_EMAIL';
}
```

O mesmo padrão se repete em `heartbeats`, `incidents` e `monitor_config`. Com a mudança para `households/{household_id}/...` ([ADR 0003](0003-modelo-de-dados-firestore-particionado-por-household.md)), essa comparação de email fixo precisa virar uma checagem de "este usuário autenticado é membro deste household".

## Decisão

Reescrever `firestore.rules` para autorizar por membership, usando **subcollection `members`** dentro de cada household (em vez de um array `members[]` no doc raiz), permitindo checagem via `exists()`:

```
match /households/{householdId}/{document=**} {
  allow read, write: if request.auth != null
    && exists(/databases/$(database)/documents/households/$(householdId)/members/$(request.auth.uid));
}
```

Refinamentos de permissão por `role` (ex.: só `owner`/`admin` pode escrever em `monitor_config`) são adicionados como regras mais específicas dentro do mesmo `match`, sobrepondo a regra genérica de leitura.

## Alternativas consideradas

- **Firebase custom claims** (`request.auth.token.household_ids[householdId] != null`), setados por uma Cloud Function/trigger sempre que a membership muda — evita uma leitura extra do Firestore a cada avaliação de regra, mas introduz um problema de propagação: o token do usuário só reflete a claim nova depois de um refresh (o cliente precisa forçar `getIdToken(true)` ou esperar a expiração natural do token), o que pode confundir um usuário recém-convidado que não vê os dados imediatamente. Também exige manter uma Cloud Function adicional só para sincronizar claims.
- **Campo `household_id` em cada documento com regra inspecionando `resource.data.household_id`** — descartado junto com a alternativa equivalente do [ADR 0003](0003-modelo-de-dados-firestore-particionado-por-household.md); é mais frágil porque depende do documento já ter o campo correto, em vez do caminho garantir o escopo.

A abordagem de `exists()` foi escolhida por não exigir infraestrutura adicional (nenhuma Cloud Function de sincronização de claims) e por refletir mudanças de membership imediatamente, sem esperar refresh de token — trade-off aceito é o custo de uma leitura extra por avaliação de regra, que é pequeno num Firestore (não conta como leitura faturável separada quando usado dentro de regras, mas tem limite de profundidade de `get`/`exists` por regra, que aqui é de apenas 1 nível).

## Consequências

- Adicionar ou remover um membro tem efeito imediato (não depende de refresh de token do Firebase Auth).
- O limite de `get()`/`exists()` por avaliação de regra do Firestore (10 chamadas) não é um problema aqui, já que cada regra usa apenas 1 `exists()`.
- Testar isolamento entre households exige testes automatizados com o Firestore emulator (ver [ADR 0002](0002-multi-tenancy-particionada-por-household-em-projeto-gcp-unico.md)) antes de qualquer rollout em produção, dado que um erro na regra vaza dados entre tenants.

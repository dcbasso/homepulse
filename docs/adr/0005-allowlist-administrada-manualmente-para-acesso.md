# 0005. Allowlist administrada manualmente para acesso

Status: Proposto

## Contexto

Hoje o acesso ao HomePulse é controlado por um único email hardcoded: `frontend/homepulse-web/src/app/core/auth.service.ts` compara o email do login Google contra `environment.allowedEmail`, e `firestore.rules` repete a mesma checagem como barreira real de segurança. Não existe nenhum conceito de cadastro, convite ou múltiplos usuários.

Em multi-user, é preciso decidir como novos usuários (households) entram no sistema: self-signup público, self-signup com aprovação, ou cadastro manual pelo administrador.

## Decisão

Adotar uma **allowlist administrada manualmente**: o administrador (o próprio operador do projeto) cadastra o email/uid de cada usuário permitido diretamente na estrutura de dados (`households/{household_id}.members[]`, ver [ADR 0003](0003-modelo-de-dados-firestore-particionado-por-household.md)). Não há fluxo de self-signup público nesta fase — um usuário só consegue logar e acessar dados depois de já estar cadastrado como membro de um household pelo administrador.

## Alternativas consideradas

- **Self-signup com Google Sign-In, sem aprovação** — mais amigável para crescimento orgânico, mas exige mais cuidado com abuso de custo (cada novo signup aumenta automaticamente a carga do Scheduler/Cloud Function, ver [ADR 0007](0007-scheduler-multi-household-e-limite-do-check-de-status.md)) e um fluxo completo de provisionamento automático do client Rust (emissão de API key na hora do cadastro). Descartado para a fase inicial por aumentar a superfície de risco sem necessidade — a escala alvo (dezenas a centenas de households) não exige onboarding self-service.
- **Self-signup com aprovação do admin** — meio-termo razoável, mas exige construir um fluxo de estado "pendente" e uma tela/mecanismo de aprovação. Descartado por ora como complexidade desnecessária frente ao volume esperado de novos usuários (baixo, administrável manualmente).

## Consequências

- Onboarding de um novo household exige uma ação manual do administrador (criar o doc `households/{id}` e adicionar o membro) — aceitável na escala alvo, mas não escala além de dezenas/poucas centenas de households sem alguma ferramenta de admin.
- Reduz a superfície de abuso: não há como um usuário não autorizado criar household e gerar custo de infraestrutura sem que o administrador o tenha cadastrado antes.
- Quando/se o projeto crescer além da escala alvo, esta decisão deve ser revisitada com um novo ADR que introduza self-signup (com ou sem aprovação).

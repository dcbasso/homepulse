# Architecture Decision Records (ADRs)

Este diretório contém os registros de decisões arquiteturais (ADRs) do HomePulse.

## O que é um ADR aqui

Um documento curto que registra uma decisão de arquitetura significativa: o contexto que a motivou, a decisão tomada, as alternativas consideradas e as consequências (inclusive riscos aceitos). Uma vez aceito, um ADR não é editado para refletir mudanças de opinião — se a decisão mudar, cria-se um novo ADR que a supersede e referencia o antigo.

## Formato

Cada ADR usa o template em [`0000-template.md`](0000-template.md), com as seções:

- **Contexto** — qual problema motivou a decisão, incluindo estado atual do código quando relevante.
- **Decisão** — o que foi decidido.
- **Alternativas consideradas** — o que mais foi avaliado e por que não foi escolhido.
- **Consequências** — impactos positivos e negativos, riscos aceitos.

## Numeração

Sequencial, começando em `0001`, arquivo `NNNN-titulo-em-kebab-case.md`. Idioma: português.

## Índice

| # | Título | Status |
|---|---|---|
| [0001](0001-registrar-decisoes-arquiteturais-com-adrs.md) | Registrar decisões arquiteturais com ADRs | Aceito |
| [0002](0002-multi-tenancy-particionada-por-household-em-projeto-gcp-unico.md) | Multi-tenancy particionada por household em projeto GCP único | Proposto |
| [0003](0003-modelo-de-dados-firestore-particionado-por-household.md) | Modelo de dados Firestore particionado por household | Proposto |
| [0004](0004-ingest-api-intermediaria-para-o-client-rust.md) | Ingest API intermediária para o client Rust | Proposto |
| [0005](0005-allowlist-administrada-manualmente-para-acesso.md) | Allowlist administrada manualmente para acesso | Proposto |
| [0006](0006-firestore-security-rules-baseadas-em-membership-de-household.md) | Firestore Security Rules baseadas em membership de household | Proposto |
| [0007](0007-scheduler-multi-household-e-limite-do-check-de-status.md) | Scheduler multi-household e limite do check de status | Proposto |
| [0008](0008-autenticacao-por-household-em-todos-os-endpoints-da-api.md) | Autenticação por household em todos os endpoints da API | Proposto |
| [0009](0009-migracao-de-dados-do-household-unico-existente.md) | Migração de dados do household único existente | Proposto |
| [0010](0010-rotacao-e-revogacao-de-api-keys-do-client.md) | Rotação e revogação de API keys do client | Proposto |
| [0011](0011-windows-service-nativo-para-o-client-usando-windows-service.md) | Windows Service nativo para o client, usando a crate windows-service | Aceito |

Veja também [`ROADMAP.md`](ROADMAP.md) para o plano de implementação que executa estas decisões.

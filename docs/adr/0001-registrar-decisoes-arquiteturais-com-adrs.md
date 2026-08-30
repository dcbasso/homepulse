# 0001. Registrar decisões arquiteturais com ADRs

Status: Aceito

## Contexto

O HomePulse não possui nenhum registro histórico de decisões de arquitetura. Decisões importantes já tomadas no passado — como usar um banco Firestore nomeado (`speedtest-monitordb-one`) em vez do banco `(default)`, autenticar o client Rust via Service Account key local, ou restringir todo o acesso a um único email hardcoded em `firestore.rules` — não têm registro do porquê foram tomadas assim, apenas o resultado no código.

O projeto está prestes a passar por uma mudança estrutural grande (single-user → multi-user), com várias decisões que afetam custo, segurança e modelo de dados de forma duradoura. Sem um registro formal, essas decisões ficariam implícitas no código e no histórico de commits, difíceis de recuperar depois.

## Decisão

Adotar Architecture Decision Records (ADRs) a partir de agora, em `docs/adr/`, usando o template em [`0000-template.md`](0000-template.md). Toda decisão de arquitetura significativa (modelo de dados, autenticação, particionamento de tenants, escolhas de infraestrutura com impacto de custo relevante) passa a ser registrada como um novo ADR antes ou durante sua implementação.

Não é objetivo retroagir e documentar todo o histórico do projeto — os ADRs 0002 em diante cobrem a decisão de migração para multi-user, que é o motivador imediato desta prática.

## Alternativas consideradas

- **Não documentar, manter decisões apenas no código/commits** — descartado porque o código não explica trade-offs nem alternativas rejeitadas, e o histórico de commits não é pesquisável por decisão.
- **Documento único de arquitetura (não incremental)** — descartado porque fica desatualizado rapidamente e não preserva o contexto histórico de decisões já superadas.

## Consequências

- Toda mudança arquitetural relevante ganha um ADR curto antes de ser implementada, aumentando um pouco o tempo de planejamento mas reduzindo retrabalho por decisões mal entendidas depois.
- ADRs antigos não são editados quando a decisão muda — um novo ADR supersede o anterior, preservando o histórico de raciocínio.
- Risco aceito: sem disciplina, a prática pode cair em desuso; mitigação é manter o índice em [`README.md`](README.md) sempre atualizado como checklist de decisões pendentes de registro.

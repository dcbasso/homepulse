# 0009. Migração de dados do household único existente

Status: Proposto

## Contexto

O household único que já existe em produção (dados em `speedtest_results`, `heartbeats`, `incidents`, `monitor_state/current`, `monitor_config/current` na raiz do banco `speedtest-monitordb-one`) precisa ser migrado para o novo schema particionado `households/{household_id}/...` ([ADR 0003](0003-modelo-de-dados-firestore-particionado-por-household.md)) sem perder histórico nem causar uma janela de indisponibilidade do monitoramento em produção (o sistema está ativamente monitorando a internet doméstica do usuário atual).

## Decisão

Executar uma migração one-shot via script (`backend/homepulse-notification-server/scripts/migrate_to_households.py` ou equivalente) que:

1. Cria o documento `households/{default_household_id}` com o usuário atual (`dcbasso@gmail.com`) como membro `role: owner`.
2. Recopia (não move) todos os documentos das collections raiz atuais para as subcollections correspondentes sob `households/{default_household_id}/...`.
3. Mantém as collections raiz antigas intactas por um período de coexistência, até que o código novo (backend, frontend, client Rust apontando para a ingest API) esteja validado em produção lendo exclusivamente do novo schema.
4. Só remove as collections raiz antigas em uma limpeza posterior, explícita e manual, depois de confirmado que nada mais as referencia.

Durante a janela de coexistência, o client Rust continua escrevendo no schema antigo até ser atualizado para falar com a ingest API ([ADR 0004](0004-ingest-api-intermediaria-para-o-client-rust.md)) — a migração de dados históricos e a migração do client são etapas sequenciais, não simultâneas, para permitir rollback em cada uma independentemente.

## Alternativas consideradas

- **Migração com corte único (mover e apagar de imediato)** — mais simples de implementar, mas sem possibilidade de rollback caso o novo schema tenha um problema não percebido antes do apagamento. Descartado por ser a única partição de dados existente em produção (perda de dados aqui não é recuperável de um backup automático simples).
- **Dual-write permanente** (client Rust escrevendo simultaneamente no schema antigo e no novo) — desnecessário como solução permanente; a coexistência apenas de leitura/histórico (não de escrita ativa dupla) é suficiente já que o schema antigo só precisa ser preservado como cópia de segurança até a validação.

## Consequências

- A migração é reversível durante a janela de coexistência: se algo no novo schema estiver incorreto, o sistema pode voltar a ler das collections raiz antigas sem perda de dados.
- Exige disciplina de não esquecer a limpeza das collections antigas depois — deixar dados duplicados indefinidamente aumenta custo de armazenamento (pequeno, mas real) e confusão sobre qual é a fonte de verdade.
- O `default_household_id` do usuário atual deve ser escolhido de forma que não colida com IDs gerados automaticamente para novos households futuros (ex.: usar um UUID gerado no momento da migração, não um valor previsível como `"default"`).

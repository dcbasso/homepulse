# 0010. Rotação e revogação de API keys do client

Status: Proposto

## Contexto

A ingest API ([ADR 0004](0004-ingest-api-intermediaria-para-o-client-rust.md)) autentica o client Rust por uma API key de longa duração por household, em vez de uma credencial GCP. O client Rust roda em máquinas domésticas (ex.: um container em Proxmox) que não têm um canal de atualização automática de configuração — trocar a chave exige acesso manual à máquina para editar o arquivo de configuração local.

Se uma rotação de chave invalidar a chave antiga imediatamente, qualquer client que não seja atualizado no mesmo instante para de conseguir gravar dados (heartbeats e speedtests), gerando um "falso outage" percebido pelo `check-internet-status` (ausência de heartbeat recente) até que o usuário perceba e atualize a chave manualmente.

## Decisão

O formato da API key é `hpk_<household_id>_<random>` (prefixo identificável para facilitar auditoria de logs, sem expor a chave em si). Apenas o **hash** (SHA-256) da key é armazenado em `households/{household_id}.api_keys[]` — nunca a chave em texto plano no banco. A estrutura suporta **múltiplas chaves ativas simultaneamente** por household (uma lista, não um único valor), permitindo rotação sem downtime: uma nova chave é emitida e adicionada à lista antes de a antiga ser removida, dando uma janela de sobreposição para o usuário atualizar a máquina doméstica antes de revogar a chave antiga.

## Alternativas consideradas

- **Uma única API key ativa por household (sem sobreposição)** — mais simples de implementar e raciocinar sobre, mas qualquer rotação vira uma operação com risco de downtime do client até a atualização manual. Descartado por conflitar diretamente com o cenário real de operação (máquina doméstica sem atualização automática).
- **Armazenar a API key em texto plano no Firestore** para simplificar validação — descartado por razão de segurança básica: um vazamento do banco (ou de um backup) exporia diretamente as credenciais de todos os households; comparar hashes é equivalente em custo de implementação e muito mais seguro.

## Consequências

- Revogar uma chave comprometida é uma operação simples e imediata (remover seu hash da lista), sem afetar outras chaves ativas do mesmo household.
- O fluxo de rotação recomendado ao usuário é: gerar nova chave → atualizar a máquina doméstica → confirmar que o novo heartbeat está chegando → só então revogar a chave antiga — nunca revogar antes de confirmar a chave nova funcionando.
- Chaves antigas esquecidas (nunca revogadas) permanecem uma superfície de risco latente; deve-se considerar, em uma iteração futura, uma expiração automática (TTL) para chaves não usadas há muito tempo — não implementado nesta decisão inicial.

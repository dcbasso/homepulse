# 0004. Ingest API intermediária para o client Rust

Status: Proposto

## Contexto

Hoje o client Rust (`client/homepulse-client/`) autentica diretamente no Firestore usando uma chave de Service Account JSON local (`config.rs::ServiceAccountKey`, ex. `client/homepulse-client/deploy/<project-id>-sa.json`), assinando um JWT RS256 e trocando por um access token OAuth2 com escopo `datastore` (`firestore.rs::get_access_token`), depois gravando via POST direto na Firestore REST API (`append_document`, `append_heartbeat`).

Em um modelo multi-household, isso significaria distribuir uma chave de Service Account real do GCP — com escopo de escrita no Firestore — para cada máquina doméstica de cada usuário. Isso é operacionalmente pesado (gerar, entregar e revogar N chaves de Service Account) e um risco de segurança maior que o necessário: uma chave de Service Account vazada dá acesso amplo ao Firestore, não apenas ao household daquele usuário, a menos que se configure IAM granular por Service Account — o que multiplica ainda mais a complexidade de gestão.

## Decisão

Introduzir uma **ingest API HTTP intermediária** (Cloud Function ou Cloud Run) com endpoints como `POST /heartbeat` e `POST /speedtest`, autenticada por uma **API key de longa duração por household** (não uma credencial GCP). O client Rust passa a enviar requisições HTTP simples com a API key em um header (ex. `Authorization: ApiKey <key>`); a função resolve o `household_id` a partir do hash da key (nunca a partir de um valor enviado pelo client, para evitar spoofing) e grava no Firestore usando a Service Account própria da função — o client nunca mais possui credenciais GCP.

## Alternativas consideradas

- **Service Account por household, direto no Firestore** — mantém o padrão atual (client fala direto com o Firestore via JWT assinado), mas com uma SA por household e IAM restringindo escrita a `households/{household_id}/`. Menos código novo no backend, mas exige gerenciar e distribuir N chaves de Service Account reais do GCP para usuários finais — risco de segurança maior se uma chave vazar, e processo manual pesado de emissão/revogação por usuário. Descartado por não escalar operacionalmente na meta de dezenas/centenas de households.
- **Firebase Auth com custom token por dispositivo** — evitaria a API key própria, mas exigiria que o client Rust implementasse o fluxo de autenticação Firebase (mais complexo que uma API key em header) sem ganho claro de segurança sobre a API key com hash.

## Consequências

- O client Rust fica mais simples: remove toda a lógica de JWT/OAuth2 (`jsonwebtoken`, `get_access_token`, cache de token) e passa a fazer requisições HTTP com uma chave estática.
- A revogação de acesso de um household específico passa a ser uma operação simples (invalidar o hash da key), sem tocar em IAM do GCP.
- Introduz um novo componente de infraestrutura (a ingest API) que precisa ser mantido, monitorado e ter seu próprio custo de invocação (ver estimativa no [ROADMAP.md](ROADMAP.md)).
- Rotação de API key precisa de cuidado para não deixar o client Rust "surdo" (sem conseguir gravar dados) entre a rotação e a atualização manual da chave na máquina doméstica — tratado no [ADR 0010](0010-rotacao-e-revogacao-de-api-keys-do-client.md).

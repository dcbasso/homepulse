# 0011. Windows Service nativo para o client, usando a crate windows-service

Status: Aceito

## Contexto

O `homepulse-client` (Rust) hoje só roda em produção como um processo systemd
no Linux (`packaging/homepulse-client.service` + `packaging/install.sh`,
descrito em `client/homepulse-client/README.md`). O frontend já expõe uma
aba "Windows" desabilitada em
`frontend/homepulse-web/src/app/features/client/client.component.ts` com um
comentário deixando claro que só a aba Linux é funcional nesta versão — o
suporte a Windows é uma necessidade de produto conhecida, ainda não atendida.

Rodar o client em background no Windows exige integração com o Service
Control Manager (SCM): início automático no boot, resposta a
`Stop-Service`/`services.msc`, e um destino de log adequado (stdout não tem
para onde ir quando o processo não tem console). Antes desta decisão, o
código também tinha uma dependência Unix-only bloqueando qualquer build
Windows: `speedtest.rs` matava o processo do timeout via
`Command::new("kill").arg("-9")`.

## Decisão

Usar a crate `windows-service` para integração direta com o SCM, em vez de
um wrapper de serviço genérico (ex.: NSSM) ou de registrar o processo via
`sc.exe` apontando cegamente para o binário.

O próprio binário ganha subcomandos `install`/`uninstall`/`start`/`stop`
(`#[cfg(windows)]`, em `src/windows_service.rs`), que se autorregistram no
SCM via `ServiceManager`/`ServiceInfo` — assim `packaging/windows/install.ps1`
só precisa baixar o `.exe`, escrever o `config.json` e chamar
`homepulse-client.exe install` / `... start`, sem lógica de registro no
PowerShell.

O desligamento gracioso usa um `tokio_util::sync::CancellationToken`
compartilhado entre os dois loops (`run_heartbeat_loop`, `run_speedtest_loop`
em `src/main.rs`), com três fontes de cancelamento: `SIGTERM`/`SIGINT` no
Unix, Ctrl+C no modo console do Windows, e `ServiceControl::Stop` recebido
pelo control handler registrado junto ao SCM (`src/windows_service.rs`). Essa
mudança também corrige uma lacuna real que já existia no Linux: antes, o
systemd só conseguia matar o processo abruptamente, sem dar chance de
finalizar o ciclo em andamento.

Logging quando rodando como serviço Windows vai para o Visualizador de
Eventos, não para um arquivo: a crate `eventlog` registra `HomePulseClient`
como fonte e inicializa a fachada `log`; a feature `log-always` da própria
crate `tracing` faz cada `tracing::info!`/`error!` também emitir um registro
`log`, que a `eventlog` encaminha ao Event Log — sem precisar escrever um
`tracing::Layer` customizado. No Linux e no modo console do Windows
(`--console`), o comportamento atual (`tracing_subscriber::fmt()` em stdout)
é preservado.

Como pré-requisito, `speedtest.rs` deixou de depender de `kill -9`: o
timeout agora usa `Child::try_wait()` em polling e `Child::kill()`
(cross-platform: `SIGKILL` no Unix, `TerminateProcess` no Windows),
eliminando também a thread + `mpsc` que existia só para contornar isso.

## Alternativas consideradas

- **NSSM (Non-Sucking Service Manager)** — decisão explícita do usuário de
  não usar: embrulha o `.exe` já existente sem exigir nenhuma mudança de
  código, mas adiciona uma dependência externa não versionada junto com o
  binário, e o processo em si não sabe que está rodando como serviço (não
  responde a `SERVICE_CONTROL_STOP` de forma graciosa, não integra com
  Event Log nativamente).
- **Registrar via `sc.exe create` apontando direto para o binário, sem
  tratamento de `SERVICE_CONTROL_STOP`** — mais simples de escrever no
  PowerShell, mas descartado porque o processo não responderia a paradas do
  SCM de forma graciosa, exigindo kill forçado a cada `Stop-Service` e
  perdendo o benefício do `CancellationToken` recém-introduzido.
- **Arquivo de log rotativo (`tracing-appender`) em vez de Event Log** —
  mais simples de implementar (cross-platform, sem crate adicional), mas
  descartado a pedido do usuário: o Visualizador de Eventos é o destino de
  troubleshooting nativo e esperado no Windows.

## Consequências

- Novas dependências Windows-only no `Cargo.toml`
  (`[target.'cfg(windows)'.dependencies]`: `windows-service`, `eventlog`,
  `log`), sem impacto no build Linux.
- CI ganhou um job real em `runs-on: windows-latest`
  (`.github/workflows/client-docker.yml`), que é a autoridade final de
  verificação, já que este ambiente de desenvolvimento não tem um host
  Windows real — apenas `cargo check --target x86_64-pc-windows-gnu`
  localmente para validar compilação do código `#[cfg(windows)]`.
- O cancelamento cooperativo só interrompe os loops entre ticks (no ponto do
  `tokio::select!`), não aborta um speedtest em andamento no meio da
  execução — aceito porque `timeout_seconds` já limita esse tempo e é
  compatível com o timeout padrão de parada do SCM (30s).
- A aba "Windows" do frontend continua desabilitada; habilitá-la é o
  próximo passo natural depois que este trabalho de backend estiver validado
  em um host Windows real, mas fica fora do escopo desta decisão.

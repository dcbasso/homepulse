# Running homepulse-client in Docker

## Why `network_mode: host`

This client's whole purpose is to measure the real throughput, latency and
jitter of the host's internet connection. Docker's default bridge network
sits between the container and the physical NIC, and it changes what is
actually being measured:

```
Host networking (used here):
  speedtest ──► host's physical NIC ──► router/WAN

Default bridge networking (NOT used here):
  speedtest ──► veth pair ──► docker0 bridge ──► iptables NAT (MASQUERADE) ──► host's physical NIC ──► router/WAN
```

With the default bridge:

- **veth pair** — the container's network namespace is connected to the host
  through a virtual cable pair. Every packet crosses this extra hop in
  software before reaching the real NIC, which costs CPU cycles and can
  become a bottleneck on gigabit+ links or weak hardware (Raspberry Pi, a
  Proxmox VM with few vCPUs).
- **iptables NAT (MASQUERADE)** — Docker rewrites the container's internal IP
  to the host's IP for every outbound packet. Each packet goes through the
  conntrack table, adding measurable latency/jitter.
- **Separate network namespace** — the container gets its own routing table,
  ARP cache and (virtual) link. The speedtest ends up measuring Docker's
  virtual network, not necessarily the same path other host processes use.

None of this is what we want to measure. `network_mode: host` removes the
veth pair, the NAT layer and the separate namespace: the container shares
the host's network stack directly, so `speedtest` sees the physical NIC the
same way it would if run natively. The trade-off is losing Docker's network
isolation for this container — acceptable here, since process and
filesystem isolation are still in place, and network isolation was actively
working against the container's purpose.

## Config path inside the container

`config.json` is bind-mounted read-only into the container. Its
`gcp.service_account_key_path` field must point to the path **inside the
container** (`/etc/homepulse/service-account.json`, as mounted in
`docker-compose.yml`), not to the host's file path.

## Usage

```bash
cd client/homepulse-client/docker
docker compose up -d --build
```

The entrypoint reads `interval_minutes` from `config.json` and re-runs
`homepulse-client` on that interval, replacing the systemd timer used in the
Proxmox deployment (see `../deploy/proxmox_start_service.md`).
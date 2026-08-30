FROM rust:1-slim-bookworm AS builder

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg jq \
    && curl -fsSL https://packagecloud.io/ookla/speedtest-cli/gpgkey \
        | gpg --dearmor -o /usr/share/keyrings/ookla-speedtest-cli-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/ookla-speedtest-cli-archive-keyring.gpg] https://packagecloud.io/ookla/speedtest-cli/debian/ bookworm main" \
        > /etc/apt/sources.list.d/ookla_speedtest-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends speedtest \
    && apt-get purge -y curl gnupg \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/homepulse-client /usr/local/bin/homepulse-client
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
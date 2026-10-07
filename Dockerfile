# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY web/package.json web/
# ルートパッケージ (Tauri CLI 等) は web のビルドに不要なので filter で外す。
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --filter "@gim/web..."
COPY packages/shared packages/shared
COPY web web
RUN pnpm -C web build

FROM rust:1.92-bookworm AS server
WORKDIR /src
COPY . .
# rust-embed はコンパイル時に web/dist を取り込むため、cargo build より前に置く。
COPY --from=web /src/web/dist web/dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release -p gim-server && \
    cp target/release/gim-server /usr/local/bin/gim-server

FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home gim
COPY --from=server /usr/local/bin/gim-server /usr/local/bin/gim-server
USER 10001:10001
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD curl -fsS http://127.0.0.1:5180/api/health || exit 1
ENTRYPOINT ["gim-server"]
CMD ["--host", "0.0.0.0", "--port", "5180", "--data-dir", "/data"]

# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24-alpine AS web-build
WORKDIR /src/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.22.0
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/mediamtx-control ./cmd/server

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -g 10001 panel && adduser -D -u 10001 -G panel panel && mkdir /data && chown panel:panel /data
COPY --from=build /out/mediamtx-control /usr/local/bin/mediamtx-control
COPY --from=web-build /src/web/out /opt/panel/web
USER 10001:10001
ENV MTXUI_DATABASE=/data/app.db MTXUI_LISTEN=:8083 MTXUI_STATIC_DIR=/opt/panel/web
EXPOSE 8083
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["mediamtx-control", "-healthcheck"]
ENTRYPOINT ["mediamtx-control"]

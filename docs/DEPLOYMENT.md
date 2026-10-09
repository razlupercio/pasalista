# Deploying PasaLista

This guide runs PasaLista on a single Linux server with Docker Compose behind
[Caddy](https://caddyserver.com/), which provides HTTPS automatically. Any reverse proxy works
(nginx, Traefik) as long as it terminates TLS and appends the client address to
`X-Forwarded-For`.

HTTPS is required: browsers only allow the camera on secure origins, and session cookies are
marked `Secure` when `PUBLIC_URL` starts with `https://`.

## Requirements

- A server with Docker and Compose v2 (1 vCPU and 1 GB of RAM are enough for small events).
- A domain pointing to the server (for example `pasalista.example.org`), ports 80 and 443 open.
- An SMTP account to send emails (verification, tickets, invitations).

## 1. Secrets

Generate them once and keep them in a password manager. Never reuse the development defaults:
the API refuses to start in production with them.

```bash
# BETTER_AUTH_SECRET: signs sessions and auth tokens
openssl rand -base64 48

# QR_KEY_ENCRYPTION_KEY: encrypts each event's QR signing key (32 bytes, base64url)
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='

# POSTGRES_PASSWORD
openssl rand -hex 24
```

> **Back up `QR_KEY_ENCRYPTION_KEY` separately from the database.** Without it, the stored event
> keys cannot be decrypted, so no ticket can be issued or verified.

## 2. Configuration

Clone the repository on the server and create a `.env` file next to the compose file below
(`.env.example` documents every variable):

```dotenv
NODE_ENV=production
PUBLIC_URL=https://pasalista.example.org
BETTER_AUTH_SECRET=...
QR_KEY_ENCRYPTION_KEY=...
QR_KEY_ENCRYPTION_KEY_ID=k1
POSTGRES_PASSWORD=...
# Caddy appends the client address: exactly one trusted hop.
TRUSTED_PROXY_HOPS=1
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASSWORD=...
EMAIL_FROM=PasaLista <no-reply@example.org>
# Rejects breached passwords via Have I Been Pwned; set to false without outbound HTTPS.
PASSWORD_BREACH_CHECK=true
LOG_LEVEL=info
```

`TRUSTED_PROXY_HOPS` must match the number of proxies you control in front of the app. With
Caddy directly in front, it is `1`. A higher value lets clients spoof their IP and bypass rate
limits; `0` would rate-limit everyone as the proxy's address.

## 3. Compose file and Caddyfile

Save as `compose.prod.yml` in the repository root:

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: pasalista
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?}
      POSTGRES_DB: pasalista
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pasalista -d pasalista"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build: { context: ., dockerfile: docker/api.Dockerfile }
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://pasalista:${POSTGRES_PASSWORD}@postgres:5432/pasalista
    depends_on:
      postgres: { condition: service_healthy }

  web:
    build:
      context: .
      dockerfile: docker/web.Dockerfile
      args: { API_INTERNAL_URL: "http://api:3001" }
    restart: unless-stopped
    environment:
      API_INTERNAL_URL: http://api:3001
    depends_on:
      api: { condition: service_healthy }

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web]

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

Only Caddy publishes ports; the API, web and database are reachable only inside the Compose
network. Save as `Caddyfile`:

```caddyfile
pasalista.example.org {
	encode zstd gzip
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	reverse_proxy web:3000
}
```

The web server forwards `/api/*` to the API (single origin, ADR-0004), so Caddy only needs to
reach `web`.

## 4. Start

```bash
docker compose -f compose.prod.yml up --build -d
docker compose -f compose.prod.yml logs -f api   # "Migrations applied", then the API listens
```

The API applies pending database migrations every time it starts. Open your domain, create the
first account and verify it from the email you receive.

## Upgrades

```bash
git pull
docker compose -f compose.prod.yml up --build -d
```

Read [`CHANGELOG.md`](../CHANGELOG.md) first. Take a backup before upgrading: migrations only
move forward.

## Backups

Back up the database daily and copy the dumps off the server:

```bash
docker compose -f compose.prod.yml exec -T postgres \
  pg_dump -U pasalista -Fc pasalista > "pasalista-$(date +%F).dump"
```

Restore into an empty database with `pg_restore -U pasalista -d pasalista --clean`. Keep the
secrets (especially `QR_KEY_ENCRYPTION_KEY`) in a separate, safe place.

## Operations

- **One API instance.** Rate limits are kept in memory per process; running several API
  replicas would multiply the limits.
- **Logs** go to stdout as JSON (pino) and never contain tokens, keys or personal data.
- **Health check:** `GET /api/v1/health` (used by the API container's health check).
- **Privacy:** organizers can delete an event's personal data from its page (ADR-0011); the
  dashboard reminds them 90 days after an event ends.
- **Email deliverability:** configure SPF, DKIM and DMARC for the `EMAIL_FROM` domain, or tickets
  may land in spam.

# Deployment (Docker Compose)

Self-hosted stack: the bot + its own PostgreSQL database, one command to run.

## Prerequisites

- A server with Docker and the Docker Compose plugin installed.
- A Discord bot application (token + client id). In the Discord Developer
  Portal enable the **Server Members** and **Message Content** privileged intents.

## Steps

```bash
git clone <your-repo-url>
cd Discord-Support-Bot-for-OnlyOffice

cp .env.example .env
nano .env            # fill in the values (see below)

docker compose up -d --build
```

That's it. On first boot Postgres creates the schema automatically, the bot
registers its slash commands and connects.

## What to put in `.env`

| Variable | What it is |
|---|---|
| `DISCORD_TOKEN` | Bot token from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application (client) ID |
| `DISCORD_GUILD_ID` | Optional. A server ID to register commands instantly; empty = global |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials (pick your own; used by both containers) |
| `DOCSPACE_BASE_URL` / `DOCSPACE_API_KEY` / `DOCSPACE_TRANSCRIPTS_FOLDER_ID` | Optional DocSpace transcript storage; leave blank to attach the HTML file instead |

`.env` is the single place for all configuration and is git-ignored.

## Everyday commands

```bash
docker compose logs -f bot        # live bot logs
docker compose restart bot        # restart after pulling new code
docker compose down               # stop everything (data is kept in the volume)
docker compose up -d --build      # rebuild + start after `git pull`
```

The bot also writes logs to `./logs/` on the host.

## Data & backups

The database lives in the `pgdata` Docker volume. Back it up with:

```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup.sql
```

The database port is **not** exposed outside the Compose network. To inspect it,
either add an `adminer` service or temporarily map a port.

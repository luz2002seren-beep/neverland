# Never Land Bot V2 — preview and release guide

> **Current release state:** this is a preview-branch build. The production
> website and its existing database stay untouched. `RUN_BOT` defaults to
> `false`, so installing this branch alone never starts a Discord client.

## What the clean V2 build contains

- A new isolated runtime in `src/bot/` — it does not import or restore the
  removed bot implementation.
- A persistent, database-backed control center at **`/bot-control`**.
- Role-based moderation commands: `/warn`, `/timeout`, `/kick`, `/ban`,
  `/clear`, `/lock`, and `/unlock`.
- A small, deliberate AutoMod layer: duplicate-message spam, mass mentions,
  blocked words, configurable delete/warn/timeout actions, exemptions and logs.
- Ticket panels, one open ticket per member, support-role permissions, archived
  closed tickets, and ticket/moderation/member/message logs.
- Welcome messages and a status endpoint that remains healthy even while the
  bot is disabled or needs configuration.
- A standalone, narrow Discord REST relay in `services/discord-rest-proxy/`
  for a **durable** deployment when direct Railway-to-Discord REST is not
  reliable. It contains no bot token at rest.

The control center deliberately validates every field and only persists the
known V2 configuration shape. It does not overwrite legacy per-guild website
settings.

## Local preview (no Discord token)

```bash
cd never-land
DEMO_MODE=true RUN_BOT=false PORT=8080 npm start
```

Open `/bot-control`. In demo mode the V2 control center is editable and uses a
local database only. It cannot contact Discord because `RUN_BOT=false`.

Run the isolated checks with:

```bash
npm test
```

The tests cover both the preserved website health route and the Bot V2 control
center/configuration sanitization without starting a Discord bot, proxy, or
external connection.

## Railway configuration — only after review approval

Do **not** paste any of these values into chat or commit them. Enter them in
Railway's service variables after creating a newly generated Discord bot token.

| Variable | Web + bot service value |
|---|---|
| `RUN_BOT` | `true` only at the approved activation step |
| `DISCORD_TOKEN` | Newly regenerated Discord bot token |
| `CLIENT_ID` | Discord application ID |
| `PRIMARY_GUILD_ID` | The single Discord server allowed for this first V2 release |
| `DISCORD_REST_MODE` | `proxy` |
| `DISCORD_REST_PROXY_URL` | HTTPS URL of the separately deployed relay, without a trailing slash |
| `DISCORD_REST_PROXY_SECRET` | Long random shared secret, identical to the relay's secret |
| `PORT` | `8080` — retain the existing Railway domain target port |

Also enable **Server Members Intent** and **Message Content Intent** in the
Discord Developer Portal before activating the bot. The initial runtime needs
both for welcome events and AutoMod; it only responds in `PRIMARY_GUILD_ID`.

### Durable REST relay

Deploy `services/discord-rest-proxy/` as a **separate persistent service**
(e.g. a second Railway service), with its root directory set to that folder.
It has no package dependencies and listens on `PORT` (use `8080`). Set only:

| Relay variable | Value |
|---|---|
| `PROXY_SHARED_SECRET` | The same long random value used as `DISCORD_REST_PROXY_SECRET` |

The relay accepts only authenticated `POST /v1/discord` requests, constrains
routes to Discord API v10, never logs authorization headers, and exposes only
`GET /healthz` for health monitoring. It forwards the short-lived request
header to `https://discord.com/api/v10`; it does **not** retain a bot token.

For a local development environment with known-good direct Discord access, use
`DISCORD_REST_MODE=direct` explicitly. There is no accidental direct fallback
in the production-safe default.

## Activation gate checklist

1. Review the preview at `/bot-control` and approve its scope.
2. Confirm the existing website, OAuth, and database are healthy.
3. Deploy and health-check the standalone relay (`/healthz`).
4. Add a **newly reset** bot token and the variables above in Railway — never in
   chat, source code, screenshots, or a committed `.env` file.
5. Invite the bot to the chosen primary server with the required permissions;
   check its role is above any moderation targets it should manage.
6. Keep `RUN_BOT=false` until all prior checks pass, then turn it on and monitor
   the website `/healthz` plus the bot's control-center status.
7. Test in a safe channel: `/ping`, a ticket panel, an AutoMod test word, and
   one non-destructive log event before relying on moderation actions.

No production deployment or secret configuration is part of this preview
branch. The release decision remains explicitly user-approved.

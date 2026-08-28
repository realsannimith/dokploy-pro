<div align="center">
  <a href="https://dokploy.com">
    <img src=".github/sponsors/logo.png" alt="Dokploy - Open Source Alternative to Vercel, Heroku and Netlify." width="100%"  />
  </a>
  </br>
  </br>
  <p>Join us on Discord for help, feedback, and discussions!</p>
  <a href="https://discord.gg/2tBnJ3jDJc">
    <img src="https://discordapp.com/api/guilds/1234073262418563112/widget.png?style=banner2" alt="Discord Shield"/>
  </a>
</div>
<br />


Dokploy is a free, self-hostable Platform as a Service (PaaS) that simplifies the deployment and management of applications and databases.

## ✨ Features

Dokploy includes multiple features to make your life easier.

- **Applications**: Deploy any type of application (Node.js, PHP, Python, Go, Ruby, etc.).
- **Databases**: Create and manage databases with support for MySQL, PostgreSQL, MongoDB, MariaDB, libsql, and Redis.
- **Backups**: Automate backups for databases to an external storage destination.
- **Docker Compose**: Native support for Docker Compose to manage complex applications.
- **Multi Node**: Scale applications to multiple nodes using Docker Swarm to manage the cluster.
- **Templates**: Deploy open-source templates (Plausible, Pocketbase, Calcom, etc.) with a single click.
- **Traefik Integration**: Automatically integrates with Traefik for routing and load balancing.
- **Real-time Monitoring**: Monitor CPU, memory, storage, and network usage for every resource.
- **Docker Management**: Easily deploy and manage Docker containers.
- **CLI/API**: Manage your applications and databases using the command line or through the API.
- **Notifications**: Get notified when your deployments succeed or fail (via Slack, Discord, Telegram, Email, etc.).
- **Multi Server**: Deploy and manage your applications remotely to external servers.
- **Self-Hosted**: Self-host Dokploy on your VPS.

## 🔥 What's different in this version

This is a customized build of Dokploy with extra features on top of the official `canary` branch:

- **Remote server monitoring on the main dashboard**: the **Monitoring** page has a server selector, so you can watch CPU, memory, disk, and network history for the Dokploy server *and* every remote server — not just the local one.
- **Per-server monitoring on self-hosted**: the monitoring button on each server card (Settings → Servers) now works on self-hosted installs (previously cloud-only).
- **Dokploy server monitoring setup in the UI**: configure the metrics service for the main server under **Settings → Server → Monitoring**.
- **Built-in MCP server**: an MCP (Model Context Protocol) endpoint at `/api/mcp` exposes the entire Dokploy API (599 tools) to AI agents like Claude Code and Cursor — create projects, applications, and databases, set environment variables, deploy to remote servers, and more, without opening the dashboard.

### Setting up this version

This repo ships its own [install.sh](install.sh) that installs **this version directly** — it does everything the official installer does (Docker, Docker Swarm, Postgres, Traefik, secrets), but deploys *your* image and wires up the fork-aware updater automatically.

**1. Build and push this fork's image** (from the repo root, on your machine):

```bash
cp apps/dokploy/.env.production.example .env.production
cp apps/dokploy/.env.production.example apps/dokploy/.env.production
docker build -t YOUR_DOCKERHUB_USER/dokploy:custom -f Dockerfile .
docker push YOUR_DOCKERHUB_USER/dokploy:custom
```

**2. Install directly on your VPS** (as root):

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/self-dokploy/canary/install.sh | DOKPLOY_IMAGE=YOUR_DOCKERHUB_USER/dokploy bash
```

That's it — open `http://your-server-ip:3000`. The tag defaults to `custom`; override it with `DOKPLOY_TAG=mytag` if you push a different one.

**Already installed official Dokploy?** No need to reinstall — just switch the running service to your image:

```bash
docker service update --image YOUR_DOCKERHUB_USER/dokploy:custom --env-add DOKPLOY_IMAGE=YOUR_DOCKERHUB_USER/dokploy --env-add RELEASE_TAG=custom dokploy
```

### Updates from your own image

This version's in-app updater is fork-aware. When the `DOKPLOY_IMAGE` env var is set on the `dokploy` service (the installer sets it for you):

- The **update check** (Settings → Web Server) compares the running image digest against `DOKPLOY_IMAGE:RELEASE_TAG` on Docker Hub — your repository, not the official one.
- The **Update** button pulls and redeploys *your* image, so you never get switched back to the official build.

To ship a new build, just rebuild and push the same tag, then click Update in the UI (or wait for the auto update check):

```bash
docker build -t YOUR_DOCKERHUB_USER/dokploy:custom -f Dockerfile . && docker push YOUR_DOCKERHUB_USER/dokploy:custom
```

You can also update from the command line on the VPS:

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/self-dokploy/canary/install.sh | DOKPLOY_IMAGE=YOUR_DOCKERHUB_USER/dokploy bash -s update
```

> [!NOTE]
> The update check uses the public Docker Hub API, so your image repository must be public. Without `DOKPLOY_IMAGE` set, the updater behaves exactly like official Dokploy.

For local development instead, follow the [Contributing Guide](CONTRIBUTING.md) (`pnpm install`, `pnpm run dokploy:setup`, `pnpm run dokploy:dev`).

### Enabling remote server monitoring

1. Go to **Settings → Servers**, open **Setup Server** on the remote server, and save the **Monitoring** tab (a token is generated automatically). This deploys the metrics agent on that server.
2. Make sure the Dokploy host can reach the remote server on the metrics port (default `4500`) — open it in the remote server's firewall.
3. Open the **Monitoring** page and pick the server from the dropdown. The chart button on each server card in **Settings → Servers** works too.

For the Dokploy server itself, enable metrics under **Settings → Server → Monitoring**.

### Connecting an AI agent (MCP)

1. Generate an API key in **Settings → Profile → API/CLI Keys**.
2. Use the ready-made config shown in **Settings → Profile → MCP Server**, e.g. for Claude Code:

```bash
claude mcp add --transport http dokploy https://your-dokploy-domain/api/mcp --header "x-api-key: YOUR_API_KEY"
```

The agent gets the same access as the API key's user and can manage projects, applications, databases, domains, env variables, deployments, and remote servers through the full Dokploy API.

## 🚀 Getting Started

To get started, run the following command on a VPS:

Want to skip the installation process? [Try the Dokploy Cloud](https://app.dokploy.com).

```bash
curl -sSL https://dokploy.com/install.sh | bash
```

For detailed documentation, visit [docs.dokploy.com](https://docs.dokploy.com).


[Github Sponsors](https://github.com/sponsors/Siumauricio)

### Contributors 🤝

<a href="https://github.com/dokploy/dokploy/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=dokploy/dokploy" alt="Contributors" />
</a>

## 📺 Video Tutorial

<a href="https://youtu.be/mznYKPvhcfw">
  <img src="https://dokploy.com/banner.png" alt="Watch the video" width="400"/>
</a>

## 🤝 Contributing

Check out the [Contributing Guide](CONTRIBUTING.md) for more information.

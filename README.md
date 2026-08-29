<div align="center">
  <a href="https://dokploy.com">
    <img src=".github/sponsors/logo.png" alt="Dokploy - Open Source Alternative to Vercel, Heroku and Netlify." width="100%"  />
  </a>
  <h1>Dokploy Pro</h1>
  <p>A customized Dokploy distribution with enhanced monitoring and built-in MCP access.</p>
  </br>
  </br>
  <p>Join us on Discord for help, feedback, and discussions!</p>
  <a href="https://discord.gg/2tBnJ3jDJc">
    <img src="https://discordapp.com/api/guilds/1234073262418563112/widget.png?style=banner2" alt="Discord Shield"/>
  </a>
</div>
<br />


Dokploy Pro is a customized distribution of [Dokploy](https://github.com/Dokploy/dokploy), the free, self-hostable Platform as a Service (PaaS) that simplifies the deployment and management of applications and databases.

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

## 🔥 What's different in Dokploy Pro

Dokploy Pro adds extra features on top of Dokploy's official `canary` branch:

- **Remote server monitoring on the main dashboard**: the **Monitoring** page has a server selector, so you can watch CPU, memory, disk, and network history for the Dokploy server *and* every remote server — not just the local one.
- **Per-server monitoring on self-hosted**: the monitoring button on each server card (Settings → Servers) now works on self-hosted installs (previously cloud-only).
- **Dokploy server monitoring setup in the UI**: configure the metrics service for the main server under **Settings → Server → Monitoring**.
- **Built-in MCP server**: an MCP (Model Context Protocol) endpoint at `/api/mcp` exposes the entire Dokploy API (599 tools) to AI agents like Claude Code and Cursor — create projects, applications, and databases, set environment variables, deploy to remote servers, and more, without opening the dashboard.
- **Agentic terminal harness**: run `dokploypro-harness` on the Dokploy host for a Hermes-inspired terminal UI backed by the same agent, tools, permissions, skills, memory, sessions, and approval gates as the messaging gateways.

### Setting up Dokploy Pro

The images for Dokploy Pro are **built automatically**: every push to the `canary` branch triggers the [build-image workflow](.github/workflows/build-image.yml), which publishes `ghcr.io/realsannimith/dokploy-pro:custom` and its companion `ghcr.io/realsannimith/dokploy-pro:monitoring-custom` metrics collector to GitHub Container Registry. No Docker Hub account and no local builds are needed.

**One-time:** after the first workflow run, make the package public so servers can pull it — GitHub → your profile → **Packages** → `dokploy-pro` → **Package settings** → **Change visibility** → Public.

Then install on your VPS (as root) with one command — it does everything the official installer does (Docker, Docker Swarm, Postgres, Traefik, secrets), but deploys this version directly:

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/dokploy-pro/canary/install.sh | bash
```

That's it — open `http://your-server-ip:3000`.

**Already installed official Dokploy?** No need to reinstall — just switch the running service to this image:

```bash
docker service update --image ghcr.io/realsannimith/dokploy-pro:custom --env-add DOKPLOY_IMAGE=ghcr.io/realsannimith/dokploy-pro --env-add RELEASE_TAG=custom dokploy
```

To install the `dokploypro-harness` host command as well, use the update script once after switching:

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/dokploy-pro/canary/install.sh | bash -s update
```

### Updates from your own image

Dokploy Pro's in-app updater is fork-aware. The installer sets `DOKPLOY_IMAGE` on the `dokploy` service, which makes:

- The **update check** (Settings → Web Server) compare the running image digest against your image on GitHub Container Registry — not the official `dokploy/dokploy`.
- The **Update** button pull and redeploy *your* image, so you never get switched back to the official build.

So the whole update flow is: **push code to `canary` → wait for the build workflow → click Update in the UI**. You can also update from the command line on the VPS:

```bash
curl -sSL https://raw.githubusercontent.com/realsannimith/dokploy-pro/canary/install.sh | bash -s update
```

> [!NOTE]
> The image package must stay public for the update check and pulls to work. To host the image elsewhere, set `DOKPLOY_IMAGE=youruser/dokploy` (and optionally `DOKPLOY_TAG`) when running `install.sh` — Docker Hub and any OCI registry are supported. Without `DOKPLOY_IMAGE` set on the service, the updater behaves exactly like official Dokploy.

### Releasing versions

Dokploy Pro follows Dokploy's `vMAJOR.MINOR.PATCH` version style and starts at **v0.0.1**. To publish a release, open **GitHub Actions → Release Dokploy Pro → Run workflow**.

- The first run publishes the current `v0.0.1` version.
- Later runs increase the patch version by default: `v0.0.2`, `v0.0.3`, and so on.
- Select `minor` or `major` when the change requires `v0.1.0` or `v1.0.0` instead.
- Every release creates a GitHub Release and publishes versioned (for example, `v0.0.1`) and `latest` application image tags, plus matching `monitoring-v0.0.1` and `monitoring-latest` monitoring tags.

The continuously updated `custom` and `monitoring-custom` tags remain available for `canary` builds.

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

### Using the terminal agent

After installing or updating Dokploy Pro, connect to the server over SSH and run:

```bash
dokploypro-harness
```

The launcher opens an interactive terminal gateway inside the active Dokploy service. Configure and enable an AI provider and agent first under **Settings → AI Agent**. Terminal chats share the same persistent skills and memories as the web and messaging gateways, while keeping their own resumable session history.

Useful commands include `/new`, `/sessions`, `/resume`, `/status`, `/skills`, `/learn`, `/undo`, and `/retry`. Operations that require approval pause in the terminal and show an explicit `[y/N]` prompt before anything changes. Use `dokploypro-harness --help` for launcher options.

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

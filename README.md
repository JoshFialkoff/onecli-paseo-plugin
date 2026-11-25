# OneCLI for Paseo

Route Paseo agents through a [OneCLI](https://onecli.sh) gateway. The gateway injects granted
credentials into outbound requests, so raw API keys never enter the conversation, the agent
environment, or command output. Each user configures their own OneCLI instance and connects
services with OAuth 2.

Requires Paseo 0.15.1 or later on both daemon and client, and a macOS or Linux daemon. Enable
trusted plugins in Paseo, then install:

```sh
paseo plugin add git:JoshFialkoff/onecli-paseo-plugin
```

## Configure your instance

Open **Settings → Plugins → OneCLI → OneCLI** and save:

- **Instance URL** — `https://api.onecli.sh` for OneCLI Cloud, or your self-hosted base URL.
- **API key** — from your OneCLI dashboard under Settings → API keys (`oc_…`).
- **Agent identifier** (optional) — the OneCLI agent whose grants the gateway injects. Leave blank
  to use the workspace default.
- **Workspace ID** (optional) — only for organization-level `oc_org_…` keys.

The API key is encrypted in transit to the daemon and stored in
`$PASEO_HOME/plugin-state/onecli/configuration.json`, owner-only (`0600`). It is never returned to
the client, shown in settings, or placed in any agent environment. Use **Test gateway** to verify
connectivity; **Delete** removes the stored configuration.

## Connect services with OAuth 2

Open **Settings → Plugins → OneCLI → OneCLI connections**. The screen lists the catalog from your
instance. For OAuth apps, press **Connect**: the plugin asks your instance for an authorize URL and
opens the provider's consent screen in your browser. After you approve, the connection appears in
Paseo automatically. Press **Reconnect** to re-authenticate, or **Disconnect** to remove a
connection. Non-OAuth services are added from the OneCLI dashboard.

Grants decide which agents may use a connection. Check the effective access in your OneCLI
dashboard and grant the connection to the agent named in your configuration when needed.

## What agents receive

When an interactive Codex, Claude, OpenCode or Copilot session opens, the plugin fetches the
gateway's container configuration (cached for five minutes) and injects its proxy variables plus
CA trust (`SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE`, `GIT_SSL_CAINFO`,
`NODE_EXTRA_CA_CERTS`, `DENO_CERT`) into the session environment. The gateway CA is written
owner-only under the plugin state directory and combined with the system CA bundle so other TLS
connections keep working. Local MCP endpoints stay direct: `127.0.0.1`, `localhost` and `::1` are
appended to `NO_PROXY`.

Agents also get a native tool:

- `onecli_status()`: report whether this session routes outbound HTTPS through the gateway, the
  configured instance and agent, and the injected variable names. When the gateway is active,
  agents should make API requests directly; if a service answers that it is not connected, the
  agent shows the user its connect URL and retries after they connect it.

If the gateway is unreachable, sessions keep their inherited environment and `onecli_status`
reports the failure, so an outage never blocks agent startup.

## Security notes

- The API key crosses the app-to-plugin RPC encrypted (X25519 + HKDF-SHA256 + ChaCha20-Poly1305)
  and is stored in a plaintext file readable by the daemon user, same-user processes,
  administrators and backups — the same trust model as any local credential file. Deleting the
  configuration here does not revoke the key in OneCLI; do that in the dashboard.
- The OAuth authorize URL is produced by your OneCLI instance and carries the workspace token in
  its query string by design; it is opened in your browser and never logged or persisted by the
  plugin.
- The gateway evaluates policy before decrypting any credential and injects only what the
  configured agent is granted. The plugin itself never reads or stores service credentials.
- Plugins run unsandboxed on the daemon host; this repository contains no secrets or personal
  configuration. Everything is user-provided through the settings screens above.

## Development

```sh
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm run format:check
npm test
```

The test suite exercises the configuration store, sealed submissions, gateway environment
injection and CA handling, and the OAuth app-catalog client against local HTTP fixtures. To
develop against this checkout:

```sh
paseo plugin install /absolute/path/to/onecli-paseo-plugin
paseo plugin reload onecli
```

Apache-2.0. See [NOTICE](NOTICE) for attribution of code derived from the
[paseo-plugins](https://github.com/yuruiz/paseo-plugins) Secrets plugin.

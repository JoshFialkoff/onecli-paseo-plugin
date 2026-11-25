# OneCLI for Paseo — behavior overview

Each user configures their own OneCLI instance (URL, API key, optional agent and workspace) from
the plugin settings screen; nothing is baked into the code. The API key is sealed in transit and
stored owner-only in the plugin state directory, never shown again, and never placed in an agent
environment.

When an interactive Codex, Claude, OpenCode or Copilot session opens, the plugin fetches the
gateway's container configuration, writes the gateway CA (combined with the system bundle) with
owner-only permissions, and injects the proxy and CA-trust variables into the session environment.
Loopback hosts are appended to `NO_PROXY` so local MCP endpoints bypass the gateway. The lookup is
cached for five minutes; failures leave the inherited environment untouched and surface through
the `onecli_status` agent tool and the settings screen.

The **OneCLI connections** screen lists the instance's app catalog. OAuth apps connect through the
instance's authorize redirect: the plugin opens the provider consent screen in the browser, polls
until the connection exists, and can disconnect existing connections. Service credentials stay in
OneCLI; the gateway injects them into outbound requests for agents with a grant, and the plugin
never reads them.

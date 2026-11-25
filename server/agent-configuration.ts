export const supportedProviders = ["codex", "claude", "opencode", "copilot"];

/**
 * Merge OneCLI gateway variables into a session environment. Gateway variables
 * win over inherited values so outbound traffic really reaches the gateway;
 * the loopback bypass applied afterwards keeps local MCP connections direct.
 */
export function withGatewayEnvironment(
  env: Record<string, string>,
  gatewayEnv: Record<string, string> | null,
) {
  return gatewayEnv ? { ...env, ...gatewayEnv } : env;
}

interface LoopbackEnvironment {
  env: Record<string, string>;
  inheritedEnv?: NodeJS.ProcessEnv;
  providerEnv?: Record<string, string>;
}

export function withLoopbackBypass({
  env,
  inheritedEnv = process.env,
  providerEnv = {},
}: LoopbackEnvironment) {
  const entries = new Set<string>();
  for (const source of [inheritedEnv, providerEnv, env]) {
    for (const key of ["NO_PROXY", "no_proxy"]) {
      for (const entry of (source[key] ?? "").split(",")) {
        const trimmed = entry.trim();
        if (trimmed) entries.add(trimmed);
      }
    }
  }
  // Other plugins host loopback MCP servers; their connections must bypass the gateway.
  for (const host of ["127.0.0.1", "localhost", "::1"]) entries.add(host);
  const exclusions = [...entries].join(",");
  return { ...env, NO_PROXY: exclusions, no_proxy: exclusions };
}

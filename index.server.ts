import { z } from "zod";
import { defineAgentTool, type PluginServerContext } from "@getpaseo/plugin/server";
import {
  beginConfiguration,
  completeConfiguration,
  configurationInputSchema,
  configurationStatus,
  deleteConfiguration,
  disconnectConnection,
  gatewayStatus,
  listApps,
  listConnections,
  startAppConnect,
  testGateway,
} from "./shared/contracts.js";
import { ConfigurationStore } from "./server/configuration.js";
import { OneCliApi } from "./server/api.js";
import { OneCliApps } from "./server/apps.js";
import { cleanGatewayFiles, OneCliGateway } from "./server/gateway.js";
import { SealedSubmissions } from "./server/submissions.js";
import {
  supportedProviders,
  withGatewayEnvironment,
  withLoopbackBypass,
} from "./server/agent-configuration.js";
import { resolveStateDirectory } from "./server/state-directory.js";

export default function contribute(server: PluginServerContext) {
  const directory = resolveStateDirectory();
  let store: ConfigurationStore | null = null;
  const submissions = new SealedSubmissions<Promise<{ configured: true }>>();
  const ready = ConfigurationStore.open(directory).then(async (opened) => {
    store = opened;
    // Regenerated on the next fetch; a crash may have left stale files behind.
    await cleanGatewayFiles(directory);
    return opened;
  });
  const api = new OneCliApi(() => store?.get() ?? null);
  const apps = new OneCliApps(api);
  const gateway = new OneCliGateway({ directory, api });
  const sweep = setInterval(() => submissions.prune(), 5000);
  sweep.unref();
  // Startup failures surface through RPC; no credential-bearing logging.
  void ready.catch(() => undefined);

  server.handle(beginConfiguration, () => submissions.begin("onecli-configuration"));
  server.handle(completeConfiguration, async ({ ticketId, envelope }) => {
    const opened = await ready;
    return submissions.complete(ticketId, "onecli-configuration", envelope, (bytes) => {
      const input = configurationInputSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!input.success) throw new Error("invalid");
      return opened.save(input.data).then(() => {
        gateway.reset();
        return { configured: true as const };
      });
    });
  });
  server.handle(configurationStatus, async () => (await ready).status());
  server.handle(deleteConfiguration, async () => {
    await (await ready).remove();
    gateway.reset();
    return { configured: false as const };
  });
  server.handle(gatewayStatus, async () => gateway.status());
  server.handle(testGateway, async () => gateway.test());
  server.handle(listApps, async () => ({ apps: await apps.list() }));
  server.handle(startAppConnect, async ({ provider }) => ({
    authorizeUrl: await apps.connect(provider),
  }));
  server.handle(listConnections, async ({ provider }) => ({
    connections: await apps.connections(provider),
  }));
  server.handle(disconnectConnection, async ({ connectionId }) => ({
    disconnected: await apps.disconnect(connectionId),
  }));

  const onecliStatusTool = defineAgentTool({
    name: "onecli_status",
    description:
      "Report whether this session routes outbound HTTPS through the OneCLI gateway, which injects granted credentials so raw secrets never enter the conversation. Make API requests directly; if a service answers that it is not connected, show the user its connect URL and retry after they connect it.",
    input: z.object({}).strict(),
    execute: async () => {
      const result = await gateway.status();
      return { text: JSON.stringify(result), structuredContent: result };
    },
  });

  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    if (request.purpose !== "interactive") return request;
    if (!supportedProviders.includes(request.provider)) return request;
    await ready;
    const { config } = await paseo.config.get();
    const provider = z
      .object({ env: z.record(z.string(), z.string()).optional() })
      .parse(config.providers[request.provider] ?? {});
    const gatewayEnv = await gateway.environment().catch(() => null);
    const env = withLoopbackBypass({
      env: withGatewayEnvironment(request.env, gatewayEnv),
      providerEnv: provider.env,
    });
    return { ...request, env, tools: [...request.tools, onecliStatusTool] };
  });

  return async () => {
    clearInterval(sweep);
    submissions.close();
    gateway.close();
    api.close();
    store?.close();
  };
}

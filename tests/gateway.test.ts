import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigurationStore } from "../server/configuration.js";
import { OneCliApi } from "../server/api.js";
import { cleanGatewayFiles, OneCliGateway } from "../server/gateway.js";
import { withGatewayEnvironment, withLoopbackBypass } from "../server/agent-configuration.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
  cleanups.length = 0;
});

const certificate = `-----BEGIN CERTIFICATE-----
Zm9vYmFy
-----END CERTIFICATE-----`;

function fixture(handler: (url: URL, respond: (status: number, body: unknown) => void) => void) {
  let requests = 0;
  const seen: string[] = [];
  const server: Server = createServer((req, res) => {
    requests++;
    seen.push(req.url ?? "");
    handler(new URL(req.url ?? "/", "http://127.0.0.1"), (status, body) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(body === undefined ? undefined : JSON.stringify(body));
    });
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    start: () =>
      new Promise<{ port: number }>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("fixture failed");
          resolve({ port: address.port });
        });
      }),
    counts: () => requests,
    seen: () => seen,
  };
}

test("the gateway injects proxy and CA trust variables and caches the lookup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-gateway-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const service = fixture((_url, respond) =>
    respond(200, {
      env: { HTTPS_PROXY: "http://127.0.0.1:10255", NO_PROXY: "gateway.example" },
      caCertificate: certificate,
      caCertificateContainerPath: "/tmp/onecli-ca.pem",
    }),
  );
  const { port } = await service.start();
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  await store.save({
    url: `http://127.0.0.1:${port}`,
    apiKey: "oc_fixture",
    agent: "writer-bot",
    workspaceId: null,
  });
  const api = new OneCliApi(() => store.get());
  cleanups.push(() => api.close());
  const gateway = new OneCliGateway({ directory, api });
  cleanups.push(() => gateway.close());
  const env = await gateway.environment();
  expect(env).not.toBeNull();
  expect(env!.HTTPS_PROXY).toBe("http://127.0.0.1:10255");
  expect(env!.NO_PROXY).toBe("gateway.example");
  expect(env!.ONECLI_GATEWAY).toBe("true");
  const caPath = env!.NODE_EXTRA_CA_CERTS;
  const bundlePath = env!.SSL_CERT_FILE;
  expect(await readFile(caPath, "utf8")).toBe(certificate);
  expect(await readFile(bundlePath, "utf8")).toContain("BEGIN CERTIFICATE");
  for (const file of [caPath, bundlePath]) {
    const info = await stat(file);
    expect(info.mode & 0o077).toBe(0);
  }
  expect(service.seen()[0]).toBe("/v1/container-config?agent=writer-bot");
  await gateway.environment();
  expect(service.counts()).toBe(1);
  const status = await gateway.status();
  expect(status).toMatchObject({
    configured: true,
    reachable: true,
    error: null,
    agent: "writer-bot",
  });
  expect(status.environmentKeys).toContain("HTTPS_PROXY");
  expect(status.environmentKeys).toContain("SSL_CERT_FILE");
});

test("an unreachable gateway leaves the environment untouched and reports the failure", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-down-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const service = fixture((_url, respond) => respond(500, { error: "boom" }));
  const { port } = await service.start();
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  await store.save({
    url: `http://127.0.0.1:${port}`,
    apiKey: "oc_fixture",
    agent: null,
    workspaceId: null,
  });
  const api = new OneCliApi(() => store.get());
  cleanups.push(() => api.close());
  const gateway = new OneCliGateway({ directory, api });
  cleanups.push(() => gateway.close());
  expect(await gateway.environment()).toBeNull();
  const status = await gateway.status();
  expect(status.configured).toBe(true);
  expect(status.reachable).toBe(false);
  expect(status.error).toContain("unreachable");
  // A configuration change resets the cache so the next lookup retries.
  gateway.reset();
  expect(await gateway.test()).toMatchObject({ reachable: false });
  expect(service.counts()).toBe(3);
});

test("cleanup removes regenerated CA files but never the configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-clean-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  await store.save({
    url: "https://api.onecli.sh",
    apiKey: "oc_example",
    agent: null,
    workspaceId: null,
  });
  const file = path.join(directory, "configuration.json");
  await cleanGatewayFiles(directory);
  expect(JSON.parse(await readFile(file, "utf8")).apiKey).toBe("oc_example");
});

test("gateway variables win over inherited values while loopback stays direct", () => {
  const merged = withLoopbackBypass({
    env: withGatewayEnvironment(
      { HTTPS_PROXY: "http://corporate-proxy:8080" },
      { HTTPS_PROXY: "http://127.0.0.1:10255", NO_PROXY: "gateway.example" },
    ),
    providerEnv: { NO_PROXY: "corp.internal" },
  });
  expect(merged.HTTPS_PROXY).toBe("http://127.0.0.1:10255");
  const exclusions = merged.NO_PROXY.split(",");
  for (const host of ["127.0.0.1", "localhost", "::1", "gateway.example", "corp.internal"])
    expect(exclusions).toContain(host);
});

import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigurationStore } from "../server/configuration.js";
import { OneCliApi } from "../server/api.js";
import { OneCliApps } from "../server/apps.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
  cleanups.length = 0;
});

test("the catalog lists apps, starts OAuth flows and manages connections", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-apps-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const seen: { method: string; url: string; auth?: string }[] = [];
  const server: Server = createServer((req, res) => {
    seen.push({
      method: req.method ?? "GET",
      url: req.url ?? "",
      auth: req.headers.authorization,
    });
    if (req.method === "GET" && req.url === "/v1/apps") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          {
            id: "github",
            name: "GitHub",
            connectionType: "oauth",
            configurable: true,
            config: { hasCredentials: true, enabled: true },
            connections: [
              {
                id: "conn-1",
                label: "Work",
                status: "connected",
                connectedAt: "2026-11-25T00:00:00Z",
              },
            ],
            credentialStubs: [{ path: "~/.config/stub", content: { token: "onecli-managed" } }],
          },
          {
            id: "stripe",
            name: "Stripe",
            connectionType: "api_key",
            configurable: false,
            connections: [],
          },
        ]),
      );
      return;
    }
    if (req.method === "GET" && req.url === "/v1/apps/github/authorize") {
      res.statusCode = 302;
      res.setHeader("Location", "https://github.com/login/oauth/authorize?client_id=example");
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/v1/connections?provider=github") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify([
          {
            id: "conn-1",
            label: "Work",
            status: "connected",
            connectedAt: "2026-11-25T00:00:00Z",
            scope: "workspace",
          },
        ]),
      );
      return;
    }
    if (req.method === "DELETE" && req.url === "/v1/connections/conn-1") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "DELETE" && req.url === "/v1/connections/missing") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const { port } = await new Promise<{ port: number }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fixture failed");
      resolve({ port: address.port });
    });
  });
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  await store.save({
    url: `http://127.0.0.1:${port}`,
    apiKey: "oc_fixture",
    agent: null,
    workspaceId: "ws-1",
  });
  const api = new OneCliApi(() => store.get());
  cleanups.push(() => api.close());
  const apps = new OneCliApps(api);

  const catalog = await apps.list();
  expect(catalog).toEqual([
    {
      provider: "github",
      name: "GitHub",
      connectionType: "oauth",
      configurable: true,
      connections: [
        { id: "conn-1", label: "Work", status: "connected", connectedAt: "2026-11-25T00:00:00Z" },
      ],
    },
    {
      provider: "stripe",
      name: "Stripe",
      connectionType: "api_key",
      configurable: false,
      connections: [],
    },
  ]);

  const authorizeUrl = await apps.connect("github");
  expect(authorizeUrl).toBe("https://github.com/login/oauth/authorize?client_id=example");
  expect(seen.some((entry) => entry.url === "/v1/apps/github/authorize")).toBe(true);
  expect(seen.every((entry) => entry.auth === "Bearer oc_fixture")).toBe(true);

  const connections = await apps.connections("github");
  expect(connections).toEqual([
    { id: "conn-1", label: "Work", status: "connected", connectedAt: "2026-11-25T00:00:00Z" },
  ]);

  expect(await apps.disconnect("conn-1")).toBe(true);
  expect(await apps.disconnect("missing")).toBe(false);
});

test("app operations fail safely without configuration", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-inert-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  const api = new OneCliApi(() => store.get());
  cleanups.push(() => api.close());
  const apps = new OneCliApps(api);
  await expect(apps.list()).rejects.toThrow();
  await expect(apps.connect("github")).rejects.toThrow();
});

import { afterEach, expect, test } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigurationStore } from "../server/configuration.js";
import { SealedSubmissions } from "../server/submissions.js";
import { sealValue } from "../shared/sealing.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
  cleanups.length = 0;
});

test("a saved configuration persists with owner-only permissions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-config-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  expect(store.status()).toMatchObject({ configured: false, url: null, error: null });
  await store.save({
    url: "https://api.onecli.sh",
    apiKey: "oc_example",
    agent: "writer-bot",
    workspaceId: null,
  });
  expect(store.status()).toMatchObject({
    configured: true,
    url: "https://api.onecli.sh",
    agent: "writer-bot",
    workspaceId: null,
  });
  const file = path.join(directory, "configuration.json");
  const contents = JSON.parse(await readFile(file, "utf8"));
  expect(contents.apiKey).toBe("oc_example");
  const info = await stat(file);
  expect(info.mode & 0o077).toBe(0);
  const reopened = await ConfigurationStore.open(directory);
  cleanups.push(() => reopened.close());
  expect(reopened.status()).toMatchObject({ configured: true, url: "https://api.onecli.sh" });
  await store.remove();
  expect(store.status().configured).toBe(false);
});

test("invalid configuration input is rejected without touching storage", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-invalid-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  await expect(
    store.save({ url: "not a url", apiKey: "oc_example", agent: null, workspaceId: null }),
  ).rejects.toThrow();
  await expect(
    store.save({ url: "ftp://example.com", apiKey: "oc_example", agent: null, workspaceId: null }),
  ).rejects.toThrow();
  await expect(
    store.save({ url: "https://api.onecli.sh", apiKey: "", agent: null, workspaceId: null }),
  ).rejects.toThrow();
  await expect(
    store.save({
      url: "https://api.onecli.sh",
      apiKey: "oc_x",
      agent: "bad id!",
      workspaceId: null,
    }),
  ).rejects.toThrow();
  expect(store.status().configured).toBe(false);
});

test("a damaged configuration file surfaces an error instead of credentials", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "onecli-damaged-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "configuration.json"), "{ not json", "utf8");
  const store = await ConfigurationStore.open(directory);
  cleanups.push(() => store.close());
  const status = store.status();
  expect(status.configured).toBe(false);
  expect(status.error).toContain("could not be read");
});

test("sealed submissions deliver configuration once and reject changed envelopes", async () => {
  const submissions = new SealedSubmissions<{ configured: true }>();
  cleanups.push(() => submissions.close());
  const ticket = submissions.begin("onecli-configuration");
  const payload = {
    url: "https://api.onecli.sh",
    apiKey: "oc_example",
    agent: null,
    workspaceId: null,
  };
  const envelope = sealValue(ticket, payload);
  const consume = (bytes: Uint8Array) => {
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(payload);
    return { configured: true as const };
  };
  const receipt = submissions.complete(ticket.id, "onecli-configuration", envelope, consume);
  expect(receipt).toEqual({ configured: true });
  // Retrying the same ciphertext returns the original receipt without consuming again.
  expect(submissions.complete(ticket.id, "onecli-configuration", envelope, consume)).toEqual(
    receipt,
  );
  const altered = sealValue(ticket, { ...payload, apiKey: "oc_other" });
  expect(() =>
    submissions.complete(ticket.id, "onecli-configuration", altered, () => {
      throw new Error("must not run");
    }),
  ).toThrow();
});

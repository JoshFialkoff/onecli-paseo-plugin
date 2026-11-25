import { constants } from "node:fs";
import { chmod, mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { OneCliApi } from "./api.js";
import { OneCliError } from "./errors.js";

const containerConfigSchema = z.object({
  env: z.record(z.string(), z.string()),
  caCertificate: z
    .string()
    .min(1)
    .max(262_144)
    .refine((value) => value.includes("BEGIN CERTIFICATE")),
  caCertificateContainerPath: z.string().min(1).max(1024),
});

const SYSTEM_CA_PATHS = [
  "/etc/ssl/cert.pem", // macOS
  "/etc/ssl/certs/ca-certificates.crt", // Debian / Ubuntu
  "/etc/pki/tls/certs/ca-bundle.crt", // RHEL / CentOS / Fedora
];

export interface GatewayStatus {
  configured: boolean;
  url: string | null;
  agent: string | null;
  reachable: boolean | null;
  error: string | null;
  environmentKeys: string[];
}

interface GatewayOptions {
  directory: string;
  api: OneCliApi;
  now?: () => number;
  cacheTtlMs?: number;
}

export class OneCliGateway {
  private readonly directory: string;
  private readonly api: OneCliApi;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private cache: { env: Record<string, string>; at: number } | null = null;
  private pending: Promise<Record<string, string> | null> | null = null;
  private reachable: boolean | null = null;
  private error: string | null = null;
  private closed = false;

  constructor(options: GatewayOptions) {
    this.directory = options.directory;
    this.api = options.api;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? 300_000;
  }

  /**
   * Environment variables that route a process through the OneCLI gateway.
   * Returns null when OneCLI is not configured or the gateway is unreachable;
   * agents then keep their inherited environment.
   */
  async environment(signal?: AbortSignal): Promise<Record<string, string> | null> {
    if (this.closed) return null;
    if (this.cache && this.now() - this.cache.at < this.cacheTtlMs) return this.cache.env;
    if (!this.pending) {
      const pending = this.fetch(signal);
      this.pending = pending.finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  async status(): Promise<GatewayStatus> {
    const configuration = this.api.configurationRef();
    if (!configuration)
      return {
        configured: false,
        url: null,
        agent: null,
        reachable: null,
        error: null,
        environmentKeys: [],
      };
    await this.environment().catch(() => null);
    const env = this.cache?.env ?? {};
    return {
      configured: true,
      url: configuration.url,
      agent: configuration.agent,
      reachable: this.reachable,
      error: this.error,
      environmentKeys: Object.keys(env).sort(),
    };
  }

  /** Force a fresh gateway lookup and report the result. */
  async test(): Promise<GatewayStatus> {
    this.cache = null;
    return this.status();
  }

  /** Drop cached state after a configuration change. */
  reset() {
    this.cache = null;
    this.reachable = null;
    this.error = null;
  }

  close() {
    this.closed = true;
    this.cache = null;
    this.reachable = null;
  }

  private async fetch(signal?: AbortSignal) {
    const configuration = this.api.configurationRef();
    if (!configuration || this.closed) return null;
    try {
      const query = configuration.agent ? { agent: configuration.agent } : undefined;
      const config = await this.api.request<z.infer<typeof containerConfigSchema>>({
        method: "GET",
        path: "/container-config",
        query,
        signal,
        schema: containerConfigSchema,
      });
      const env = await this.materialize(config);
      this.cache = { env, at: this.now() };
      this.reachable = true;
      this.error = null;
      return env;
    } catch (error) {
      this.reachable = false;
      this.error =
        error instanceof OneCliError && error.code === "invalid"
          ? "OneCLI rejected the request. Check the API key and agent identifier."
          : "OneCLI is unreachable. Check the instance URL and the daemon host network.";
      return null;
    }
  }

  private async materialize(config: z.infer<typeof containerConfigSchema>) {
    const directory = path.join(this.directory, "ca");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const caPath = path.join(directory, "onecli-ca.pem");
    const bundlePath = path.join(directory, "ca-bundle.pem");
    await writePrivate(caPath, config.caCertificate);
    const systemCa = await readSystemCa();
    const bundle = systemCa
      ? `${systemCa.trimEnd()}\n${config.caCertificate.trimEnd()}\n`
      : config.caCertificate;
    await writePrivate(bundlePath, bundle);
    return {
      ...config.env,
      // Tools that replace their CA bundle need the combined file; Node appends instead.
      SSL_CERT_FILE: bundlePath,
      REQUESTS_CA_BUNDLE: bundlePath,
      CURL_CA_BUNDLE: bundlePath,
      GIT_SSL_CAINFO: bundlePath,
      NODE_EXTRA_CA_CERTS: caPath,
      DENO_CERT: bundlePath,
      ONECLI_GATEWAY: "true",
    };
  }
}

async function writePrivate(file: string, contents: string) {
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    0o600,
  );
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(file, 0o600);
}

async function readSystemCa() {
  for (const candidate of SYSTEM_CA_PATHS) {
    try {
      const contents = await readFile(candidate, "utf8");
      if (contents.includes("BEGIN CERTIFICATE")) return contents;
    } catch {
      // Try the next platform path.
    }
  }
  return null;
}

/** Remove regenerated CA files; the persisted configuration is never touched. */
export async function cleanGatewayFiles(directory: string) {
  await rm(path.join(directory, "ca"), { recursive: true, force: true }).catch(() => undefined);
}

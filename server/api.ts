import { z } from "zod";
import type { StoredConfiguration } from "./configuration.js";
import { OneCliError } from "./errors.js";

export interface OneCliApiOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

interface RequestInput {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  schema?: z.ZodType;
}

export class OneCliApi {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private closed = false;

  constructor(
    private readonly configuration: () => StoredConfiguration | null,
    options: OneCliApiOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  }

  configurationRef(): StoredConfiguration | null {
    return this.configuration();
  }

  close() {
    this.closed = true;
  }

  private active(): { url: string; apiKey: string; workspaceId: string | null } {
    const configuration = this.configuration();
    if (!configuration || this.closed) throw new OneCliError("not_configured");
    return {
      url: configuration.url,
      apiKey: configuration.apiKey,
      workspaceId: configuration.workspaceId,
    };
  }

  private controller(signal?: AbortSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    return {
      signal: controller.signal,
      done() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      },
    };
  }

  async request<T>(input: RequestInput): Promise<T> {
    const active = this.active();
    const target = new URL(`/v1${input.path}`, active.url);
    for (const [key, value] of Object.entries(input.query ?? {}))
      target.searchParams.set(key, value);
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    const cancellation = this.controller(input.signal);
    try {
      const response = await this.fetchImpl(target, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${active.apiKey}`,
          ...(active.workspaceId ? { "X-Workspace-Id": active.workspaceId } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body,
        signal: cancellation.signal,
        redirect: "error",
      });
      if (!response.ok) throw new OneCliError(response.status >= 500 ? "unavailable" : "invalid");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > this.maxBytes) throw new OneCliError("invalid");
      // 204 responses carry no body; treat emptiness as undefined.
      const parsed: unknown = bytes.length
        ? JSON.parse(new TextDecoder().decode(bytes))
        : undefined;
      if (input.schema) {
        const result = input.schema.safeParse(parsed);
        if (!result.success) throw new OneCliError("invalid");
        return result.data as T;
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof OneCliError) throw error;
      throw new OneCliError("unavailable");
    } finally {
      cancellation.done();
    }
  }

  /** Follow nothing: return the redirect target the browser must open. */
  async redirect(input: Omit<RequestInput, "method" | "body">): Promise<string> {
    const active = this.active();
    const target = new URL(`/v1${input.path}`, active.url);
    for (const [key, value] of Object.entries(input.query ?? {}))
      target.searchParams.set(key, value);
    const cancellation = this.controller(input.signal);
    try {
      const response = await this.fetchImpl(target, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${active.apiKey}`,
          ...(active.workspaceId ? { "X-Workspace-Id": active.workspaceId } : {}),
        },
        signal: cancellation.signal,
        redirect: "manual",
      });
      const location = response.headers.get("location");
      if (!location || response.status < 300 || response.status >= 400)
        throw new OneCliError("invalid");
      return location;
    } catch (error) {
      if (error instanceof OneCliError) throw error;
      throw new OneCliError("unavailable");
    } finally {
      cancellation.done();
    }
  }
}

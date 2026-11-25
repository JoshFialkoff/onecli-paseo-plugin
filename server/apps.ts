import { z } from "zod";
import { appSchema, connectionSchema } from "../shared/contracts.js";
import { OneCliApi } from "./api.js";
import { OneCliError } from "./errors.js";

const connectionEntrySchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().max(256).nullable().default(null),
  status: z.string().min(1).max(64),
  connectedAt: z.string().min(1).max(64).nullable().default(null),
});

const catalogEntrySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  connectionType: z.enum(["oauth", "credentials_import", "api_key", "cloud_only"]),
  configurable: z.boolean().default(false),
  connections: z.array(connectionEntrySchema).default([]),
});

type CatalogEntry = z.infer<typeof catalogEntrySchema>;
type ConnectionEntry = z.infer<typeof connectionEntrySchema>;

export class OneCliApps {
  constructor(private readonly api: OneCliApi) {}

  /** Catalog metadata only; stubs and OAuth client state never cross to the client. */
  async list(signal?: AbortSignal) {
    const entries = await this.api.request<CatalogEntry[]>({
      method: "GET",
      path: "/apps",
      signal,
      schema: z.array(catalogEntrySchema),
    });
    const apps = entries.map((entry) => ({
      provider: entry.id,
      name: entry.name,
      connectionType: entry.connectionType,
      configurable: entry.configurable,
      connections: entry.connections,
    }));
    const parsed = z.array(appSchema).safeParse(apps);
    if (!parsed.success) throw new OneCliError("invalid");
    return parsed.data;
  }

  /**
   * Begin an OAuth 2 connect: OneCLI answers with a redirect to the provider's
   * consent screen, carrying the workspace scope in its query string. The
   * browser must open it; the plugin never follows the redirect itself.
   */
  async connect(provider: string, signal?: AbortSignal) {
    const providerSchema = z.string().min(1).max(128);
    if (!providerSchema.safeParse(provider).success) throw new OneCliError("invalid");
    const authorizeUrl = await this.api.redirect({
      path: `/apps/${encodeURIComponent(provider)}/authorize`,
      signal,
    });
    if (!/^https?:\/\//.test(authorizeUrl)) throw new OneCliError("invalid");
    return authorizeUrl;
  }

  async connections(provider: string, signal?: AbortSignal) {
    const providerSchema = z.string().min(1).max(128);
    if (!providerSchema.safeParse(provider).success) throw new OneCliError("invalid");
    const connections = await this.api.request<ConnectionEntry[]>({
      method: "GET",
      path: "/connections",
      query: { provider },
      signal,
      schema: z.array(connectionEntrySchema),
    });
    const parsed = z.array(connectionSchema).safeParse(connections);
    if (!parsed.success) throw new OneCliError("invalid");
    return parsed.data;
  }

  async disconnect(connectionId: string, signal?: AbortSignal) {
    const idSchema = z.string().min(1).max(256);
    if (!idSchema.safeParse(connectionId).success) throw new OneCliError("invalid");
    try {
      await this.api.request<undefined>({
        method: "DELETE",
        path: `/connections/${encodeURIComponent(connectionId)}`,
        signal,
        schema: z.undefined(),
      });
      return true;
    } catch (error) {
      // A missing connection is already disconnected; other failures propagate.
      if (error instanceof OneCliError && error.code === "invalid") return false;
      throw error;
    }
  }
}

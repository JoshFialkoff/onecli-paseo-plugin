import { constants } from "node:fs";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { configurationInputSchema } from "../shared/contracts.js";
import { OneCliError } from "./errors.js";

const storedSchema = z.object({
  version: z.literal(1),
  url: z.string().min(1).max(2048),
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !/[\r\n]/.test(value)),
  agent: z.string().min(1).max(128).nullable(),
  workspaceId: z.string().min(1).max(128).nullable(),
});
export type StoredConfiguration = z.infer<typeof storedSchema>;

export interface ConfigurationStatus {
  configured: boolean;
  url: string | null;
  agent: string | null;
  workspaceId: string | null;
  error: string | null;
}

export class ConfigurationStore {
  private configuration: StoredConfiguration | null = null;
  private loadError: string | null = null;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;

  private constructor(private readonly directory: string) {}

  static async open(directory: string) {
    const store = new ConfigurationStore(directory);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      const file = await open(store.file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 64 * 1024) throw new OneCliError("invalid");
        store.configuration = storedSchema.parse(JSON.parse(await file.readFile("utf8")));
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        store.loadError = "Stored OneCLI configuration could not be read. Replace or delete it.";
    }
    return store;
  }

  private get file() {
    return path.join(this.directory, "configuration.json");
  }

  private enqueue(operation: () => Promise<void>) {
    if (this.closed) return Promise.reject(new OneCliError("closed"));
    const next = this.writes.then(operation);
    this.writes = next.catch(() => undefined);
    return next;
  }

  get(): StoredConfiguration | null {
    return this.configuration;
  }

  status(): ConfigurationStatus {
    return {
      configured: this.configuration !== null,
      url: this.configuration?.url ?? null,
      agent: this.configuration?.agent ?? null,
      workspaceId: this.configuration?.workspaceId ?? null,
      error: this.loadError,
    };
  }

  save(input: unknown) {
    const parsed = configurationInputSchema.safeParse(input);
    if (!parsed.success) return Promise.reject(new OneCliError("invalid"));
    const next: StoredConfiguration = {
      version: 1,
      url: new URL(parsed.data.url).origin,
      apiKey: parsed.data.apiKey,
      agent: parsed.data.agent,
      workspaceId: parsed.data.workspaceId,
    };
    return this.enqueue(async () => {
      const temporary = path.join(this.directory, `${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(next), "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, this.file);
      } catch {
        throw new OneCliError("unavailable");
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      this.configuration = next;
      this.loadError = null;
    });
  }

  remove() {
    return this.enqueue(async () => {
      try {
        await rm(this.file, { force: true });
      } catch {
        throw new OneCliError("unavailable");
      }
      this.configuration = null;
      this.loadError = null;
    });
  }

  close() {
    this.closed = true;
    this.configuration = null;
  }
}

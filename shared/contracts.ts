import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { envelopeSchema, ticketSchema } from "./sealing.js";

const instanceUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Use an http(s) URL without credentials or a path.");
const apiKeySchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !/[\r\n]/.test(value), "The API key contains invalid characters.");
export const agentIdentifierSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
  .nullable();
export const workspaceIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
  .nullable();

export const configurationInputSchema = z.object({
  url: instanceUrlSchema,
  apiKey: apiKeySchema,
  agent: agentIdentifierSchema.default(null),
  workspaceId: workspaceIdSchema.default(null),
});

export const configurationStatusSchema = z.object({
  configured: z.boolean(),
  url: z.string().nullable(),
  agent: z.string().nullable(),
  workspaceId: z.string().nullable(),
  error: z.string().nullable(),
});

export const beginConfiguration = defineRpc({
  name: "onecli.configuration.begin",
  input: z.object({}),
  output: ticketSchema,
});
export const completeConfiguration = defineRpc({
  name: "onecli.configuration.complete",
  input: z.object({ ticketId: z.string().uuid(), envelope: envelopeSchema }),
  output: z.object({ configured: z.literal(true) }),
});
export const configurationStatus = defineRpc({
  name: "onecli.configuration.status",
  input: z.object({}),
  output: configurationStatusSchema,
});
export const deleteConfiguration = defineRpc({
  name: "onecli.configuration.delete",
  input: z.object({}),
  output: z.object({ configured: z.literal(false) }),
});

export const gatewayStatusSchema = z.object({
  configured: z.boolean(),
  url: z.string().nullable(),
  agent: z.string().nullable(),
  reachable: z.boolean().nullable(),
  error: z.string().nullable(),
  environmentKeys: z.array(z.string()),
});
export const gatewayStatus = defineRpc({
  name: "onecli.gateway.status",
  input: z.object({}),
  output: gatewayStatusSchema,
});
export const testGateway = defineRpc({
  name: "onecli.gateway.test",
  input: z.object({}),
  output: gatewayStatusSchema,
});

export const connectionSchema = z.object({
  id: z.string().min(1).max(256),
  label: z.string().nullable(),
  status: z.string().min(1).max(64),
  connectedAt: z.string().min(1).max(64).nullable(),
});
export const appSchema = z.object({
  provider: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  connectionType: z.enum(["oauth", "credentials_import", "api_key", "cloud_only"]),
  configurable: z.boolean(),
  connections: z.array(connectionSchema),
});
export const listApps = defineRpc({
  name: "onecli.apps.list",
  input: z.object({}),
  output: z.object({ apps: z.array(appSchema) }),
});
export const startAppConnect = defineRpc({
  name: "onecli.apps.connect.start",
  input: z.object({ provider: z.string().min(1).max(128) }),
  output: z.object({ authorizeUrl: z.string().url().max(8192) }),
});
export const listConnections = defineRpc({
  name: "onecli.apps.connections",
  input: z.object({ provider: z.string().min(1).max(128) }),
  output: z.object({ connections: z.array(connectionSchema) }),
});
export const disconnectConnection = defineRpc({
  name: "onecli.apps.disconnect",
  input: z.object({ connectionId: z.string().min(1).max(256) }),
  output: z.object({ disconnected: z.boolean() }),
});

import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useReducer } from "react";
import { Text, View } from "react-native";
import type { RpcOutput } from "@getpaseo/plugin";
import {
  beginConfiguration,
  completeConfiguration,
  configurationStatus,
  deleteConfiguration,
  gatewayStatus,
  testGateway,
} from "../shared/contracts.js";
import { sealValue } from "../shared/sealing.js";
import { PluginButton, usePluginStyles } from "./ui.js";

interface FormState {
  url: string;
  apiKey: string;
  agent: string;
  workspaceId: string;
  pending: boolean;
  message: string;
  failed: boolean;
}

type Action =
  | { type: "field"; field: "url" | "apiKey" | "agent" | "workspaceId"; value: string }
  | { type: "pending" }
  | { type: "done"; message: string; failed: boolean };

function reduce(state: FormState, action: Action): FormState {
  if (action.type === "field")
    return { ...state, [action.field]: action.value, pending: false, message: "", failed: false };
  if (action.type === "pending") return { ...state, apiKey: "", pending: true, message: "" };
  return { ...state, pending: false, message: action.message, failed: action.failed };
}

export function OneCliSettings(props: PluginSurfaceProps) {
  return <OneCliScreen key={props.host.id} {...props} />;
}

function OneCliScreen(props: PluginSurfaceProps) {
  const getStatus = useRpc(configurationStatus);
  const getGateway = useRpc(gatewayStatus);
  const statusKey = useMemo(() => ["onecli-status", props.host.id], [props.host.id]);
  const gatewayKey = useMemo(() => ["onecli-gateway", props.host.id], [props.host.id]);
  const status = useQuery({ queryKey: statusKey, queryFn: () => getStatus({}) });
  const gateway = useQuery({ queryKey: gatewayKey, queryFn: () => getGateway({}) });
  const styles = usePluginStyles(props.theme, props.layout.compact);
  const retry = useCallback(() => {
    void status.refetch();
  }, [status]);
  if (status.isPending || gateway.isPending)
    return <Text style={styles.muted}>Loading OneCLI configuration…</Text>;
  if (status.isError || gateway.isError)
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load the OneCLI configuration. Check the host connection.
        </Text>
        <PluginButton theme={props.theme} label="Retry" onPress={retry} />
      </View>
    );
  return (
    <OneCliForm
      {...props}
      saved={status.data}
      gateway={gateway.data}
      statusKey={statusKey}
      gatewayKey={gatewayKey}
    />
  );
}

interface OneCliFormProps extends PluginSurfaceProps {
  saved: RpcOutput<typeof configurationStatus>;
  gateway: RpcOutput<typeof gatewayStatus> | undefined;
  statusKey: string[];
  gatewayKey: string[];
}

function OneCliForm({
  host,
  theme,
  layout,
  saved,
  gateway,
  statusKey,
  gatewayKey,
}: OneCliFormProps) {
  const begin = useRpc(beginConfiguration);
  const complete = useRpc(completeConfiguration);
  const remove = useRpc(deleteConfiguration);
  const test = useRpc(testGateway);
  const cache = useQueryClient();
  const [form, dispatch] = useReducer(reduce, {
    url: saved.url ?? "https://api.onecli.sh",
    apiKey: "",
    agent: saved.agent ?? "",
    workspaceId: saved.workspaceId ?? "",
    pending: false,
    message: "",
    failed: false,
  });
  const styles = usePluginStyles(theme, layout.compact);
  const edit = useCallback(
    (field: "url" | "apiKey" | "agent" | "workspaceId") => (value: string) =>
      dispatch({ type: "field", field, value }),
    [],
  );
  const refresh = useCallback(async () => {
    await cache.invalidateQueries({ queryKey: statusKey });
    await cache.invalidateQueries({ queryKey: gatewayKey });
    await cache.invalidateQueries({ queryKey: ["onecli-apps", host.id] });
  }, [cache, statusKey, gatewayKey, host.id]);
  const run = useCallback(
    (operation: () => Promise<string>, failure: string) => {
      dispatch({ type: "pending" });
      // Credentials stay outside React Query's mutation cache.
      void operation()
        .then(async (message) => {
          await refresh();
          dispatch({ type: "done", message, failed: false });
          return undefined;
        })
        .catch(() => dispatch({ type: "done", message: failure, failed: true }));
    },
    [refresh],
  );
  const save = useCallback(() => {
    const input = {
      url: form.url.trim(),
      apiKey: form.apiKey,
      agent: form.agent.trim() || null,
      workspaceId: form.workspaceId.trim() || null,
    };
    run(async () => {
      const ticket = await begin({});
      const envelope = sealValue(ticket, input);
      input.apiKey = "";
      await complete({ ticketId: ticket.id, envelope });
      return "Configuration saved. The API key is stored owner-only on the daemon host.";
    }, "Could not save the configuration. Check the URL and API key, then re-enter the key to retry.");
  }, [begin, complete, form, run]);
  const destroy = useCallback(() => {
    run(async () => {
      await remove({});
      return "Saved configuration deleted.";
    }, "Could not delete the configuration. Check the host connection and retry.");
  }, [remove, run]);
  const testGatewayNow = useCallback(() => {
    run(async () => {
      const result = await test({});
      if (!result.configured) return "OneCLI is not configured on this host.";
      if (result.reachable)
        return "Gateway reachable. Agent sessions route outbound HTTPS through OneCLI.";
      return `Gateway unreachable.${result.error ? ` ${result.error}` : ""}`;
    }, "Could not test the gateway. Check the host connection and retry.");
  }, [test, run]);
  const pending = form.pending;
  return (
    <View style={styles.body}>
      <View style={styles.card}>
        <Text style={styles.muted}>
          Route agent sessions through a OneCLI gateway. The gateway injects granted credentials
          into outbound requests, so raw API keys never enter the conversation or the agent
          environment.
        </Text>
        <Text style={styles.text}>
          {saved.configured ? `Configured: ${saved.url}` : "Not configured"}
        </Text>
        {saved.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {saved.error}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel="OneCLI instance URL"
          value={form.url}
          onChangeText={edit("url")}
          placeholder="https://api.onecli.sh"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="OneCLI API key"
          value={form.apiKey}
          onChangeText={edit("apiKey")}
          placeholder={saved.configured ? "Enter a replacement API key to save" : "API key (oc_…)"}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!pending}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="OneCLI agent identifier"
          value={form.agent}
          onChangeText={edit("agent")}
          placeholder="Agent identifier (optional)"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          style={styles.input}
        />
        <TextInput
          accessibilityLabel="OneCLI workspace ID"
          value={form.workspaceId}
          onChangeText={edit("workspaceId")}
          placeholder="Workspace ID (organization keys only)"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          style={styles.input}
        />
        <View style={styles.row}>
          <PluginButton
            theme={theme}
            label={pending ? "Saving..." : "Save"}
            onPress={save}
            disabled={pending}
            primary
          />
          <PluginButton
            theme={theme}
            label="Test gateway"
            onPress={testGatewayNow}
            disabled={pending || !saved.configured}
          />
          <PluginButton
            theme={theme}
            label="Delete"
            onPress={destroy}
            disabled={pending || !saved.configured}
          />
        </View>
        {form.message ? (
          <Text
            accessibilityRole={form.failed ? "alert" : undefined}
            style={form.failed ? styles.error : styles.text}
          >
            {form.message}
          </Text>
        ) : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.text}>Gateway status</Text>
        {gateway ? (
          <>
            <Text style={styles.muted}>
              Reachable: {gateway.reachable === null ? "unknown" : gateway.reachable ? "yes" : "no"}
            </Text>
            {gateway.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {gateway.error}
              </Text>
            ) : null}
            {gateway.environmentKeys.length ? (
              <Text style={styles.muted}>
                Injected variables: {gateway.environmentKeys.join(", ")}
              </Text>
            ) : null}
          </>
        ) : null}
        <Text style={styles.muted}>
          The API key is encrypted in transit, stored in a file readable only by the daemon user,
          and never returned to this screen or to agents.
        </Text>
      </View>
    </View>
  );
}

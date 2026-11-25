import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import {
  configurationStatus,
  disconnectConnection,
  listApps,
  listConnections,
  startAppConnect,
} from "../shared/contracts.js";
import { PluginButton, usePluginStyles } from "./ui.js";

const CONNECTION_LABEL: Record<string, string> = {
  oauth: "OAuth 2",
  credentials_import: "Credential import",
  api_key: "API key",
  cloud_only: "Cloud only",
};

export function OneCliApps(props: PluginSurfaceProps) {
  return <OneCliAppsScreen key={props.host.id} {...props} />;
}

function OneCliAppsScreen(props: PluginSurfaceProps) {
  const getStatus = useRpc(configurationStatus);
  const status = useQuery({
    queryKey: useMemo(() => ["onecli-status", props.host.id], [props.host.id]),
    queryFn: () => getStatus({}),
  });
  const styles = usePluginStyles(props.theme, props.layout.compact);
  if (status.isPending) return <Text style={styles.muted}>Loading OneCLI configuration…</Text>;
  if (status.isError)
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load the OneCLI configuration. Check the host connection.
        </Text>
      </View>
    );
  if (!status.data.configured)
    return (
      <View style={styles.card}>
        <Text style={styles.text}>
          Save your OneCLI instance and API key on the OneCLI settings screen first.
        </Text>
      </View>
    );
  return <AppCatalog {...props} />;
}

function AppCatalog({ host, theme, layout }: PluginSurfaceProps) {
  const getApps = useRpc(listApps);
  const startConnect = useRpc(startAppConnect);
  const getConnections = useRpc(listConnections);
  const disconnect = useRpc(disconnectConnection);
  const cache = useQueryClient();
  const styles = usePluginStyles(theme, layout.compact);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const apps = useQuery({
    queryKey: useMemo(() => ["onecli-apps", host.id], [host.id]),
    queryFn: () => getApps({}),
  });
  const connectionWatch = useQuery({
    queryKey: useMemo(() => ["onecli-connections", host.id, connecting], [host.id, connecting]),
    queryFn: () => getConnections({ provider: connecting! }),
    enabled: connecting !== null,
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (connecting && (connectionWatch.data?.connections.length ?? 0) > 0) {
      setConnecting(null);
      setMessage(
        "Connection established. Grant it to your agent in the OneCLI dashboard if needed.",
      );
      void cache.invalidateQueries({ queryKey: ["onecli-apps", host.id] });
    }
  }, [connecting, connectionWatch.data, cache, host.id]);
  const connect = useMutation({
    mutationFn: async (provider: string) => {
      const { authorizeUrl } = await startConnect({ provider });
      await Linking.openURL(authorizeUrl);
      return provider;
    },
    onSuccess: (provider) => {
      setConnecting(provider);
      setMessage(
        `Waiting for consent for ${provider}… Complete the OAuth 2 sign-in in your browser.`,
      );
    },
    onError: () => {
      setMessage(
        "Could not start the OAuth 2 flow. Check whether the app supports OAuth and retry.",
      );
    },
  });
  const remove = useMutation({
    mutationFn: async (connectionId: string) => disconnect({ connectionId }),
    onSuccess: (result) => {
      setMessage(result.disconnected ? "Connection disconnected." : "Connection was already gone.");
      void cache.invalidateQueries({ queryKey: ["onecli-apps", host.id] });
    },
    onError: () => {
      setMessage("Could not disconnect. Check the host connection and retry.");
    },
  });
  const retry = useCallback(() => {
    void apps.refetch();
  }, [apps]);
  if (apps.isPending) return <Text style={styles.muted}>Loading the app catalog…</Text>;
  if (apps.isError)
    return (
      <View style={styles.card}>
        <Text accessibilityRole="alert" style={styles.error}>
          Could not load the app catalog. Check the OneCLI configuration and host connection.
        </Text>
        <PluginButton theme={theme} label="Retry" onPress={retry} />
      </View>
    );
  const entries = apps.data.apps.map((app) => (
    <View key={app.provider} style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.text}>{app.name}</Text>
        <Text style={styles.muted}>
          {CONNECTION_LABEL[app.connectionType] ?? app.connectionType}
        </Text>
      </View>
      {app.connections.map((connection) => (
        <View key={connection.id} style={styles.row}>
          <Text style={styles.muted}>
            {connection.label ?? connection.id} · {connection.status}
          </Text>
          <PluginButton
            theme={theme}
            label="Disconnect"
            compact
            onPress={() => remove.mutate(connection.id)}
            disabled={remove.isPending}
          />
        </View>
      ))}
      {app.connectionType === "oauth" ? (
        <PluginButton
          theme={theme}
          label={
            connect.isPending || connecting === app.provider
              ? "Waiting for consent..."
              : app.connections.length
                ? "Reconnect"
                : "Connect"
          }
          primary
          compact
          onPress={() => connect.mutate(app.provider)}
          disabled={connect.isPending || connecting !== null}
        />
      ) : (
        <Text style={styles.muted}>
          {app.connectionType === "api_key" || app.connectionType === "credentials_import"
            ? "Add this service from your OneCLI dashboard."
            : "Available on OneCLI Cloud."}
        </Text>
      )}
    </View>
  ));
  return (
    <View style={styles.body}>
      <Text style={styles.muted}>
        Connect services with OAuth 2. The gateway injects their credentials for granted agents;
        tokens never enter the conversation.
      </Text>
      {message ? <Text style={styles.text}>{message}</Text> : null}
      <View style={styles.list}>{entries}</View>
    </View>
  );
}

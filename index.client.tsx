import type { PluginClientContext } from "@getpaseo/plugin/client";
import { OneCliApps } from "./client/apps.js";
import { OneCliSettings } from "./client/settings.js";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: "configuration",
    title: "OneCLI",
    icon: "Globe",
    Component: OneCliSettings,
  });
  client.addSettingsScreen({
    id: "apps",
    title: "OneCLI connections",
    icon: "Link2",
    Component: OneCliApps,
  });
  return () => undefined;
}

import type { PluginTheme } from "@getpaseo/plugin";
import { useCallback, useMemo } from "react";
import { Pressable, type PressableStateCallbackType, StyleSheet, Text } from "react-native";

export function usePluginStyles(theme: PluginTheme, compact = false) {
  return useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          gap: 12,
        },
        body: { gap: 12 },
        text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 22 },
        muted: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 },
        error: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 18 },
        input: {
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 8,
          padding: 12,
          fontSize: 14,
          minWidth: 0,
        },
        row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
        list: { gap: 8 },
      }),
    [theme, compact],
  );
}

interface ButtonProps {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
  compact?: boolean;
}

export function PluginButton({
  theme,
  label,
  onPress,
  disabled = false,
  primary = false,
  compact = false,
}: ButtonProps) {
  const palette = useMemo(
    () =>
      primary
        ? {
            color: theme.colors.accentForeground,
            background: theme.colors.accent,
            border: theme.colors.accent,
          }
        : {
            color: theme.colors.foreground,
            background: theme.colors.surface1,
            border: theme.colors.border,
          },
    [theme, primary],
  );
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => ({
      justifyContent: "center" as const,
      borderRadius: 6,
      borderWidth: 1,
      paddingHorizontal: compact ? 8 : 12,
      paddingVertical: compact ? 5 : 8,
      borderColor: palette.border,
      backgroundColor: palette.background,
      opacity: pressed && !disabled ? 0.9 : disabled ? 0.5 : 1,
    }),
    [palette, disabled, compact],
  );
  const textStyle = useMemo(
    () => ({
      color: palette.color,
      fontSize: compact ? 12 : 14,
      fontWeight: primary ? ("600" as const) : ("400" as const),
    }),
    [palette, compact, primary],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={style}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

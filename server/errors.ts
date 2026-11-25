export type OneCliErrorCode = "not_configured" | "invalid" | "unavailable" | "capacity" | "closed";

export class OneCliError extends Error {
  constructor(public readonly code: OneCliErrorCode) {
    const messages: Record<OneCliErrorCode, string> = {
      not_configured: "OneCLI is not configured. Save your instance URL and API key first.",
      invalid: "OneCLI returned an unexpected response. Check the instance URL and API key.",
      unavailable: "OneCLI is unreachable. Check the instance URL and the daemon host network.",
      capacity: "Too many pending requests. Wait a moment and retry.",
      closed: "The OneCLI plugin is stopped.",
    };
    super(messages[code]);
  }
}

export type AnthropicFailureKind =
  | "authentication"
  | "rate-limit"
  | "usage-limit"
  | "input-too-large"
  | "output-too-large"
  | "bad-request"
  | "server"
  | "unknown";

export interface AnthropicErrorDetails {
  type?: string;
  message?: string;
}

export function validateAnthropicApiKey(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return "add your Anthropic API key in Settings.";
  }

  if (trimmed.includes("…") || trimmed.includes("...")) {
    return "API key looks redacted; paste the full Anthropic key in Settings.";
  }

  if (!trimmed.startsWith("sk-ant-")) {
    return "API key should start with sk-ant-. Check Settings -> Visual Notes.";
  }

  if (trimmed.length < 40) {
    return "API key appears incomplete. Check Settings -> Visual Notes.";
  }

  return null;
}

export function classifyAnthropicFailure(
  status: number | undefined,
  details: AnthropicErrorDetails = {},
): AnthropicFailureKind {
  const type = details.type ?? "";
  const message = (details.message ?? "").toLowerCase();

  if (status === 401 || type === "authentication_error") {
    return "authentication";
  }

  if (status === 429 || type === "rate_limit_error") {
    return "rate-limit";
  }

  if (
    message.includes("usage limit") ||
    message.includes("usage limits") ||
    message.includes("credit balance")
  ) {
    return "usage-limit";
  }

  if (
    status === 413 ||
    message.includes("prompt is too long") ||
    message.includes("context length") ||
    message.includes("maximum context") ||
    message.includes("input tokens")
  ) {
    return "input-too-large";
  }

  if (message.includes("max_tokens") || message.includes("output tokens")) {
    return "output-too-large";
  }

  if (status === 400 || type === "invalid_request_error") {
    return "bad-request";
  }

  if (status !== undefined && status >= 500) {
    return "server";
  }

  return "unknown";
}

export function retryAfterSeconds(headers: Record<string, string> | undefined): number | undefined {
  const raw = headerValue(headers, "retry-after");
  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
}

function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

import { createHash } from "node:crypto";

export type OpenAiKeySource = "adapter_config_env" | "server_env";
export type OpenAiKeyValidationStatus = "valid" | "invalid" | "rate_limited" | "error";

export interface OpenAiKeyAttempt {
  source: OpenAiKeySource;
  status: OpenAiKeyValidationStatus;
  detail?: string;
  fromCache: boolean;
}

export interface OpenAiKeySelection extends OpenAiKeyAttempt {
  key: string;
}

export interface OpenAiKeyResolution {
  selected: OpenAiKeySelection | null;
  attempts: OpenAiKeyAttempt[];
  ttlSec: number;
}

type CachedProbe = {
  status: OpenAiKeyValidationStatus;
  detail?: string;
  expiresAtMs: number;
};

const DEFAULT_TTL_SEC = 300;
const MIN_POSITIVE_TTL_SEC = 15;
const MAX_TTL_SEC = 3600;
const probeCache = new Map<string, CachedProbe>();

function nowMs() {
  return Date.now();
}

function normalizeTtlSecValue(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TTL_SEC;
  const rounded = Math.trunc(value);
  if (rounded === 0) return 0;
  if (rounded < 0) return DEFAULT_TTL_SEC;
  return Math.max(MIN_POSITIVE_TTL_SEC, Math.min(MAX_TTL_SEC, rounded));
}

function normalizeTtlSec(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TTL_SEC;
  return normalizeTtlSecValue(Number(raw));
}

function normalizeKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function keyCacheId(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function probeOpenAiKey(apiKey: string): Promise<{ status: OpenAiKeyValidationStatus; detail?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const detail = await response.text().then(firstNonEmptyLine).catch(() => "");

    if (response.status === 200) {
      return { status: "valid", detail: "OpenAI models endpoint accepted the API key." };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid", detail: detail || `OpenAI models endpoint returned ${response.status}.` };
    }
    if (response.status === 429) {
      return { status: "rate_limited", detail: detail || "OpenAI models endpoint returned 429 rate limit." };
    }
    return { status: "error", detail: detail || `OpenAI models endpoint returned ${response.status}.` };
  } catch (err) {
    return { status: "error", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export function openAiKeySourceLabel(source: OpenAiKeySource): string {
  return source === "adapter_config_env" ? "adapter config env" : "server environment";
}

export function formatOpenAiApiKeyView(key: string): string {
  const trimmed = key.trim();
  const suffix = trimmed.slice(-4);
  const fingerprint = createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
  return `***${suffix} (sha256:${fingerprint})`;
}

export function formatOpenAiKeyAttempts(attempts: OpenAiKeyAttempt[]): string {
  return attempts
    .map((attempt) => {
      const source = openAiKeySourceLabel(attempt.source);
      const cache = attempt.fromCache ? "cache" : "live";
      const detail = attempt.detail ? ` (${attempt.detail})` : "";
      return `${source}: ${attempt.status} via ${cache}${detail}`;
    })
    .join(" | ");
}

export async function resolveOpenAiApiKeyCandidates(input: {
  adapterOpenAiKey: unknown;
  serverOpenAiKey: unknown;
  ttlSec?: number;
}): Promise<OpenAiKeyResolution> {
  const ttlSec =
    input.ttlSec !== undefined
      ? normalizeTtlSecValue(input.ttlSec)
      : normalizeTtlSec(process.env.PAPERCLIP_CODEX_OPENAI_KEY_VALIDATION_TTL_SEC);
  const cachingEnabled = ttlSec > 0;

  const orderedCandidates: Array<{ source: OpenAiKeySource; key: string }> = [];
  const adapterKey = normalizeKey(input.adapterOpenAiKey);
  const serverKey = normalizeKey(input.serverOpenAiKey);
  if (adapterKey) orderedCandidates.push({ source: "adapter_config_env", key: adapterKey });
  if (serverKey) orderedCandidates.push({ source: "server_env", key: serverKey });

  const seen = new Set<string>();
  const deduped = orderedCandidates.filter((candidate) => {
    if (seen.has(candidate.key)) return false;
    seen.add(candidate.key);
    return true;
  });

  const attempts: OpenAiKeyAttempt[] = [];
  for (const candidate of deduped) {
    const cacheId = keyCacheId(candidate.key);
    const cached = cachingEnabled ? probeCache.get(cacheId) : undefined;
    const now = nowMs();
    if (cached && cached.expiresAtMs > now) {
      const attempt: OpenAiKeyAttempt = {
        source: candidate.source,
        status: cached.status,
        detail: cached.detail,
        fromCache: true,
      };
      attempts.push(attempt);
      if (cached.status === "valid" || cached.status === "rate_limited") {
        return { selected: { ...attempt, key: candidate.key }, attempts, ttlSec };
      }
      continue;
    }

    const probed = await probeOpenAiKey(candidate.key);
    if (cachingEnabled) {
      probeCache.set(cacheId, {
        status: probed.status,
        detail: probed.detail,
        expiresAtMs: now + ttlSec * 1000,
      });
    }
    const attempt: OpenAiKeyAttempt = {
      source: candidate.source,
      status: probed.status,
      detail: probed.detail,
      fromCache: false,
    };
    attempts.push(attempt);
    if (probed.status === "valid" || probed.status === "rate_limited") {
      return { selected: { ...attempt, key: candidate.key }, attempts, ttlSec };
    }
  }

  return { selected: null, attempts, ttlSec };
}

import type { Db } from "@paperclipai/db";
import {
  INSTANCE_CREDENTIAL_ENV_KEYS,
  patchInstanceCredentialsSettingsSchema,
  type InstanceCredentialEnvKey,
  type InstanceCredentialsSettings,
  type InstanceCredentialsView,
  type PatchInstanceCredentialsSettings,
  type SecretProvider,
} from "@paperclipai/shared";
import { instanceSecretService } from "./instance-secrets.js";
import { instanceSettingsService } from "./instance-settings.js";

const DEFAULT_SECRET_PROVIDER: SecretProvider = "local_encrypted";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function secretNameForCredentialKey(key: InstanceCredentialEnvKey): string {
  return `instance_credential_${key}`;
}

function fingerprintFromHash(valueSha256: string): string {
  return valueSha256.slice(0, 12);
}

export function instanceCredentialService(db: Db) {
  const secrets = instanceSecretService(db);
  const settings = instanceSettingsService(db);

  async function describeCredential(
    key: InstanceCredentialEnvKey,
    credentials: InstanceCredentialsSettings,
  ): Promise<InstanceCredentialsView["credentials"][number]> {
    const binding = credentials.envBindings[key];
    if (!binding?.secretId) {
      return {
        key,
        configured: false,
        provider: null,
        fingerprint: null,
        updatedAt: null,
      };
    }

    const secret = await secrets.getById(binding.secretId);
    if (!secret) {
      return {
        key,
        configured: false,
        provider: null,
        fingerprint: null,
        updatedAt: null,
      };
    }
    const selectedVersion = binding.version ?? "latest";
    const resolvedVersion = selectedVersion === "latest" ? secret.latestVersion : selectedVersion;
    const versionRow = await secrets.getSecretVersion(secret.id, resolvedVersion);
    if (!versionRow) {
      return {
        key,
        configured: false,
        provider: null,
        fingerprint: null,
        updatedAt: null,
      };
    }

    return {
      key,
      configured: true,
      provider: secret.provider as SecretProvider,
      fingerprint: fingerprintFromHash(versionRow.valueSha256),
      updatedAt: secret.updatedAt,
    };
  }

  async function getView(): Promise<InstanceCredentialsView> {
    const credentials = await settings.getCredentials();
    const statuses = await Promise.all(
      INSTANCE_CREDENTIAL_ENV_KEYS.map((key) => describeCredential(key, credentials)),
    );
    return {
      precedence: "global_overrides_agent",
      codexOpenAiKeyValidationTtlSec: credentials.codexOpenAiKeyValidationTtlSec,
      credentials: statuses,
    };
  }

  async function ensureSecretForKey(
    key: InstanceCredentialEnvKey,
    value: string,
    credentials: InstanceCredentialsSettings,
    actor: { userId?: string | null; agentId?: string | null } | undefined,
  ): Promise<string> {
    const binding = credentials.envBindings[key];
    const bindingSecret = binding?.secretId ? await secrets.getById(binding.secretId) : null;
    if (bindingSecret) {
      await secrets.rotate(bindingSecret.id, { value }, actor);
      return bindingSecret.id;
    }

    const secretName = secretNameForCredentialKey(key);
    const existingByName = await secrets.getByName(secretName);
    if (existingByName) {
      await secrets.rotate(existingByName.id, { value }, actor);
      return existingByName.id;
    }

    const created = await secrets.create(
      {
        name: secretName,
        provider: DEFAULT_SECRET_PROVIDER,
        value,
        description: `Instance-global credential for ${key}.`,
      },
      actor,
    );
    return created.id;
  }

  async function unsetCredentialKey(
    key: InstanceCredentialEnvKey,
    credentials: InstanceCredentialsSettings,
  ) {
    const binding = credentials.envBindings[key];
    if (binding?.secretId) {
      await secrets.remove(binding.secretId).catch(() => null);
    } else {
      const byName = await secrets.getByName(secretNameForCredentialKey(key));
      if (byName) {
        await secrets.remove(byName.id).catch(() => null);
      }
    }
    delete credentials.envBindings[key];
  }

  async function update(
    patch: PatchInstanceCredentialsSettings,
    actor?: { userId?: string | null; agentId?: string | null },
  ): Promise<InstanceCredentialsView> {
    const parsedPatch = patchInstanceCredentialsSettingsSchema.parse(patch);
    const current = await settings.getCredentials();
    const next: InstanceCredentialsSettings = {
      envBindings: { ...current.envBindings },
      codexOpenAiKeyValidationTtlSec: current.codexOpenAiKeyValidationTtlSec,
    };

    if (parsedPatch.codexOpenAiKeyValidationTtlSec !== undefined) {
      next.codexOpenAiKeyValidationTtlSec = parsedPatch.codexOpenAiKeyValidationTtlSec;
    }

    const envPatch = parsedPatch.env ?? {};
    for (const key of INSTANCE_CREDENTIAL_ENV_KEYS) {
      const change = envPatch[key];
      if (!change) continue;
      if (change.unset === true) {
        await unsetCredentialKey(key, next);
        continue;
      }
      if (typeof change.value === "string" && change.value.length > 0) {
        const secretId = await ensureSecretForKey(key, change.value, next, actor);
        next.envBindings[key] = { secretId, version: "latest" };
      }
    }

    await settings.updateCredentials(next);
    return getView();
  }

  async function resolveRuntimeCredentialEnv(): Promise<Record<string, string>> {
    const credentials = await settings.getCredentials();
    const env: Record<string, string> = {};

    for (const key of INSTANCE_CREDENTIAL_ENV_KEYS) {
      const binding = credentials.envBindings[key];
      if (!binding?.secretId) continue;
      try {
        env[key] = await secrets.resolveSecretValue(binding.secretId, binding.version ?? "latest");
      } catch {
        // Ignore stale/missing secret references and continue with other keys.
      }
    }

    if (credentials.codexOpenAiKeyValidationTtlSec !== null) {
      env.PAPERCLIP_CODEX_OPENAI_KEY_VALIDATION_TTL_SEC = String(credentials.codexOpenAiKeyValidationTtlSec);
    }
    return env;
  }

  async function applyRuntimeCredentials(
    adapterConfig: Record<string, unknown>,
  ): Promise<{ config: Record<string, unknown>; injectedEnvKeys: string[] }> {
    const envOverrides = await resolveRuntimeCredentialEnv();
    if (Object.keys(envOverrides).length === 0) {
      return { config: adapterConfig, injectedEnvKeys: [] };
    }

    const baseEnv = asRecord(adapterConfig.env) ?? {};
    return {
      config: {
        ...adapterConfig,
        env: {
          ...baseEnv,
          ...envOverrides,
        },
      },
      injectedEnvKeys: Object.keys(envOverrides),
    };
  }

  return {
    getView,
    update,
    applyRuntimeCredentials,
    resolveRuntimeCredentialEnv,
  };
}

import type { InstanceCredentialEnvKey } from "../constants.js";
import type { SecretProvider, SecretVersionSelector } from "./secrets.js";

export interface InstanceGeneralSettings {
  censorUsernameInLogs: boolean;
}

export interface InstanceExperimentalSettings {
  enableIsolatedWorkspaces: boolean;
  autoRestartDevServerWhenIdle: boolean;
}

export interface InstanceCredentialBinding {
  secretId: string;
  version?: SecretVersionSelector;
}

export type InstanceCredentialBindings = Partial<Record<InstanceCredentialEnvKey, InstanceCredentialBinding>>;

export interface InstanceCredentialsSettings {
  envBindings: InstanceCredentialBindings;
  codexOpenAiKeyValidationTtlSec: number | null;
}

export interface PatchInstanceCredentialInput {
  value?: string;
  unset?: boolean;
}

export type PatchInstanceCredentialsEnv = Partial<Record<InstanceCredentialEnvKey, PatchInstanceCredentialInput>>;

export interface PatchInstanceCredentialsSettings {
  env?: PatchInstanceCredentialsEnv;
  codexOpenAiKeyValidationTtlSec?: number | null;
}

export interface InstanceCredentialStatus {
  key: InstanceCredentialEnvKey;
  configured: boolean;
  provider: SecretProvider | null;
  fingerprint: string | null;
  updatedAt: Date | null;
}

export interface InstanceCredentialsView {
  precedence: "global_overrides_agent";
  codexOpenAiKeyValidationTtlSec: number | null;
  credentials: InstanceCredentialStatus[];
}

export interface InstanceSettings {
  id: string;
  general: InstanceGeneralSettings;
  experimental: InstanceExperimentalSettings;
  credentials: InstanceCredentialsSettings;
  createdAt: Date;
  updatedAt: Date;
}

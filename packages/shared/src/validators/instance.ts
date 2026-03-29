import { z } from "zod";
import { INSTANCE_CREDENTIAL_ENV_KEYS, type InstanceCredentialEnvKey, SECRET_PROVIDERS } from "../constants.js";
import { envBindingSecretRefSchema } from "./secret.js";

export const instanceGeneralSettingsSchema = z.object({
  censorUsernameInLogs: z.boolean().default(false),
}).strict();

export const patchInstanceGeneralSettingsSchema = instanceGeneralSettingsSchema.partial();

export const instanceExperimentalSettingsSchema = z.object({
  enableIsolatedWorkspaces: z.boolean().default(false),
  autoRestartDevServerWhenIdle: z.boolean().default(false),
}).strict();

export const patchInstanceExperimentalSettingsSchema = instanceExperimentalSettingsSchema.partial();

const instanceCredentialBindingSchema = envBindingSecretRefSchema.pick({
  secretId: true,
  version: true,
});

function instanceCredentialRecordSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object(
      Object.fromEntries(
        INSTANCE_CREDENTIAL_ENV_KEYS.map((key) => [key, valueSchema.optional()]),
      ) as Record<InstanceCredentialEnvKey, z.ZodOptional<T>>,
    )
    .strict();
}

export const instanceCredentialsEnvBindingsSchema = instanceCredentialRecordSchema(
  instanceCredentialBindingSchema,
);

export const instanceCredentialsSettingsSchema = z.object({
  envBindings: instanceCredentialsEnvBindingsSchema.default({}),
  codexOpenAiKeyValidationTtlSec: z.number().int().min(0).max(3600).nullable().default(null),
}).strict();

export const patchInstanceCredentialInputSchema = z.object({
  value: z.string().min(1).optional(),
  unset: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const hasValue = typeof value.value === "string" && value.value.length > 0;
  const hasUnset = value.unset === true;
  if (hasValue === hasUnset) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of `value` or `unset=true`.",
    });
  }
});

export const patchInstanceCredentialsEnvSchema = instanceCredentialRecordSchema(
  patchInstanceCredentialInputSchema,
);

export const patchInstanceCredentialsSettingsSchema = z.object({
  env: patchInstanceCredentialsEnvSchema.optional(),
  codexOpenAiKeyValidationTtlSec: z.number().int().min(0).max(3600).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.env === undefined && value.codexOpenAiKeyValidationTtlSec === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one credentials field must be provided.",
    });
  }
});

export const instanceCredentialStatusSchema = z.object({
  key: z.enum(INSTANCE_CREDENTIAL_ENV_KEYS),
  configured: z.boolean(),
  provider: z.enum(SECRET_PROVIDERS).nullable(),
  fingerprint: z.string().nullable(),
  updatedAt: z.coerce.date().nullable(),
}).strict();

export const instanceCredentialsViewSchema = z.object({
  precedence: z.literal("global_overrides_agent"),
  codexOpenAiKeyValidationTtlSec: z.number().int().min(0).max(3600).nullable(),
  credentials: z.array(instanceCredentialStatusSchema),
}).strict();

export type InstanceGeneralSettings = z.infer<typeof instanceGeneralSettingsSchema>;
export type PatchInstanceGeneralSettings = z.infer<typeof patchInstanceGeneralSettingsSchema>;
export type InstanceExperimentalSettings = z.infer<typeof instanceExperimentalSettingsSchema>;
export type PatchInstanceExperimentalSettings = z.infer<typeof patchInstanceExperimentalSettingsSchema>;
export type InstanceCredentialsSettings = z.infer<typeof instanceCredentialsSettingsSchema>;
export type PatchInstanceCredentialInput = z.infer<typeof patchInstanceCredentialInputSchema>;
export type PatchInstanceCredentialsEnv = z.infer<typeof patchInstanceCredentialsEnvSchema>;
export type PatchInstanceCredentialsSettings = z.infer<typeof patchInstanceCredentialsSettingsSchema>;
export type InstanceCredentialStatus = z.infer<typeof instanceCredentialStatusSchema>;
export type InstanceCredentialsView = z.infer<typeof instanceCredentialsViewSchema>;

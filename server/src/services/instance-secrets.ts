import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { instanceSecrets, instanceSecretVersions } from "@paperclipai/db";
import type { SecretProvider, SecretProviderDescriptor } from "@paperclipai/shared";
import { conflict, notFound } from "../errors.js";
import { getSecretProvider, listSecretProviders } from "../secrets/provider-registry.js";

export function instanceSecretService(db: Db) {
  async function getById(id: string) {
    return db
      .select()
      .from(instanceSecrets)
      .where(eq(instanceSecrets.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getByName(name: string) {
    return db
      .select()
      .from(instanceSecrets)
      .where(eq(instanceSecrets.name, name))
      .then((rows) => rows[0] ?? null);
  }

  async function getSecretVersion(secretId: string, version: number) {
    return db
      .select()
      .from(instanceSecretVersions)
      .where(
        and(
          eq(instanceSecretVersions.secretId, secretId),
          eq(instanceSecretVersions.version, version),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function resolveSecretValue(secretId: string, version: number | "latest"): Promise<string> {
    const secret = await getById(secretId);
    if (!secret) throw notFound("Instance secret not found");
    const resolvedVersion = version === "latest" ? secret.latestVersion : version;
    const versionRow = await getSecretVersion(secret.id, resolvedVersion);
    if (!versionRow) throw notFound("Instance secret version not found");
    const provider = getSecretProvider(secret.provider as SecretProvider);
    return provider.resolveVersion({
      material: versionRow.material as Record<string, unknown>,
      externalRef: secret.externalRef,
    });
  }

  return {
    listProviders: (): SecretProviderDescriptor[] => listSecretProviders(),

    list: () =>
      db
        .select()
        .from(instanceSecrets)
        .orderBy(desc(instanceSecrets.createdAt)),

    getById,
    getByName,
    getSecretVersion,
    resolveSecretValue,

    create: async (
      input: {
        name: string;
        provider: SecretProvider;
        value: string;
        description?: string | null;
        externalRef?: string | null;
      },
      actor?: { userId?: string | null; agentId?: string | null },
    ) => {
      const existing = await getByName(input.name);
      if (existing) throw conflict(`Instance secret already exists: ${input.name}`);

      const provider = getSecretProvider(input.provider);
      const prepared = await provider.createVersion({
        value: input.value,
        externalRef: input.externalRef ?? null,
      });

      return db.transaction(async (tx) => {
        const secret = await tx
          .insert(instanceSecrets)
          .values({
            name: input.name,
            provider: input.provider,
            externalRef: prepared.externalRef,
            latestVersion: 1,
            description: input.description ?? null,
            createdByAgentId: actor?.agentId ?? null,
            createdByUserId: actor?.userId ?? null,
          })
          .returning()
          .then((rows) => rows[0]);

        await tx.insert(instanceSecretVersions).values({
          secretId: secret.id,
          version: 1,
          material: prepared.material,
          valueSha256: prepared.valueSha256,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });

        return secret;
      });
    },

    rotate: async (
      secretId: string,
      input: { value: string; externalRef?: string | null },
      actor?: { userId?: string | null; agentId?: string | null },
    ) => {
      const secret = await getById(secretId);
      if (!secret) throw notFound("Instance secret not found");
      const provider = getSecretProvider(secret.provider as SecretProvider);
      const nextVersion = secret.latestVersion + 1;
      const prepared = await provider.createVersion({
        value: input.value,
        externalRef: input.externalRef ?? secret.externalRef ?? null,
      });

      return db.transaction(async (tx) => {
        await tx.insert(instanceSecretVersions).values({
          secretId: secret.id,
          version: nextVersion,
          material: prepared.material,
          valueSha256: prepared.valueSha256,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });

        const updated = await tx
          .update(instanceSecrets)
          .set({
            latestVersion: nextVersion,
            externalRef: prepared.externalRef,
            updatedAt: new Date(),
          })
          .where(eq(instanceSecrets.id, secret.id))
          .returning()
          .then((rows) => rows[0] ?? null);

        if (!updated) throw notFound("Instance secret not found");
        return updated;
      });
    },

    remove: async (secretId: string) => {
      const secret = await getById(secretId);
      if (!secret) return null;
      await db.delete(instanceSecrets).where(eq(instanceSecrets.id, secretId));
      return secret;
    },
  };
}

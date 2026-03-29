import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  INSTANCE_CREDENTIAL_ENV_KEYS,
  type InstanceCredentialEnvKey,
  type PatchInstanceCredentialsSettings,
} from "@paperclipai/shared";
import { KeyRound } from "lucide-react";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime } from "../lib/utils";

const CREDENTIAL_LABELS: Record<InstanceCredentialEnvKey, string> = {
  OPENAI_API_KEY: "OpenAI",
  ANTHROPIC_API_KEY: "Anthropic",
  GEMINI_API_KEY: "Gemini",
  GOOGLE_API_KEY: "Google",
  CURSOR_API_KEY: "Cursor",
};

type CredentialDraftState = Partial<Record<InstanceCredentialEnvKey, string>>;

type PatchAction = {
  patch: PatchInstanceCredentialsSettings;
  key?: InstanceCredentialEnvKey;
  action: "set" | "unset" | "ttl";
};

function buildEnvPatch(
  key: InstanceCredentialEnvKey,
  value: { value: string } | { unset: true },
): NonNullable<PatchInstanceCredentialsSettings["env"]> {
  return {
    [key]: value,
  } as NonNullable<PatchInstanceCredentialsSettings["env"]>;
}

export function InstanceCredentialsSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<CredentialDraftState>({});
  const [ttlInput, setTtlInput] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Credentials" },
    ]);
  }, [setBreadcrumbs]);

  const credentialsQuery = useQuery({
    queryKey: queryKeys.instance.credentialsSettings,
    queryFn: () => instanceSettingsApi.getCredentials(),
  });

  const patchMutation = useMutation({
    mutationFn: async (input: PatchAction) => instanceSettingsApi.updateCredentials(input.patch),
    onSuccess: async (_data, variables) => {
      setActionError(null);
      if (variables.action === "set" && variables.key) {
        const key = variables.key;
        setDraftValues((previous) => ({ ...previous, [key]: "" }));
      }
      if (variables.action === "ttl") {
        setTtlInput(null);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.instance.credentialsSettings });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update credentials settings.");
    },
  });

  const statusByKey = useMemo(() => {
    const map = new Map<InstanceCredentialEnvKey, { configured: boolean; provider: string | null; fingerprint: string | null; updatedAt: Date | string | null }>();
    for (const item of credentialsQuery.data?.credentials ?? []) {
      map.set(item.key, item);
    }
    return map;
  }, [credentialsQuery.data?.credentials]);

  function updateDraftValue(key: InstanceCredentialEnvKey, value: string) {
    setDraftValues((previous) => ({ ...previous, [key]: value }));
  }

  function saveCredential(key: InstanceCredentialEnvKey) {
    const value = (draftValues[key] ?? "").trim();
    if (!value) {
      setActionError(`Enter a value for ${key} before saving.`);
      return;
    }
    patchMutation.mutate({
      action: "set",
      key,
      patch: {
        env: buildEnvPatch(key, { value }),
      },
    });
  }

  function unsetCredential(key: InstanceCredentialEnvKey) {
    patchMutation.mutate({
      action: "unset",
      key,
      patch: {
        env: buildEnvPatch(key, { unset: true }),
      },
    });
  }

  function saveTtl() {
    const raw = (ttlInput ?? "").trim();
    const parsed = raw === "" ? null : Number.parseInt(raw, 10);
    if (raw !== "" && (!Number.isInteger(parsed) || parsed < 0 || parsed > 3600)) {
      setActionError("Codex validation TTL must be an integer between 0 and 3600 seconds.");
      return;
    }
    patchMutation.mutate({
      action: "ttl",
      patch: {
        codexOpenAiKeyValidationTtlSec: parsed,
      },
    });
  }

  if (credentialsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading instance credentials...</div>;
  }

  if (credentialsQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {credentialsQuery.error instanceof Error
          ? credentialsQuery.error.message
          : "Failed to load instance credentials."}
      </div>
    );
  }

  const currentTtlValue = credentialsQuery.data?.codexOpenAiKeyValidationTtlSec;
  const ttlFieldValue = ttlInput ?? (currentTtlValue === null ? "" : String(currentTtlValue));

  return (
    <div className="max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Global Credentials</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Instance credentials override agent-level values at runtime. Secret values are write-only and are never returned.
        </p>
      </div>

      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Codex OpenAI key validation TTL (seconds)</h2>
            <p className="text-sm text-muted-foreground">
              Set to <code>0</code> for no cache. Leave empty to use default runtime behavior.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-56"
              inputMode="numeric"
              placeholder="Default"
              value={ttlFieldValue}
              onChange={(event) => setTtlInput(event.target.value)}
            />
            <Button
              size="sm"
              onClick={saveTtl}
              disabled={patchMutation.isPending}
            >
              {patchMutation.isPending && patchMutation.variables?.action === "ttl" ? "Saving..." : "Save TTL"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setTtlInput("0")}
              disabled={patchMutation.isPending}
            >
              Set 0
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {INSTANCE_CREDENTIAL_ENV_KEYS.map((key) => {
          const status = statusByKey.get(key);
          const pendingSet = patchMutation.isPending
            && patchMutation.variables?.action === "set"
            && patchMutation.variables?.key === key;
          const pendingUnset = patchMutation.isPending
            && patchMutation.variables?.action === "unset"
            && patchMutation.variables?.key === key;
          const value = draftValues[key] ?? "";

          return (
            <Card key={key}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{CREDENTIAL_LABELS[key]}</h3>
                      <code className="text-xs text-muted-foreground">{key}</code>
                    </div>
                    {status?.configured ? (
                      <p className="text-xs text-muted-foreground">
                        {status.provider ?? "unknown"} {status.fingerprint ? `| ${status.fingerprint}` : ""}
                        {status.updatedAt ? ` | updated ${formatDateTime(status.updatedAt)}` : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not configured.</p>
                    )}
                  </div>
                  <Badge variant={status?.configured ? "default" : "outline"}>
                    {status?.configured ? "Configured" : "Not set"}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    className="min-w-64 flex-1"
                    placeholder={status?.configured ? "Enter a new value to rotate" : "Enter credential value"}
                    value={value}
                    onChange={(event) => updateDraftValue(key, event.target.value)}
                  />
                  <Button
                    size="sm"
                    onClick={() => saveCredential(key)}
                    disabled={pendingUnset || pendingSet}
                  >
                    {pendingSet ? "Saving..." : status?.configured ? "Rotate" : "Set"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!status?.configured || pendingSet || pendingUnset}
                    onClick={() => unsetCredential(key)}
                  >
                    {pendingUnset ? "Removing..." : "Unset"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

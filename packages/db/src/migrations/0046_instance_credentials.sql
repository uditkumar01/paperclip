CREATE TABLE "instance_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'local_encrypted' NOT NULL,
	"external_ref" text,
	"latest_version" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_secret_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"material" jsonb NOT NULL,
	"value_sha256" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "instance_secrets" ADD CONSTRAINT "instance_secrets_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instance_secret_versions" ADD CONSTRAINT "instance_secret_versions_secret_id_instance_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."instance_secrets"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instance_secret_versions" ADD CONSTRAINT "instance_secret_versions_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "instance_secrets_provider_idx" ON "instance_secrets" USING btree ("provider");
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_secrets_name_uq" ON "instance_secrets" USING btree ("name");
--> statement-breakpoint
CREATE INDEX "instance_secret_versions_secret_idx" ON "instance_secret_versions" USING btree ("secret_id","created_at");
--> statement-breakpoint
CREATE INDEX "instance_secret_versions_value_sha256_idx" ON "instance_secret_versions" USING btree ("value_sha256");
--> statement-breakpoint
CREATE UNIQUE INDEX "instance_secret_versions_secret_version_uq" ON "instance_secret_versions" USING btree ("secret_id","version");
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "credentials" jsonb DEFAULT '{}'::jsonb NOT NULL;

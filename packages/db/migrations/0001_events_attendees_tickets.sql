CREATE TYPE "public"."attendee_source" AS ENUM('open_registration', 'import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."attendee_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."signing_key_status" AS ENUM('active', 'retired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('active', 'superseded', 'revoked');--> statement-breakpoint
CREATE TABLE "attendees" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"source" "attendee_source" NOT NULL,
	"status" "attendee_status" DEFAULT 'active' NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ticket_access_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "attendees_ticketAccessHash_unique" UNIQUE("ticket_access_hash")
);
--> statement-breakpoint
CREATE TABLE "event_signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"public_key" "bytea" NOT NULL,
	"private_key_ciphertext" "bytea" NOT NULL,
	"kek_id" text NOT NULL,
	"status" "signing_key_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"venue_name" text NOT NULL,
	"venue_address" text,
	"capacity" integer,
	"registration_mode" "registration_mode" DEFAULT 'open' NOT NULL,
	"registration_deadline" timestamp with time zone,
	"registration_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"attendee_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"key_version" integer NOT NULL,
	"nonce" "bytea" NOT NULL,
	"status" "ticket_status" DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
ALTER TABLE "attendees" ADD CONSTRAINT "attendees_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendees" ADD CONSTRAINT "attendees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_signing_keys" ADD CONSTRAINT "event_signing_keys_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_attendee_id_attendees_id_fk" FOREIGN KEY ("attendee_id") REFERENCES "public"."attendees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendees_event_id_email_index" ON "attendees" USING btree ("event_id","email");--> statement-breakpoint
CREATE INDEX "attendees_organization_id_index" ON "attendees" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_signing_keys_event_id_version_index" ON "event_signing_keys" USING btree ("event_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "event_signing_keys_one_active" ON "event_signing_keys" USING btree ("event_id") WHERE "event_signing_keys"."status" = 'active';--> statement-breakpoint
CREATE INDEX "events_organization_id_starts_at_index" ON "events" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_active_per_attendee" ON "tickets" USING btree ("attendee_id") WHERE "tickets"."status" = 'active';--> statement-breakpoint
CREATE INDEX "tickets_event_id_index" ON "tickets" USING btree ("event_id");
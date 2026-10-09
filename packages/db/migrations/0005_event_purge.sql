ALTER TABLE "email_outbox" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "final_registered_count" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "final_checked_in_count" integer;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_event_id_index" ON "email_outbox" USING btree ("event_id");
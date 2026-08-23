CREATE TABLE "series" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"total" integer,
	"recorrencia_id" integer,
	"origem" text DEFAULT 'app' NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "serie_id" integer;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "criado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_lancamentos_serie" ON "lancamentos" USING btree ("serie_id","seq");
CREATE TABLE "importacoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"titulo" text NOT NULL,
	"arquivo" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criada_por" text,
	"qtd" integer DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "importacao_id" integer;
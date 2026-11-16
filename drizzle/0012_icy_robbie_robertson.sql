CREATE TABLE "reembolsos" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" date NOT NULL,
	"pessoa" text NOT NULL,
	"para_quem" text NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"obs" text,
	"lancamento_id" integer,
	"criado_em" timestamp with time zone DEFAULT now()
);

CREATE TABLE "acerto_contas" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" date NOT NULL,
	"descricao" text,
	"quem_pagou" text,
	"para_quem" text,
	"valor" numeric(12, 2) NOT NULL,
	"obs" text
);
--> statement-breakpoint
CREATE TABLE "config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"pct_irwin_renda" numeric(6, 4) DEFAULT '0.4947' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investimentos_contas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"apelido" text,
	"classe" text,
	"de_quem" text,
	CONSTRAINT "investimentos_contas_nome_unique" UNIQUE("nome")
);
--> statement-breakpoint
CREATE TABLE "investimentos_movimentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" date NOT NULL,
	"conta" text NOT NULL,
	"tipo" text NOT NULL,
	"valor" numeric(12, 2) NOT NULL,
	"de_quem" text,
	"obs" text
);
--> statement-breakpoint
CREATE TABLE "lancamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" date NOT NULL,
	"descricao" text NOT NULL,
	"categoria" text NOT NULL,
	"tipo" text NOT NULL,
	"cat_original" text,
	"fonte" text,
	"valor_total" numeric(12, 2) NOT NULL,
	"divisao" text NOT NULL,
	"pct_irwin_custom" numeric(5, 2),
	"quem_pagou" text,
	"pago_irwin" numeric(12, 2),
	"obs" text,
	"recorrente" boolean DEFAULT false NOT NULL,
	"linha_origem" integer
);
--> statement-breakpoint
CREATE TABLE "patrimonio" (
	"id" serial PRIMARY KEY NOT NULL,
	"data" date NOT NULL,
	"total_investido" numeric(14, 2),
	"dividas" numeric(14, 2),
	"patrimonio_liquido" numeric(14, 2)
);
--> statement-breakpoint
CREATE TABLE "plano_de_contas" (
	"nome" text PRIMARY KEY NOT NULL,
	"palavras_chave" text,
	"tipo_padrao" text,
	"ordem" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recorrencias" (
	"id" serial PRIMARY KEY NOT NULL,
	"data_inicio" date NOT NULL,
	"descricao" text NOT NULL,
	"categoria" text NOT NULL,
	"fonte" text,
	"valor" numeric(12, 2) NOT NULL,
	"divisao" text NOT NULL,
	"pct_irwin_custom" numeric(5, 2),
	"quem_pagou" text,
	"frequencia" text DEFAULT 'mensal' NOT NULL,
	"ultima_geracao" date,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_lancamentos_data" ON "lancamentos" USING btree ("data");--> statement-breakpoint
CREATE INDEX "idx_lancamentos_categoria" ON "lancamentos" USING btree ("categoria");
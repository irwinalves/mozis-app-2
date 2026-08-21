ALTER TABLE "lancamentos" ADD COLUMN "gasto_de" text;--> statement-breakpoint
ALTER TABLE "recorrencias" ADD COLUMN "gasto_de" text;--> statement-breakpoint
CREATE INDEX "idx_lancamentos_gasto_de" ON "lancamentos" USING btree ("gasto_de");
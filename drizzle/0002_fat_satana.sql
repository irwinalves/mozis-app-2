ALTER TABLE "lancamentos" ADD COLUMN "pct_irwin" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "eh_quitacao" boolean DEFAULT false NOT NULL;
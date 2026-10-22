/**
 * A anuidade do Amazon Prime, que parou de ser lançada depois de 2023.
 *
 * A base tem `Anuidade Amazon Prime` em 21/01/2022 (R$ 89,90) e `Amazon Prime`
 * em 21/01/2023 (R$ 119,00). Depois, nada — e a assinatura nunca parou.
 *
 * DE ONDE VEM CADA NÚMERO, que é o que decide a confiança em cada linha:
 *
 * - 2024 · R$ 119,00 — e-mail da prime@amazon.com.br de 18/01/2024: "Em 21 de
 *   janeiro de 2024, cobraremos $119,00 para um ano de Prime". Data e valor
 *   ditos pela Amazon.
 * - 2025 · R$ 166,80 — INFERÊNCIA (C7). O e-mail de 08/02/2024 avisa que o
 *   plano anual sobe de R$ 119 para R$ 166,80, valendo para assinantes atuais
 *   a partir de 08/04/2024; e a renovação de 2026 saiu nesse valor. Não existe
 *   e-mail de 2025 na caixa: a Amazon parou de mandar o lembrete.
 * - 2026 · 12× R$ 13,90 — FATURA, que é prova e não e-mail. `Amazon Prime Br`,
 *   compra de 21/01/2026, parcelas 1 a 10 de 12 aparecem nas faturas de
 *   fevereiro a novembro. 12 × 13,90 = 166,80, fechando com o preço anunciado.
 *
 * 2026 entra como PARCELAMENTO porque foi assim que foi cobrado — e com série,
 * a parcela 11 e a 12 vão ser reconhecidas quando as faturas chegarem, em vez
 * de entrarem duplicadas (A19, A16). 2024 e 2025 entram à vista, como as de
 * 2022 e 2023, porque não há fatura que prove parcelamento naqueles anos.
 *
 * Seco por padrão. `--aplicar` grava.
 */
import postgres from 'postgres';
import { salvarLancamento } from '../src/lib/api';

const sql = postgres(process.env.DATABASE_URL!);
const APLICAR = process.argv.includes('--aplicar');
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COMUM = {
  descricao: 'Anuidade Amazon Prime',
  grupo: '7 Outros',
  tipo: 'Variável',
  fonte: 'Cartão',
  divisao: '50/50',
  quemPagou: 'Irwin',
} as const;

async function saldo() {
  const [r] = await sql<{ s: string }[]>`
    select round(coalesce((select sum(saldo_irwin) from v_lancamentos),0)
               + coalesce((select sum(case when quem_pagou='Irwin' then valor
                                           when quem_pagou='Maria' then -valor else 0 end)
                           from acerto_contas),0),2)::text as s`;
  return Number(r.s);
}

const [ja] = await sql<{ n: string }[]>`
  select count(*)::text as n from lancamentos
   where descricao ilike 'Anuidade Amazon Prime%' and data >= '2024-01-01'`;
if (Number(ja.n) > 0) {
  console.log(`Já existem ${ja.n} linha(s) de 2024 em diante — nada a fazer.`);
  await sql.end();
  process.exit(0);
}

console.log('  2024-01-21   à vista   R$ 119,00   e-mail da Amazon');
console.log('  2025-01-21   à vista   R$ 166,80   inferência do reajuste');
console.log('  2026-01-21   12× 13,90 R$ 166,80   fatura (parcelas 1..10 vistas)');
console.log(`\n  total ${brl(119 + 166.8 + 166.8)} · metade dela ${brl((119 + 166.8 + 166.8) / 2)}`);

const antes = await saldo();
console.log(`\nSaldo hoje: ${brl(antes)}`);

if (!APLICAR) {
  console.log('\nSeco. Rode com --aplicar para gravar.');
  await sql.end();
  process.exit(0);
}

await salvarLancamento({ ...COMUM, data: '2024-01-21', valor: 119,
  obs: 'E-mail Amazon de 18/01/2024: cobrança de R$ 119,00 em 21/01' });
await salvarLancamento({ ...COMUM, data: '2025-01-21', valor: 166.8,
  obs: 'Valor inferido do reajuste de 08/04/2024; sem e-mail de 2025 na caixa' });
const p = await salvarLancamento({ ...COMUM, data: '2026-01-21', valor: 13.9,
  tipoValor: 'parcela', parcelado: true, parcelas: 12,
  obs: 'Fatura: Amazon Prime Br, compra 21/01/2026, 12× R$ 13,90' });

console.log(`\n✓ 2024 e 2025 à vista; 2026 com ${p.qtd} parcelas (${brl(p.total)})`);
console.log(`Saldo agora: ${brl(await saldo())} (era ${brl(antes)})`);
await sql.end();
process.exit(0);

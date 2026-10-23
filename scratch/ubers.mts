/**
 * As três corridas de outubro, lançadas à mão.
 *
 * Insert direto, e NÃO por `salvarLancamento`, de propósito: a árvore de
 * trabalho está com uma migração não aplicada (`de_fora`) e aquela função já
 * escreve a coluna nova, que não existe em produção. Passar por ela aqui
 * falharia — e aplicar a migração para lançar três Ubers seria arrastar uma
 * decisão que não é esta.
 *
 * Os valores derivados são os mesmos que a função produziria no caso simples:
 * pagador 'Irwin' desembolsa o valor inteiro, 50/50 é pct 0,5, e categoria
 * '2 Carro' não é quitação.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const APLICAR = process.argv.includes('--aplicar');
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const CORRIDAS = [
  { data: '2026-10-23', descricao: 'Uber Groenlândia', valor: 12.96 },
  { data: '2026-10-23', descricao: 'Uber Trampolim', valor: 15.98 },
  { data: '2026-10-19', descricao: 'Uber Groenlândia', valor: 14.95 },
];

async function saldo() {
  const [r] = await sql<{ s: string }[]>`
    select round(coalesce((select sum(saldo_irwin) from v_lancamentos),0)
               + coalesce((select sum(case when quem_pagou='Irwin' then valor
                                           when quem_pagou='Maria' then -valor else 0 end)
                           from acerto_contas),0),2)::text as s`;
  return Number(r.s);
}

const soma = CORRIDAS.reduce((a, c) => a + c.valor, 0);
for (const c of CORRIDAS) console.log(`  ${c.data}  ${c.descricao.padEnd(18)} ${brl(c.valor).padStart(10)}`);
console.log(`\n  total ${brl(soma)} · metade da Maria ${brl(soma / 2)}`);

const antes = await saldo();
console.log(`\nSaldo hoje: ${brl(antes)}`);

if (!APLICAR) {
  console.log('\nSeco. Rode com --aplicar para gravar.');
  await sql.end();
  process.exit(0);
}

for (const c of CORRIDAS) {
  await sql`
    insert into lancamentos
      (data, descricao, categoria, tipo, fonte, valor_total, divisao,
       pct_irwin, eh_quitacao, quem_pagou, pago_irwin, obs, recorrente)
    values (${c.data}, ${c.descricao}, '2 Carro', 'Variável', 'Cartão', ${c.valor}, '50/50',
            0.5, false, 'Irwin', ${c.valor}, 'Do histórico de corridas do app do Uber', false)`;
}

const depois = await saldo();
console.log(`\n✓ ${CORRIDAS.length} corridas lançadas.`);
console.log(`Saldo agora: ${brl(depois)} (era ${brl(antes)})`);
await sql.end();
process.exit(0);

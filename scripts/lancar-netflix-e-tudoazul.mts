/**
 * Duas correções que saíram da varredura das faturas em 21/10/2026.
 *
 * 1. NETFLIX — R$ 44,90 todo dia 07, nas dez faturas, e **nenhum registro** em
 *    3.715 lançamentos desde 2017. Nunca entrou; não é que parou. Entra como
 *    recorrência de verdade (regra + ocorrências, A10), pela porta do próprio
 *    app — `salvarLancamento` — e não por insert à mão, para nascer com tudo
 *    que a tela de Lançar dá.
 *
 * 2. CLUBE TUDOAZUL — a regra cobra R$ 58,50 e esse valor **não aparece em
 *    nenhuma das dez faturas**. O que aparece é `Azul Linhas Aereas Bras`,
 *    R$ 66,60, todo dia 25, nove meses seguidos, no cartão do Irwin. A leitura
 *    é que é o mesmo clube mais caro — os nomes não batem ao pé da letra, e
 *    isso está dito aqui de propósito (C7).
 *
 * O que ele NÃO faz: não encosta no Duo Gourmet. A conferência mostrou que
 * aquilo não é mensalidade que subiu, é **parcela 2..11 de 12** de um plano
 * anual comprado em 25/12/2025. Caso diferente, decisão diferente.
 *
 * Seco por padrão. `--aplicar` grava.
 */
import postgres from 'postgres';
import { salvarLancamento } from '../src/lib/api';

const sql = postgres(process.env.DATABASE_URL!);
const APLICAR = process.argv.includes('--aplicar');
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const NOVO_AZUL = 66.6;

async function saldo() {
  const [r] = await sql<{ s: string }[]>`
    select round(coalesce((select sum(saldo_irwin) from v_lancamentos),0)
               + coalesce((select sum(case when quem_pagou='Irwin' then valor
                                           when quem_pagou='Maria' then -valor else 0 end)
                           from acerto_contas),0),2)::text as s`;
  return Number(r.s);
}

const [jaTem] = await sql<{ n: string }[]>`
  select count(*)::text as n from lancamentos where descricao = 'Netflix'`;
const azul = await sql<{ id: number; data: string; valor: string }[]>`
  select id, data::text as data, valor_total::text as valor
    from lancamentos where descricao = 'Clube TudoAzul' and data >= '2026-01-01'
   order by data`;

console.log(`Netflix já na base: ${jaTem.n} linha(s) — serão criadas 10 (07/01 a 07/10).`);
console.log(`Clube TudoAzul em 2026: ${azul.length} linha(s) a ${brl(Number(azul[0]?.valor))} → ${brl(NOVO_AZUL)}`);
console.log(`  (a fatura prova nove meses, 01 a 09; a de outubro é por inferência`);
console.log(`   — a cobrança de 25/10 só aparece na fatura de dezembro)`);

const antes = await saldo();
const efeitoNetflix = 44.9 * 10 * 0.5;                       // 50/50, Irwin pagou
const efeitoAzul = (NOVO_AZUL - 58.5) * azul.length * 0.5;
console.log(`\nSaldo hoje: ${brl(antes)}`);
console.log(`  Netflix  10× 44,90 · 50/50 .............. ${brl(efeitoNetflix)}`);
console.log(`  TudoAzul ${azul.length}× +8,10 · 50/50 ............. ${brl(efeitoAzul)}`);
console.log(`  previsto: ${brl(antes + efeitoNetflix + efeitoAzul)}`);

if (!APLICAR) {
  console.log('\nSeco. Rode com --aplicar para gravar.');
  await sql.end();
  process.exit(0);
}

if (Number(jaTem.n) === 0) {
  const r = await salvarLancamento({
    data: '2026-01-07',
    descricao: 'Netflix',
    grupo: '5 Lazer & Pessoal',
    tipo: 'Fixa',
    fonte: 'Cartão',
    valor: 44.9,
    divisao: '50/50',
    quemPagou: 'Irwin',
    obs: 'Cobrança no cartão desde pelo menos 01/2026; nunca lançada',
    repetir: true,
    freqRec: 'mensal',
    semFimRec: true,
  });
  console.log(`\n✓ Netflix: ${r.qtd} ocorrência(s), ${brl(r.total)}`);
}

// `pago_irwin` acompanha o valor: quem paga sozinho desembolsa o valor inteiro.
await sql`update lancamentos
             set valor_total = ${NOVO_AZUL}, pago_irwin = ${NOVO_AZUL},
                 obs = 'Fatura: R$ 66,60/mês desde 01/2026; a regra ficou em 58,50'
           where descricao = 'Clube TudoAzul' and data >= '2026-01-01'`;
await sql`update recorrencias set valor = ${NOVO_AZUL} where descricao = 'Clube TudoAzul' and ativo`;
console.log(`✓ Clube TudoAzul: ${azul.length} lançamento(s) e a regra agora em ${brl(NOVO_AZUL)}`);

console.log(`\nSaldo agora: ${brl(await saldo())} (era ${brl(antes)})`);
await sql.end();
process.exit(0);

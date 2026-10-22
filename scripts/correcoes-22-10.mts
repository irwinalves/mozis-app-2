/**
 * Três correções pedidas em 22/10/2026, depois da reimportação da fatura.
 *
 * 1. NETFLIX DUPLICADA. A reimportação trouxe `Netflix.comsao Paulobr` de
 *    07/08 — mesma data, mesmo valor e mesmo pagador da ocorrência da regra
 *    criada seis minutos antes. O cruzamento não pegou porque usa `series` de
 *    PARCELAMENTO como chave forte e não olha recorrência. Sai a importada; a
 *    da regra fica, que é a que tem série e descrição limpa.
 *
 * 2. DUO GOURMET. Não era mensalidade que subiu: é um plano anual comprado em
 *    25/12/2025 em 12× de R$ 50,74. A recorrência de R$ 27,50 é o plano mensal
 *    antigo, que morreu na compra do anual e continuou sendo lançado — e não
 *    aparece em nenhuma das dez faturas. Saem as ocorrências de 2026 e a regra;
 *    entra o parcelamento de verdade.
 *
 *    As ocorrências até 12/2025 FICAM: o plano mensal existiu até ali, e a
 *    fatura de janeiro, que provaria o contrário, eu não tenho (C7).
 *
 * 3. CONTA DE LUZ. Último lançamento é `Luz Fev`, de 30/03/2026. O extrato
 *    mostra seis pagamentos `PIX AUT BULBE ENERGIA` de maio a outubro que nunca
 *    entraram. Entram com o valor e a data reais do extrato — nada de média.
 *
 * Seco por padrão. `--aplicar` grava.
 */
import postgres from 'postgres';
import { salvarLancamento } from '../src/lib/api';

const sql = postgres(process.env.DATABASE_URL!);
const APLICAR = process.argv.includes('--aplicar');
const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Do extrato, linha por linha. O rótulo é o mês de REFERÊNCIA: a conta de um
 *  mês é paga no mês seguinte, que é como os lançamentos antigos nomeiam. */
const LUZ = [
  { data: '2026-05-04', descricao: 'Luz Abr', valor: 270.44 },
  { data: '2026-06-08', descricao: 'Luz Mai', valor: 263.67 },
  { data: '2026-07-01', descricao: 'Luz Jun', valor: 298.0 },
  { data: '2026-08-03', descricao: 'Luz Jul', valor: 210.49 },
  { data: '2026-09-01', descricao: 'Luz Ago', valor: 323.66 },
  { data: '2026-10-01', descricao: 'Luz Set', valor: 289.21 },
];

async function saldo() {
  const [r] = await sql<{ s: string }[]>`
    select round(coalesce((select sum(saldo_irwin) from v_lancamentos),0)
               + coalesce((select sum(case when quem_pagou='Irwin' then valor
                                           when quem_pagou='Maria' then -valor else 0 end)
                           from acerto_contas),0),2)::text as s`;
  return Number(r.s);
}

const dup = await sql<{ id: number }[]>`
  select id from lancamentos where descricao = 'Netflix.comsao Paulobr' and importacao_id = 2`;
const duo = await sql<{ n: string; soma: string }[]>`
  select count(*)::text as n, coalesce(sum(valor_total),0)::text as soma from lancamentos
   where descricao = 'Duo Gourmet' and data >= '2026-01-01'`;

console.log(`1. Netflix duplicada ....... ${dup.length} linha(s) a apagar`);
console.log(`2. Duo Gourmet 2026 ........ ${duo[0].n} ocorrência(s), ${brl(Number(duo[0].soma))} a apagar`);
console.log(`   + regra de R$ 27,50, e entra parcelamento 12× ${brl(50.74)} = ${brl(50.74 * 12)}`);
console.log(`3. Conta de luz ............ ${LUZ.length} lançamento(s), ${brl(LUZ.reduce((a, l) => a + l.valor, 0))}`);
for (const l of LUZ) console.log(`     ${l.data}  ${l.descricao.padEnd(9)} ${brl(l.valor).padStart(11)}`);

const antes = await saldo();
console.log(`\nSaldo hoje: ${brl(antes)}`);

if (!APLICAR) {
  console.log('\nSeco. Rode com --aplicar para gravar.');
  await sql.end();
  process.exit(0);
}

await sql`delete from lancamentos where descricao = 'Netflix.comsao Paulobr' and importacao_id = 2`;
console.log(`\n✓ Netflix duplicada apagada`);

await sql`delete from lancamentos where descricao = 'Duo Gourmet' and data >= '2026-01-01'`;
await sql`delete from recorrencias where descricao = 'Duo Gourmet' and valor = 27.50`;
const d = await salvarLancamento({
  data: '2025-12-25',
  descricao: 'Duo Gourmet Anual',
  grupo: '7 Outros',
  tipo: 'Fixa',
  fonte: 'Cartão',
  valor: 50.74,
  tipoValor: 'parcela',
  parcelado: true,
  parcelas: 12,
  divisao: '50/50',
  quemPagou: 'Irwin',
  obs: 'Plano anual comprado em 25/12/2025, 12× na fatura',
});
console.log(`✓ Duo Gourmet: regra e 2026 fora; parcelamento com ${d.qtd} parcelas, ${brl(d.total)}`);

let totalLuz = 0;
for (const l of LUZ) {
  await salvarLancamento({
    data: l.data,
    descricao: l.descricao,
    grupo: '1 Casa',
    tipo: 'Fixa',
    fonte: 'Pix',
    valor: l.valor,
    divisao: '50/50',
    quemPagou: 'Irwin',
    obs: 'Extrato: PIX AUT BULBE ENERGIA',
  });
  totalLuz += l.valor;
}
console.log(`✓ Luz: ${LUZ.length} lançamento(s), ${brl(totalLuz)}`);

console.log(`\nSaldo agora: ${brl(await saldo())} (era ${brl(antes)})`);
await sql.end();
process.exit(0);

/**
 * Correção pontual: a anuidade do cartão passa a valer o que foi REALMENTE
 * pago em cada mês, e a regra de recorrência passa a nascer em R$ 52,50.
 *
 * POR QUE PRECISOU EXISTIR
 *
 * A anuidade é cobrada em R$ 105,00 e o desconto vem como lançamento SEPARADO,
 * negativo, no mês seguinte ("Redução Mensalidade - Plano Do Cartão"). A
 * importação de fatura descarta negativos (A13) e a recorrência não sabe de
 * desconto nenhum — então o app lançava o bruto e nunca o líquido.
 *
 * Conferido nas 10 faturas de fev/2026 a nov/2026 (final 8607): o desconto NÃO
 * é constante. Dois meses tiveram estorno integral (R$ 105,00), um mês não teve
 * desconto nenhum, e um mês teve desconto dobrado. Por isso a tabela abaixo é
 * explícita, mês a mês, e não uma regra calculada — o dado é o extrato, não uma
 * fórmula que eu deduzi.
 *
 * O vínculo mês ↔ fatura está provado pelo VENCIMENTO: todas as faturas vencem
 * no dia 06 (08 quando cai em fim de semana) e a recorrência lança no dia 06.
 *
 * O QUE ELE NÃO FAZ
 *
 * Não encosta em mês de que eu não tenha a fatura — nada antes de fev/2026
 * (R$ 100,00 na época) é alterado, porque eu não tenho com o que conferir (C7).
 * Não muda a divisão de nenhuma linha, nem o pagador.
 *
 * Seco por padrão. `--aplicar` grava, numa transação só.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);
const APLICAR = process.argv.includes('--aplicar');

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * O líquido de cada fatura: cobrança menos os descontos que aparecem nela.
 * `nota` vai para a coluna `obs` do lançamento — é o rastro de por que o valor
 * não é o 105,00 cheio, para quem abrir a linha daqui a seis meses.
 */
const FATURAS = [
  { data: '2026-02-06', liquido: 0,     nota: 'Fatura fev/26: 105,00 − 105,00 de estorno integral' },
  { data: '2026-03-06', liquido: 0,     nota: 'Fatura mar/26: 105,00 − 105,00 de estorno integral' },
  { data: '2026-04-06', liquido: 52.5,  nota: 'Fatura abr/26: 105,00 − 52,50 de desconto' },
  { data: '2026-05-06', liquido: 52.5,  nota: 'Fatura mai/26: 105,00 − 52,50 de desconto' },
  { data: '2026-06-06', liquido: 105,   nota: 'Fatura jun/26: 105,00 sem desconto nenhum' },
  { data: '2026-07-06', liquido: 52.5,  nota: 'Fatura jul/26: 105,00 − 52,50 de desconto' },
  { data: '2026-08-06', liquido: 52.5,  nota: 'Fatura ago/26: 105,00 − 52,50 de desconto' },
  { data: '2026-09-06', liquido: 52.5,  nota: 'Fatura set/26: 105,00 − 52,50 de desconto' },
  { data: '2026-10-06', liquido: 0,     nota: 'Fatura out/26: 105,00 − 52,50 ×2 (o banco creditou dobrado)' },
] as const;

const DESCRICAO = 'Anuidade Cartão';
const VALOR_NOVO_DA_REGRA = 52.5;

class Seco extends Error {}

async function acerto(tx: typeof sql) {
  const [r] = await tx<{ total: string; mes: string }[]>`
    select round(coalesce(sum(saldo_irwin), 0)::numeric, 2)::text as total,
           round(coalesce(sum(saldo_irwin) filter (
             where data <= (date_trunc('month', current_date)
                            + interval '1 month' - interval '1 day')::date
           ), 0)::numeric, 2)::text as mes
      from v_lancamentos`;
  return r;
}

async function main() {
  const atual = await sql<
    { id: number; data: string; valor: string; pct: string; pago: string; quem: string }[]
  >`select id, data::text as data, valor_total::text as valor, pct_irwin::text as pct,
           coalesce(pago_irwin, 0)::text as pago, coalesce(quem_pagou, '—') as quem
      from lancamentos
     where descricao = ${DESCRICAO}
       and data in ${sql(FATURAS.map((f) => f.data))}
     order by data`;

  const faltando = FATURAS.filter((f) => !atual.some((l) => l.data === f.data));
  if (faltando.length) {
    console.log('⚠ sem lançamento nestas datas:', faltando.map((f) => f.data).join(', '));
  }

  // Pagador diferente de 'Irwin' mudaria a conta de `pago_irwin` — e aí este
  // script estaria chutando. Melhor parar do que gravar errado (regra nº 4).
  const estranhos = atual.filter((l) => l.quem !== 'Irwin');
  if (estranhos.length) {
    console.log('⚠ pagador inesperado, abortando:', estranhos);
    await sql.end();
    process.exit(1);
  }

  console.log(`${atual.length} lançamento(s) de "${DESCRICAO}":\n`);
  console.log('  data         hoje        alvo      divisão   Maria deve');
  for (const l of atual) {
    const alvo = FATURAS.find((f) => f.data === l.data)!.liquido;
    const saldoHoje = Number(l.pago) - Number(l.valor) * Number(l.pct);
    const saldoAlvo = alvo - alvo * Number(l.pct);
    const mudou = Number(l.valor) !== alvo ? '←' : ' ';
    console.log(
      `  ${l.data}  ${brl(Number(l.valor)).padStart(10)} → ${brl(alvo).padStart(9)}` +
        `  ${(Number(l.pct) * 100).toFixed(0)}%` +
        `   ${brl(saldoHoje).padStart(9)} → ${brl(saldoAlvo).padStart(9)} ${mudou}`,
    );
  }

  const [regra] = await sql<{ id: number; valor: string; divisao: string; pct: string | null }[]>`
    select id, valor::text as valor, divisao, pct_irwin_custom::text as pct
      from recorrencias where descricao = ${DESCRICAO} and ativo = true`;
  console.log(
    `\nRegra da recorrência #${regra.id}: ${brl(Number(regra.valor))} → ` +
      `${brl(VALOR_NOVO_DA_REGRA)}  (divisão ${regra.divisao} ${regra.pct ?? ''} — não mexo)`,
  );

  try {
    await sql.begin(async (tx) => {
      const antes = await acerto(tx);

      for (const f of FATURAS) {
        // `pago_irwin` acompanha o valor porque o pagador é 'Irwin': quem paga
        // sozinho desembolsa o valor inteiro (pagoIrwinDe, src/lib/lancamentos.ts).
        await tx`update lancamentos
                    set valor_total = ${f.liquido},
                        pago_irwin  = ${f.liquido},
                        obs         = ${f.nota}
                  where descricao = ${DESCRICAO} and data = ${f.data}`;
      }
      await tx`update recorrencias
                  set valor = ${VALOR_NOVO_DA_REGRA}
                where id = ${regra.id}`;

      const depois = await acerto(tx);
      console.log(`\nAcerto "total":      ${brl(Number(antes.total))} → ${brl(Number(depois.total))}`);
      console.log(`Corte do mês:        ${brl(Number(antes.mes))} → ${brl(Number(depois.mes))}`);
      console.log(
        `A Maria deve ${brl(Number(antes.total) - Number(depois.total))} menos.`,
      );

      if (!APLICAR) throw new Seco();
    });
  } catch (e) {
    if (!(e instanceof Seco)) throw e;
    console.log('\nSeco — nada foi gravado. Rode com --aplicar.');
    await sql.end();
    process.exit(0);
  }

  console.log('\n✓ aplicado.');
  console.table(
    await sql`select id, data::text as data, valor_total::text as valor,
                     pago_irwin::text as pago, obs
                from lancamentos where descricao = ${DESCRICAO}
                 and data >= '2026-02-01' order by data`,
  );
  await sql.end();
  process.exit(0);
}

await main();

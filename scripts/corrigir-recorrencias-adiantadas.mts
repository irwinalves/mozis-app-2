/**
 * Correção pontual: apaga as recorrências que foram adiantadas para o futuro
 * e devolve `ultima_geracao` ao último mês realmente gerado.
 *
 * POR QUE PRECISOU EXISTIR
 *
 * `montarRecorrencias` gravava TODAS as ocorrências de uma recorrência com
 * data fim no ato da criação, até o fim da vigência — enquanto a indefinida
 * parava no mês corrente e deixava o cron continuar. A data fim é vigência da
 * regra, não autorização para adiantar o futuro (A18). O código já está
 * corrigido; isto limpa o que ele deixou para trás.
 *
 * Medido em produção em 09/10/2026: 23 ocorrências até março de 2027,
 * R$ 22.859,05, deixando o corte "total" do acerto R$ 11.429,53 errado.
 *
 * O QUE ELE NÃO FAZ
 *
 * Não encosta em parcela. Uma parcelada futura é dívida já contraída e DEVE
 * estar lançada (A7) — o filtro é `recorrente = true`, e só.
 *
 * Seco por padrão. `--aplicar` grava, numa transação só.
 */
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);
const APLICAR = process.argv.includes('--aplicar');

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Fim do mês corrente — o limite até onde recorrência pode estar lançada. */
const LIMITE = sql`(date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date`;

async function acerto() {
  const [r] = await sql<{ total: string; mes: string }[]>`
    select round(coalesce(sum(saldo_irwin), 0)::numeric, 2)::text as total,
           round(coalesce(sum(saldo_irwin) filter (where data <= ${LIMITE}), 0)::numeric, 2)::text as mes
      from v_lancamentos`;
  return r;
}

async function main() {
  const alvo = await sql<
    { id: number; data: string; descricao: string; valor: string; saldo: string }[]
  >`select id, data::text as data, descricao, valor_total::text as valor,
           coalesce(saldo_irwin, 0)::text as saldo
      from v_lancamentos
     where recorrente = true and data > ${LIMITE}
     order by descricao, data`;

  if (!alvo.length) {
    console.log('Nada a corrigir: nenhuma recorrência lançada além do mês corrente.');
    await sql.end();
    process.exit(0);
  }

  const porRegra = new Map<string, typeof alvo>();
  for (const l of alvo) {
    if (!porRegra.has(l.descricao)) porRegra.set(l.descricao, [] as never);
    porRegra.get(l.descricao)!.push(l);
  }

  console.log(`${alvo.length} ocorrência(s) adiantada(s), em ${porRegra.size} regra(s):\n`);
  for (const [desc, linhas] of porRegra) {
    const soma = linhas.reduce((a, l) => a + Number(l.valor), 0);
    console.log(
      `  ${desc.padEnd(24)} ${String(linhas.length).padStart(2)}× ` +
        `${linhas[0].data} → ${linhas[linhas.length - 1].data}  ${brl(soma)}`,
    );
  }

  const antes = await acerto();
  const efeito = alvo.reduce((a, l) => a + Number(l.saldo), 0);
  console.log(`\nAcerto "total" agora: ${brl(Number(antes.total))}`);
  console.log(`Depois da correção:   ${brl(Number(antes.total) - efeito)}`);
  console.log(`Corte do mês (não muda): ${brl(Number(antes.mes))}`);

  if (!APLICAR) {
    console.log('\nSeco. Rode com --aplicar para gravar.');
    await sql.end();
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`delete from lancamentos
              where recorrente = true and data > ${LIMITE}`;

    // `ultima_geracao` volta para a última ocorrência que SOBROU. Sem isto o
    // cron veria a promessa no futuro e nunca mais geraria nada — e a regra
    // morreria em silêncio, que é exatamente o defeito que a A10 trava.
    await tx`
      update recorrencias r
         set ultima_geracao = sub.ultima
        from (select r2.id,
                     (select max(l.data) from lancamentos l
                       where l.descricao = r2.descricao and l.recorrente = true) as ultima
                from recorrencias r2) sub
       where r.id = sub.id and sub.ultima is not null and r.ultima_geracao > sub.ultima`;
  });

  const depois = await acerto();
  console.log(`\n✓ aplicado. Acerto "total" agora: ${brl(Number(depois.total))}`);
  console.log(`  Corte do mês: ${brl(Number(depois.mes))} (era ${brl(Number(antes.mes))})`);

  console.table(
    await sql`select id, descricao, ultima_geracao::text as ultima, data_fim::text as fim
                from recorrencias where ativo = true and data_fim is not null order by id`,
  );
  await sql.end();
  process.exit(0);
}

await main();

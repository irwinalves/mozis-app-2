/**
 * Remove as linhas gravadas pela TELA ANTIGA de importação OFX/CSV.
 *
 * POR QUE PRECISOU EXISTIR
 *
 * Em 21/10/2026 a tela antiga gravou 150 linhas da fatura de setembro em
 * produção — `Ambos` 50/50, descrição crua, categoria por palpite — e **sem
 * `importacao_id`**, logo sem o desfazer que a tela nova tem. Ver A21.
 *
 * A assinatura é limpa e não pega nada por engano: `cat_original` só vale
 * 'Importação OFX/CSV' no caminho `lancarImportacaoLote`, e essas são as
 * únicas linhas da base inteira com esse valor.
 *
 * ANTES DE APAGAR ELE SALVA TUDO em `baseline/` (fora do git), linha por
 * linha, em JSON. Exclusão de 150 linhas sem rede não se faz.
 *
 * Seco por padrão. `--aplicar` grava.
 */
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL!);
const APLICAR = process.argv.includes('--aplicar');
const MARCA = 'Importação OFX/CSV';

const brl = (n: number) =>
  Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function acerto() {
  const [r] = await sql<{ total: string; mes: string }[]>`
    select round(coalesce(sum(saldo_irwin), 0)::numeric, 2)::text as total,
           round(coalesce(sum(saldo_irwin) filter (
             where data <= (date_trunc('month', current_date)
                            + interval '1 month' - interval '1 day')::date
           ), 0)::numeric, 2)::text as mes
      from v_lancamentos`;
  return r;
}

const alvo = await sql<Record<string, unknown>[]>`
  select * from lancamentos where cat_original = ${MARCA} order by id`;

if (!alvo.length) {
  console.log('Nada a apagar.');
  await sql.end();
  process.exit(0);
}

// Uma linha com lote é da tela NOVA e não pode estar aqui. Se aparecer, pare:
// a assinatura deixou de ser confiável e apagar vira chute.
const comLote = alvo.filter((l) => l.importacao_id !== null);
if (comLote.length) {
  console.log('⚠ linha com importacao_id na seleção — abortando:', comLote.map((l) => l.id));
  await sql.end();
  process.exit(1);
}

const soma = alvo.reduce((a, l) => a + Number(l.valor_total), 0);
// `l.data` vem como Date; `String(...)` daria "Fri Aug 14 2026" e ordenar isso
// como texto mente sobre a faixa. ISO primeiro, ordenação depois.
const datas = alvo.map((l) => new Date(l.data as string).toISOString().slice(0, 10)).sort();
console.log(`${alvo.length} linha(s) · ${brl(soma)} · de ${datas[0]} a ${datas[datas.length - 1]}`);

const antes = await acerto();
const [prev] = await sql<{ total: string; mes: string }[]>`
  select round(coalesce(sum(saldo_irwin), 0)::numeric, 2)::text as total,
         round(coalesce(sum(saldo_irwin) filter (
           where data <= (date_trunc('month', current_date)
                          + interval '1 month' - interval '1 day')::date
         ), 0)::numeric, 2)::text as mes
    from v_lancamentos
   where cat_original is distinct from ${MARCA}`;
console.log(`\nAcerto "total": ${brl(Number(antes.total))} → ${brl(Number(prev.total))}`);
console.log(`Corte do mês:   ${brl(Number(antes.mes))} → ${brl(Number(prev.mes))}`);

if (!APLICAR) {
  console.log('\nSeco. Rode com --aplicar para apagar.');
  await sql.end();
  process.exit(0);
}

const arquivo = `baseline/apagadas-tela-antiga-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(arquivo, JSON.stringify(alvo, null, 2));
console.log(`\nCópia salva em ${arquivo}`);

const apagadas = await sql`delete from lancamentos where cat_original = ${MARCA} returning id`;
const depois = await acerto();
console.log(`✓ ${apagadas.length} linha(s) apagada(s).`);
console.log(`  Acerto "total": ${brl(Number(depois.total))} · corte do mês: ${brl(Number(depois.mes))}`);
await sql.end();
process.exit(0);

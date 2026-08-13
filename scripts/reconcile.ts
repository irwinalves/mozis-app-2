/**
 * O PORTÃO da Fase 1.
 *
 * Compara, sobre a MESMA base, o que a planilha calculou com o que a view
 * `v_lancamentos` calcula. Se isto não fechar, nada mais importa: significa que
 * a regra de negócio foi traduzida errado, e todo o resto seria construído
 * sobre número errado.
 *
 * A comparação é feita em centavos (2 casas), com tolerância ZERO. A planilha
 * não arredonda, então os valores crus carregam ruído de float64 — comparar em
 * dinheiro é a pergunta que importa, e o delta bruto máximo é reportado à parte
 * para não esconder nada.
 *
 * Uso: npm run reconcile -- "/caminho/DRE - Casal - v2.xlsx"
 */
import ExcelJS from 'exceljs';
import postgres from 'postgres';

const caminho = process.argv[2] ?? `${process.env.HOME}/Downloads/DRE - Casal - v2.xlsx`;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida.');
const sql = postgres(url);

function resultado(cell: ExcelJS.Cell): number | null {
  const v =
    cell.type === ExcelJS.ValueType.Formula
      ? (cell as { result?: unknown }).result
      : cell.value;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Arredonda para centavos — a mesma função do backend antigo. */
const cent = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 100) / 100;

const iguais = (a: number | null, b: number | null) =>
  a === null && b === null ? true : a === null || b === null ? false : cent(a) === cent(b);

interface Divergencia {
  linha: number;
  campo: string;
  planilha: number | null;
  banco: number | null;
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.getWorksheet('Lançamentos')!;

  const doBanco = await sql<
    {
      linha_origem: number;
      parte_irwin: string | null;
      parte_maria: string | null;
      pago_maria: string | null;
      saldo_irwin: string | null;
    }[]
  >`select linha_origem, parte_irwin, parte_maria, pago_maria, saldo_irwin
    from v_lancamentos`;

  const porLinha = new Map(doBanco.map((r) => [r.linha_origem, r]));
  const num = (s: string | null) => (s === null ? null : Number(s));

  const divergencias: Divergencia[] = [];
  let comparadas = 0;
  let maxDelta = 0;
  let campoMaxDelta = '';

  // Colunas calculadas da planilha: J=10 Parte Irwin, K=11 Parte Maria,
  // M=13 Saldo Irwin, S=19 Pago Maria.
  const campos: [string, number, keyof (typeof doBanco)[0]][] = [
    ['parte_irwin', 10, 'parte_irwin'],
    ['parte_maria', 11, 'parte_maria'],
    ['saldo_irwin', 13, 'saldo_irwin'],
    ['pago_maria', 19, 'pago_maria'],
  ];

  for (const [linha, reg] of porLinha) {
    const row = ws.getRow(linha);
    comparadas++;
    for (const [nome, col, chave] of campos) {
      const naPlanilha = resultado(row.getCell(col));
      const noBanco = num(reg[chave] as string | null);
      if (!iguais(naPlanilha, noBanco)) {
        divergencias.push({ linha, campo: nome, planilha: naPlanilha, banco: noBanco });
      }
      if (naPlanilha !== null && noBanco !== null) {
        const d = Math.abs(naPlanilha - noBanco);
        if (d > maxDelta) {
          maxDelta = d;
          campoMaxDelta = `${nome} (linha ${linha})`;
        }
      }
    }
  }

  console.log('='.repeat(64));
  console.log('RECONCILIAÇÃO LINHA A LINHA');
  console.log('='.repeat(64));
  console.log(`  linhas comparadas      ${comparadas}`);
  console.log(`  campos por linha       ${campos.length}  (${comparadas * campos.length} comparações)`);
  console.log(`  divergências (centavo) ${divergencias.length}`);
  console.log(`  maior delta bruto      ${maxDelta.toExponential(3)}  em ${campoMaxDelta || '—'}`);

  if (divergencias.length) {
    console.log('\n  primeiras 20 divergências:');
    for (const d of divergencias.slice(0, 20)) {
      console.log(
        `    L${String(d.linha).padStart(5)}  ${d.campo.padEnd(12)}` +
          ` planilha=${String(d.planilha).padEnd(22)} banco=${d.banco}`,
      );
    }
    const porCampo = new Map<string, number>();
    divergencias.forEach((d) => porCampo.set(d.campo, (porCampo.get(d.campo) ?? 0) + 1));
    console.log('\n  por campo:', Object.fromEntries(porCampo));
  }

  // --- Os 3 cortes do acerto -------------------------------------------
  // Reproduz getAcertoContas(): soma a coluna Saldo Irwin e desconta as
  // quitações históricas da aba Acerto de Contas.
  //
  // A comparação de datas é feita NO POSTGRES, de propósito. A primeira versão
  // fazia em JS e o filtro nunca excluía nada: o driver devolve `date` como
  // Date em meia-noite UTC, que interpolado numa string vira
  // "Sun Apr 04 2027 21:00:00 GMT-0300…T00:00:00" → Invalid Date → comparação
  // sempre falsa. Os três cortes davam idênticos, escondendo 11 linhas futuras
  // (R$ 2.719,16). É a mesma armadilha de fuso que `parseDataLocal` evita no
  // outro sentido — e o teste PASSOU mesmo assim: quem pegou foi o resultado
  // implausível, não a suíte.
  async function saldoAte(limite: 'mes' | 'mes_seguinte' | null): Promise<number> {
    const corte =
      limite === 'mes'
        ? sql`date_trunc('month', current_date) + interval '1 month' - interval '1 day'`
        : limite === 'mes_seguinte'
          ? sql`date_trunc('month', current_date) + interval '2 month' - interval '1 day'`
          : null;

    const [{ saldo }] = await sql<{ saldo: string }[]>`
      select round(
        coalesce((select sum(saldo_irwin) from v_lancamentos
                  where ${corte ? sql`data <= ${corte}` : sql`true`}), 0)
      + coalesce((select sum(case when quem_pagou = 'Irwin' then valor
                                  when quem_pagou = 'Maria' then -valor
                                  else 0 end)
                  from acerto_contas
                  where ${corte ? sql`data <= ${corte}` : sql`true`}), 0)
      , 2) as saldo`;
    return Number(saldo);
  }

  const cortes = {
    'mês atual': await saldoAte('mes'),
    'mês seguinte': await saldoAte('mes_seguinte'),
    total: await saldoAte(null),
  };

  const quitacoes = await sql<{ n: string }[]>`select count(*) as n from acerto_contas`;

  console.log('\n' + '='.repeat(64));
  console.log('ACERTO DE CONTAS — 3 cortes (positivo = Maria deve a Irwin)');
  console.log('='.repeat(64));
  for (const [nome, v] of Object.entries(cortes)) {
    console.log(`  ${nome.padEnd(14)} R$ ${v.toFixed(2).padStart(12)}`);
  }
  console.log(`\n  (${quitacoes[0].n} quitações históricas descontadas)`);

  // Conferência independente: a própria planilha resume o acerto em células
  // fixas da aba Acerto de Contas. Se o número do banco bater com o que a
  // planilha mostra, a tradução fechou por dois caminhos diferentes.
  const acertoWs = wb.getWorksheet('Acerto de Contas');
  if (acertoWs) {
    console.log('\n  conferência independente — resumo da própria planilha:');
    for (const ref of ['C5', 'C6', 'C7', 'C9']) {
      const c = acertoWs.getCell(ref);
      const rotulo = acertoWs.getCell(`B${ref.slice(1)}`).value;
      const v = c.type === ExcelJS.ValueType.Formula ? (c as { result?: unknown }).result : c.value;
      if (v !== null && v !== undefined && v !== '') {
        console.log(`    ${ref}  ${String(rotulo ?? '').slice(0, 34).padEnd(34)} ${JSON.stringify(v)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(64));
  console.log(
    divergencias.length === 0
      ? '✅ PORTÃO LIBERADO — banco reproduz a planilha ao centavo.'
      : `❌ PORTÃO FECHADO — ${divergencias.length} divergências. Não avançar.`,
  );
  console.log('='.repeat(64));

  await sql.end();
  process.exit(divergencias.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

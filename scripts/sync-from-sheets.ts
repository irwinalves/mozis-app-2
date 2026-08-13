/**
 * Carrega a planilha inteira no Postgres.
 *
 * ESTRATÉGIA: TRUNCATE + carga completa, não upsert.
 *
 * Enquanto a planilha é a única fonte de verdade, recarregar do zero é sempre
 * correto, sempre idempotente, apaga junto qualquer dado de teste — e dispensa
 * coluna de identidade na planilha de produção, que não é tocada em momento
 * nenhum. 3.500 linhas carregam em cerca de um segundo.
 *
 * A direção inverte no cutover: dali em diante o banco é a verdade e a planilha
 * vira espelho read-only.
 *
 * Uso: npm run sync -- "/caminho/DRE - Casal - v2.xlsx"
 */
import ExcelJS from 'exceljs';
import postgres from 'postgres';

const caminho = process.argv[2] ?? `${process.env.HOME}/Downloads/DRE - Casal - v2.xlsx`;
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida.');
const sql = postgres(url);

/** Valor de uma célula, resolvendo fórmula para o resultado calculado. */
function valor(cell: ExcelJS.Cell): unknown {
  if (cell.type === ExcelJS.ValueType.Formula) {
    return (cell as { result?: unknown }).result ?? null;
  }
  const v = cell.value;
  if (v && typeof v === 'object' && 'richText' in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  }
  return v ?? null;
}

function texto(cell: ExcelJS.Cell): string | null {
  const v = valor(cell);
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function numero(cell: ExcelJS.Cell): number | null {
  const v = valor(cell);
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Data em 'yyyy-MM-dd'.
 *
 * Usa os componentes UTC de propósito: o ExcelJS converte o serial do Excel
 * para meia-noite UTC. Ler com getters locais, num fuso negativo como o de São
 * Paulo, devolveria o DIA ANTERIOR — é o mesmo bug de fuso que `parseDataLocal`
 * evita no outro sentido.
 */
function data(cell: ExcelJS.Cell): string | null {
  const v = valor(cell);
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return null;
}

function booleano(cell: ExcelJS.Cell): boolean {
  const v = valor(cell);
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === 'VERDADEIRO' || s === 'SIM' || s === '1';
}

/**
 * Primeira linha de DADOS da aba Lançamentos.
 *
 * ⚠️ É 5, não 6 — e essa diferença de uma linha é um bug ativo na produção.
 *
 * O backend antigo usa `PRIMEIRA_LINHA = 6`, porque a linha 5 nasceu como
 * linha-exemplo em itálico ("apague esta linha"). Só que a planilha foi
 * reordenada por data, e hoje a linha 5 guarda um lançamento REAL: a parcela
 * "320k Milhas Azul 10/10", R$ 485,10, com saldo de R$ 242,55.
 *
 * A própria planilha conta essa linha — `Acerto de Contas!C5` é
 * `SUM('Lançamentos'!$M$5:$M$4997)`. O app não. Resultado: o app subestima em
 * R$ 242,55 o que a Maria deve, e o lançamento está invisível também na lista,
 * na busca e no dashboard, que todos começam na linha 6.
 *
 * Aqui seguimos a planilha, que é a fonte de verdade.
 */
const PRIMEIRA_LINHA_DADOS = 5;

/** Última linha com a coluna `col` preenchida — só ela conta, como faz proximaLinhaVazia. */
function ultimaLinha(ws: ExcelJS.Worksheet, col = 1, inicio = PRIMEIRA_LINHA_DADOS): number {
  let ultima = inicio - 1;
  for (let r = inicio; r <= ws.rowCount; r++) {
    if (valor(ws.getRow(r).getCell(col))) ultima = r;
  }
  return ultima;
}

async function main() {
  console.log(`Lendo ${caminho}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);

  // Uma transação só: ou a base inteira troca, ou nada muda.
  await sql.begin(async (tx) => {
    await tx`truncate lancamentos, config, plano_de_contas, recorrencias,
                      acerto_contas, investimentos_contas, investimentos_movimentos,
                      patrimonio restart identity`;

    // --- Config -----------------------------------------------------------
    const conf = wb.getWorksheet('Config');
    const pct = conf ? numero(conf.getCell('C6')) : null;
    await tx`insert into config (id, pct_irwin_renda) values (1, ${pct ?? 0.4947})`;
    console.log(`  config            pct_irwin_renda = ${pct}`);

    // --- Plano de Contas (B6:D14) ----------------------------------------
    const plano = wb.getWorksheet('Plano de Contas');
    let nPlano = 0;
    if (plano) {
      for (let r = 6; r <= 14; r++) {
        const nome = texto(plano.getRow(r).getCell(2));
        if (!nome) continue;
        await tx`insert into plano_de_contas (nome, palavras_chave, tipo_padrao, ordem)
                 values (${nome}, ${texto(plano.getRow(r).getCell(3))},
                         ${texto(plano.getRow(r).getCell(4))}, ${r - 5})`;
        nPlano++;
      }
    }
    console.log(`  plano_de_contas   ${nPlano} categorias`);

    // --- Lançamentos ------------------------------------------------------
    const lanc = wb.getWorksheet('Lançamentos');
    if (!lanc) throw new Error('Aba "Lançamentos" não encontrada.');
    const ultima = ultimaLinha(lanc);
    let nLanc = 0;
    const lote: Record<string, unknown>[] = [];

    for (let r = PRIMEIRA_LINHA_DADOS; r <= ultima; r++) {
      const row = lanc.getRow(r);
      const dt = data(row.getCell(1));
      if (!dt) continue;
      lote.push({
        data: dt,
        descricao: texto(row.getCell(2)) ?? '',
        categoria: texto(row.getCell(3)) ?? '',
        tipo: texto(row.getCell(4)) ?? '',
        cat_original: texto(row.getCell(5)),
        fonte: texto(row.getCell(6)),
        valor_total: numero(row.getCell(7)),
        divisao: texto(row.getCell(8)) ?? '',
        pct_irwin_custom: numero(row.getCell(9)),
        quem_pagou: texto(row.getCell(12)),
        obs: texto(row.getCell(14)),
        recorrente: booleano(row.getCell(17)),
        pago_irwin: numero(row.getCell(18)),
        linha_origem: r,
      });
      nLanc++;
    }

    // Inserção em blocos: 3.500 parâmetros por statement estouraria o limite.
    for (let i = 0; i < lote.length; i += 500) {
      await tx`insert into lancamentos ${tx(lote.slice(i, i + 500))}`;
    }
    console.log(
      `  lancamentos       ${nLanc} linhas (planilha ${PRIMEIRA_LINHA_DADOS}..${ultima})`,
    );

    // --- Recorrências -----------------------------------------------------
    const rec = wb.getWorksheet('Recorrências');
    let nRec = 0;
    if (rec) {
      const ult = ultimaLinha(rec, 1, 4);
      for (let r = 4; r <= ult; r++) {
        const row = rec.getRow(r);
        const dt = data(row.getCell(1));
        if (!dt) continue;
        await tx`insert into recorrencias
          (data_inicio, descricao, categoria, fonte, valor, divisao,
           pct_irwin_custom, quem_pagou, frequencia, ultima_geracao, ativo)
          values (${dt}, ${texto(row.getCell(2)) ?? ''}, ${texto(row.getCell(3)) ?? ''},
                  ${texto(row.getCell(4))}, ${numero(row.getCell(5)) ?? 0},
                  ${texto(row.getCell(6)) ?? '50/50'}, ${numero(row.getCell(7))},
                  ${texto(row.getCell(8))}, ${texto(row.getCell(9)) ?? 'mensal'},
                  ${data(row.getCell(10))}, ${booleano(row.getCell(11))})`;
        nRec++;
      }
    }
    console.log(`  recorrencias      ${nRec} regras`);

    // --- Acerto de Contas (quitações históricas, linhas 12+) --------------
    const ac = wb.getWorksheet('Acerto de Contas');
    let nAc = 0;
    if (ac) {
      const ult = ultimaLinha(ac, 1, 12);
      for (let r = 12; r <= ult; r++) {
        const row = ac.getRow(r);
        const dt = data(row.getCell(1));
        if (!dt) continue;
        await tx`insert into acerto_contas (data, descricao, quem_pagou, para_quem, valor, obs)
                 values (${dt}, ${texto(row.getCell(2))}, ${texto(row.getCell(3))},
                         ${texto(row.getCell(4))}, ${numero(row.getCell(5)) ?? 0},
                         ${texto(row.getCell(6))})`;
        nAc++;
      }
    }
    console.log(`  acerto_contas     ${nAc} quitações históricas`);
  });

  console.log('\nCarga concluída.');
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

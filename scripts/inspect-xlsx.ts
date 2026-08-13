/**
 * Inspeciona a exportação XLSX da planilha antes de importar qualquer coisa.
 *
 * Serve para responder, com o arquivo real na mão, o que não dá para saber
 * lendo o código do Apps Script: `moldeFormulas()` lê as fórmulas da linha 6
 * em tempo de execução, então o texto delas só existe na planilha.
 *
 * Uso: npx tsx scripts/inspect-xlsx.ts "/caminho/DRE - Casal - v2.xlsx"
 */
import ExcelJS from 'exceljs';

const caminho = process.argv[2];
if (!caminho) {
  console.error('Uso: npx tsx scripts/inspect-xlsx.ts <caminho-do-xlsx>');
  process.exit(1);
}

function descreve(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'formula' in (v as object)) {
    const f = v as { formula?: string; sharedFormula?: string; result?: unknown };
    const texto = f.formula ?? `(compartilhada de ${f.sharedFormula})`;
    return `=${texto}   →  ${JSON.stringify(f.result ?? null)}`;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);

  console.log('=== ABAS ===');
  wb.eachSheet((ws) => {
    console.log(`  ${ws.name.padEnd(22)} ${ws.rowCount} linhas × ${ws.columnCount} colunas`);
  });

  const lanc = wb.getWorksheet('Lançamentos');
  if (!lanc) {
    console.error('\n⚠️  Aba "Lançamentos" não encontrada — conferir o nome exato acima.');
    return;
  }

  console.log('\n=== Lançamentos: cabeçalho (linha 4) ===');
  const cab = lanc.getRow(4);
  for (let c = 1; c <= 19; c++) {
    console.log(`  ${String(c).padStart(2)} ${String(cab.getCell(c).value ?? '')}`);
  }

  // A linha 6 é o molde das fórmulas — é dela que garantirFormulas copia.
  console.log('\n=== Lançamentos: linha 6 (o MOLDE das fórmulas) ===');
  const modelo = lanc.getRow(6);
  for (let c = 1; c <= 19; c++) {
    const d = descreve(modelo.getCell(c));
    if (d) console.log(`  col ${String(c).padStart(2)}: ${d}`);
  }

  // Quantas linhas de dados existem de fato (olhando só a coluna Data, como
  // faz proximaLinhaVazia — as outras têm fórmula pré-preenchida e enganariam).
  let ultima = 5;
  for (let r = 6; r <= lanc.rowCount; r++) {
    if (lanc.getRow(r).getCell(1).value) ultima = r;
  }
  console.log(`\n=== Linhas de dados: 6 até ${ultima}  (${ultima - 5} lançamentos) ===`);

  console.log('\n=== Amostra: 3 primeiras e 3 últimas linhas de dados ===');
  const amostra = [6, 7, 8, ultima - 2, ultima - 1, ultima];
  for (const r of amostra) {
    const row = lanc.getRow(r);
    const campos = [1, 2, 3, 7, 8, 9, 10, 12, 13, 18, 19].map(
      (c) => `${c}:${descreve(row.getCell(c)).slice(0, 40)}`,
    );
    console.log(`  L${r}  ${campos.join(' | ')}`);
  }

  console.log('\n=== Config!C6 (% Irwin por renda) ===');
  const conf = wb.getWorksheet('Config');
  if (conf) console.log(`  ${descreve(conf.getCell('C6'))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

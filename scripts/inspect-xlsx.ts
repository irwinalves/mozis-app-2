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
  // Fórmula: usar os acessores do ExcelJS. Ler `cell.value` direto devolve
  // `[object Object]` nas COMPARTILHADAS, que trazem `sharedFormula` em vez
  // de `formula` — e é assim que a planilha guarda a maioria das colunas
  // calculadas, justamente por serem arrastadas da linha 6.
  if (cell.type === ExcelJS.ValueType.Formula) {
    return `=${cell.formula}   →  ${JSON.stringify((cell as { result?: unknown }).result ?? null)}`;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Conta valores distintos de uma coluna — para descobrir convenções pelos dados, não por suposição. */
function distintos(
  ws: ExcelJS.Worksheet,
  col: number,
  ate: number,
  filtro?: (r: ExcelJS.Row) => boolean,
): Map<string, number> {
  const m = new Map<string, number>();
  for (let r = 6; r <= ate; r++) {
    const row = ws.getRow(r);
    if (!row.getCell(1).value) continue;
    if (filtro && !filtro(row)) continue;
    const cell = row.getCell(col);
    const v = cell.type === ExcelJS.ValueType.Formula
      ? (cell as { result?: unknown }).result
      : cell.value;
    const k = v === null || v === undefined || v === '' ? '(vazio)' : String(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function mostra(titulo: string, m: Map<string, number>, limite = 15) {
  console.log(`\n=== ${titulo} ===`);
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));
  if (m.size > limite) console.log(`  … e mais ${m.size - limite} valores distintos`);
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

  // --- Convenções medidas nos dados, não supostas ---------------------------
  mostra('Divisão: valores distintos', distintos(lanc, 8, ultima));
  mostra('Quem pagou: valores distintos', distintos(lanc, 12, ultima));
  mostra('Tipo: valores distintos', distintos(lanc, 4, ultima));

  // A pergunta que decide o schema: a coluna I guarda 0,7 ou 70?
  // A fórmula é $G*$I (sem /100), mas o backend faz pctCustom/100 — os dois
  // não podem estar certos ao mesmo tempo.
  const custom = distintos(lanc, 9, ultima, (r) => {
    const c = r.getCell(8);
    const v = c.type === ExcelJS.ValueType.Formula ? (c as { result?: unknown }).result : c.value;
    return String(v) === 'Custom';
  });
  mostra('% Irwin custom, SÓ nas linhas com Divisão = Custom', custom, 25);

  // Linhas cujo modo de divisão não está na lista caem no fallback da fórmula
  // ($G*0.5), que difere do fallback do backend (Renda). Existem?
  const conhecidas = new Set(['50/50', 'Renda', '100% Irwin', '100% Maria', 'Custom']);
  const foraDaLista = [...distintos(lanc, 8, ultima).keys()].filter((k) => !conhecidas.has(k));
  console.log(
    `\n=== Divisões fora da lista conhecida: ${
      foraDaLista.length ? foraDaLista.join(' | ') : 'NENHUMA'
    } ===`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

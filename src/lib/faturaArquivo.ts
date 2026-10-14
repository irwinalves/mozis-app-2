/**
 * Do arquivo para a matriz. A camada fina que separa `exceljs` do parser.
 *
 * `lerFatura` é pura e recebe células; isto aqui é o único ponto que sabe o que
 * é um `.xlsx`. A separação existe para o parser poder ser testado sem arquivo
 * — um teste que precisa de um binário para rodar acaba não rodando.
 *
 * XLSX apenas. O extrato de conta corrente do Itaú vem em `.xls` antigo
 * (BIFF), que o `exceljs` não lê; a biblioteca que lê tem duas vulnerabilidades
 * altas em aberto no npm, e por isso ficou para uma decisão à parte.
 */
import ExcelJS from 'exceljs';
import { lerFatura, type ResultadoFatura } from './fatura';
import type { Pessoa } from './pessoas';

/** Uma célula vira o valor cru; fórmula vira o resultado; texto rico vira texto. */
function valorDaCelula(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result ?? '';
    if ('text' in v) return (v as { text: unknown }).text ?? '';
    if ('richText' in v) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    }
  }
  return v;
}

export async function lerFaturaXlsx(
  arquivo: Buffer | ArrayBuffer,
  conhecidas?: readonly Pessoa[],
): Promise<ResultadoFatura> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arquivo as never);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('A planilha está vazia.');

  const matriz: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    // `row.values` é 1-based com um vazio à frente. Tirar esse primeiro
    // elemento é o que alinha o índice 0 com a coluna A — errar isso desloca
    // TODAS as colunas em uma, e o sintoma é sutil: o valor vira a
    // titularidade e nada explode.
    const cels = (row.values as ExcelJS.CellValue[]).slice(1).map(valorDaCelula);
    matriz[n - 1] = cels;
  });

  return lerFatura(matriz, conhecidas);
}

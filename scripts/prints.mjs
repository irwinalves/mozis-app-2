/**
 * Refaz os prints do README a partir da base de demonstração.
 *
 * POR QUE ISTO EXISTE
 *
 * Os primeiros prints do repositório foram tirados à mão, de um worktree preso
 * num commit anterior, e nasceram velhos: mostravam telas que três commits do
 * mesmo dia já tinham mudado. Print tirado à mão envelhece em silêncio — ele
 * continua bonito e continua errado. Aqui ele vira comando, e refazer custa
 * menos do que conferir.
 *
 * COMO RODAR
 *
 *   1. aponte o `.env` para um banco LOCAL de demonstração
 *   2. `npm run semear-demo -- --limpar`
 *   3. `npm run dev`
 *   4. `npm run prints`
 *
 * Use SEMPRE a base de demonstração. O repositório é público e nenhum número
 * nosso entra em imagem.
 *
 * O navegador é o Chrome que já está instalado na máquina: `playwright-core`
 * só dirige, não baixa navegador nenhum.
 */
import { chromium } from 'playwright-core';
import ExcelJS from 'exceljs';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp } from 'node:fs/promises';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE ?? 'http://localhost:3000';
const DESTINO = path.join(process.cwd(), 'docs', 'prints');

// ---------------------------------------------------------------------------
// A fatura de exemplo
// ---------------------------------------------------------------------------

/**
 * Uma fatura FICTÍCIA no layout do Itaú, gerada na hora.
 *
 * Ela é desenhada para cair nas quatro abas da revisão: três linhas que o app
 * já tem, uma parcela de uma série que ele conhece, uma primeira parcela que
 * vira série nova, cinco compras novas, um estorno que cancela uma delas e o
 * pagamento da fatura, que não é gasto. Se a base de demonstração mudar, estes
 * valores precisam mudar junto — é o preço de um exemplo que prova alguma coisa.
 */
async function faturaDeExemplo() {
  const I = 'IRWIN ALVES';
  const M = 'MARIA MENEZES';
  const LINHAS = [
    ['2026-11-07', 'SUPERMERCADO VERDEMAR', '', 312.45, M, 'Físico'],
    ['2026-11-10', 'SMART FIT ACADEMIA', '', 149.0, M, 'Virtual recorrente'],
    ['2026-11-11', 'COLCHAO ORTOBOM', 'Parcela 1 de 3', 420.0, I, 'Físico'],
    ['2026-11-13', 'POSTO SHELL AFONSO PENA', '', 180.0, I, 'Físico'],
    ['2026-07-14', 'GELADEIRA BRASTEMP', 'Parcela 5 de 6', 399.9, I, 'Físico'],
    ['2026-11-15', 'VIVO FIBRA INTERNET', '', 129.9, I, 'Virtual recorrente'],
    ['2026-11-18', 'DROGARIA ARAUJO', '', 73.2, M, 'Físico'],
    ['2026-11-19', 'ESTORNO UBER TRIP', '', -28.7, M, 'Virtual temporário'],
    ['2026-11-20', 'NETFLIX.COM', '', 55.9, I, 'Virtual recorrente'],
    ['2026-11-21', 'IFOOD * RESTAURANTE', '', 64.9, I, 'Físico'],
    ['2026-11-22', 'UBER TRIP', '', 28.7, M, 'Virtual temporário'],
    ['2026-11-25', 'PAGAMENTO EFETUADO', '', -2400.0, I, 'Físico'],
  ];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Fatura');
  // O bloco de topo vem antes do cabeçalho na fatura de verdade, e o parser
  // procura o cabeçalho em vez de assumir a linha. Reproduzido de propósito.
  ws.addRow([]);
  ws.addRow(['', 'Fatura do cartão', '', '', '', '', 'Vencimento 05/12/2026']);
  ws.addRow([]);
  ws.addRow([
    '', 'Data', 'Lançamento', 'Parcelamento', 'Valor', '',
    'Titularidade', 'Nome', 'Tipo', 'Nº',
  ]);
  for (const [data, desc, parc, valor, nome, tipo] of LINHAS) {
    ws.addRow([
      '', data, desc, parc, valor, '',
      nome === I ? 'Titular' : 'Adicional', nome, tipo, '4321',
    ]);
  }
  ws.addRow([]);
  ws.addRow(['', '', 'Importante saber: os valores acima são fictícios.']);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'mozis-fatura-'));
  const arquivo = path.join(dir, 'fatura-novembro-2026.xlsx');
  await wb.xlsx.writeFile(arquivo);
  return arquivo;
}

// ---------------------------------------------------------------------------

const fatura = await faturaDeExemplo();
await mkdir(DESTINO, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  // O app é usado no celular, e é num celular que ele precisa caber. Dois
  // `input[type=date]` lado a lado só vazam para fora do cartão aqui (C14).
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  colorScheme: 'dark',
});
// O selo do Next em desenvolvimento fica por cima da barra de ação e entraria
// no print como se fosse parte do app.
await ctx.addInitScript(() => {
  const esconder = () => {
    const s = document.createElement('style');
    s.textContent = 'nextjs-portal,[data-nextjs-toast]{display:none!important}';
    document.head?.appendChild(s);
  };
  if (document.head) esconder();
  else document.addEventListener('DOMContentLoaded', esconder);
});

const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('  [erro]', m.text().slice(0, 160)));

const tirar = async (nome) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(DESTINO, nome) });
  console.log('✓', nome);
};

// 01 · Início
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('Quitar').first().waitFor();
await tirar('01-inicio.png');

// 02 · Lançar
await page.goto(`${BASE}/lancar`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('Ex.: Supermercado').fill('Mercado do mês');
await page.getByPlaceholder('0,00').fill('24890');
await page.getByRole('button', { name: '3 Comida', exact: true }).click();
await page.waitForTimeout(400);
// O fim da página é onde mora o que distingue este app: quem pagou, como
// divide, a parte de cada um, e a conta das duas respostas juntas.
await page.evaluate(() => {
  const alvo = document.scrollingElement ?? document.documentElement;
  alvo.scrollTop = alvo.scrollHeight;
});
await tirar('02-lancar.png');

// 03 · Importar · 04 · Revisar · 05 · Editar uma linha
await page.goto(`${BASE}/importar`, { waitUntil: 'networkidle' });
await page.setInputFiles('input[type=file]', fatura);
await page.waitForTimeout(400);
await tirar('03-importar.png');

await page.getByRole('button', { name: /Analisar fatura/i }).click();
await page.waitForTimeout(4000);
// A aba que importa é a dos NOVOS: é onde se decide categoria e divisão.
await page.getByRole('button', { name: /^Novos/ }).click();
await tirar('04-fatura.png');

await page.getByText('SUPERMERCADO VERDEMAR', { exact: false }).first().click();
await page.waitForTimeout(1200);
await tirar('05-fatura-editar.png');

// 06 · Dashboard
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('Dashboard', { exact: true }).last().click();
await page.waitForTimeout(2500);
const mensal = page.getByText('Mensal', { exact: true }).first();
if (await mensal.count()) {
  await mensal.click();
  await page.waitForTimeout(2000);
}
await tirar('06-dashboard.png');

await browser.close();
console.log(`\nSeis prints em docs/prints, 750×1624. Confira antes de commitar.`);

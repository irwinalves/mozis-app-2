/**
 * Testes da lógica pura portada do Apps Script.
 *
 * Cobrem os casos que já quebraram de verdade neste projeto — não casos
 * inventados. Rodar com: npm test
 *
 * ⚠️ Isto prova que a LÓGICA calcula certo. Não prova nada sobre a junta
 * tela → backend → banco, que é exatamente onde moraram os dois bugs de
 * 12/08/2026, passando ilesos por duas baterias como esta. A prova daquilo é
 * lançamento real conferido no banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arred,
  parseDataLocal,
  formatarData,
  addMeses,
  fimDoMes,
  pctIrwinDe,
  pagoIrwinDe,
  montarParcelas,
  montarRecorrencias,
  normalizarFreq,
  ocorrenciaFreq,
  fracaoPagaPeloIrwin,
} from './lancamentos';

test('arred: duas casas sem erro de ponto flutuante', () => {
  assert.equal(arred(0.1 + 0.2), 0.3);
  assert.equal(arred(1.005), 1.0); // 1.005 é 1.00499... em binário
  assert.equal(arred(333.333333), 333.33);
});

test('parseDataLocal não volta um dia (bug de fuso)', () => {
  const d = parseDataLocal('2026-01-15');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 15);
  // Ida e volta tem que preservar o dia — toISOString() quebraria isto.
  assert.equal(formatarData(d), '2026-01-15');
});

test('addMeses: clamp de fim de mês, e volta ao dia original', () => {
  const jan31 = parseDataLocal('2026-01-31');
  assert.equal(formatarData(addMeses(jan31, 1)), '2026-02-28'); // 2026 não é bissexto
  assert.equal(formatarData(addMeses(jan31, 2)), '2026-03-31'); // volta pro 31
  assert.equal(formatarData(addMeses(jan31, 3)), '2026-04-30');
});

test('addMeses atravessa a virada de ano', () => {
  assert.equal(formatarData(addMeses(parseDataLocal('2026-11-30'), 2)), '2027-01-30');
  assert.equal(formatarData(addMeses(parseDataLocal('2026-12-31'), 1)), '2027-01-31');
});

test('fimDoMes', () => {
  assert.equal(formatarData(fimDoMes(parseDataLocal('2026-02-10'))), '2026-02-28');
  assert.equal(formatarData(fimDoMes(parseDataLocal('2026-08-01'))), '2026-08-31');
});

test('pctIrwinDe: a tabela inteira de casos', () => {
  assert.equal(pctIrwinDe('50/50', null), 0.5);
  assert.equal(pctIrwinDe('100% Irwin', null), 1);
  assert.equal(pctIrwinDe('100% Maria', null), 0);
  assert.equal(pctIrwinDe('Custom', 70), 0.7);
  assert.equal(pctIrwinDe('Renda', null, 0.4947), 0.4947);
  // Qualquer valor não reconhecido cai em 'Renda' — compatibilidade com
  // regras antigas gravadas na planilha.
  assert.equal(pctIrwinDe('qualquer coisa', null, 0.4947), 0.4947);
});

test('pagoIrwinDe: os três pagadores clássicos', () => {
  assert.equal(pagoIrwinDe('Irwin', 100, 50), 100);
  assert.equal(pagoIrwinDe('Maria', 100, 50), 0);
  // Sem pagador definido: fora do acerto.
  assert.equal(pagoIrwinDe('', 100, 50), null);
  assert.equal(pagoIrwinDe(null, 100, 50), null);
});

test('pagoIrwinDe: Ambos com rateio informado e sem', () => {
  assert.equal(pagoIrwinDe('Ambos', 100, 50, 70), 70);
  // Sem rateio informado: cada um pôs a própria parte, não gera dívida.
  assert.equal(pagoIrwinDe('Ambos', 100, 49.47, null), 49.47);
  assert.equal(pagoIrwinDe('Ambos', 100, 50, ''), 50);
  // 'Conjunta' é o rótulo antigo e precisa continuar funcionando: sem isto,
  // reeditar uma linha histórica a faria sumir do acerto em silêncio.
  assert.equal(pagoIrwinDe('Conjunta', 100, 50, null), 50);
});

test('montarParcelas: a última absorve o arredondamento', () => {
  const p = montarParcelas({
    data: '2026-01-15',
    descricao: 'Sofá',
    valor: 1000,
    parcelas: 3,
    tipoValor: 'total',
  });
  assert.deepEqual(
    p.map((x) => x.valor),
    [333.33, 333.33, 333.34],
  );
  // O que importa: a soma fecha exatamente com o total.
  assert.equal(arred(p.reduce((a, b) => a + b.valor, 0)), 1000);
  assert.deepEqual(
    p.map((x) => x.descricao),
    ['Sofá 1/3', 'Sofá 2/3', 'Sofá 3/3'],
  );
});

test('montarParcelas: tipoValor "parcela" repete o valor digitado', () => {
  const p = montarParcelas({
    data: '2026-01-15',
    descricao: 'Curso',
    valor: 50,
    parcelas: 3,
    tipoValor: 'parcela',
  });
  assert.deepEqual(
    p.map((x) => x.valor),
    [50, 50, 50],
  );
});

test('montarParcelas: 1x não numera a descrição', () => {
  const p = montarParcelas({ data: '2026-01-15', descricao: 'Pizza', valor: 80, parcelas: 1 });
  assert.equal(p.length, 1);
  assert.equal(p[0].descricao, 'Pizza');
});

test('montarParcelas: datas com clamp de fim de mês', () => {
  const p = montarParcelas({
    data: '2026-01-31',
    descricao: 'X',
    valor: 300,
    parcelas: 3,
    tipoValor: 'total',
  });
  assert.deepEqual(p.map((x) => formatarData(x.data)), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
  ]);
});

test('montarParcelas: valor zero ou negativo é recusado', () => {
  assert.throws(() => montarParcelas({ data: '2026-01-15', descricao: 'X', valor: 0 }));
  assert.throws(() => montarParcelas({ data: '2026-01-15', descricao: 'X', valor: -10 }));
});

test('normalizarFreq: o que não é reconhecido vira mensal', () => {
  assert.equal(normalizarFreq('semanal'), 'semanal');
  assert.equal(normalizarFreq('QUINZENAL'), 'quinzenal');
  assert.equal(normalizarFreq('mensal'), 'mensal');
  assert.equal(normalizarFreq('anual'), 'mensal');
  assert.equal(normalizarFreq(undefined), 'mensal');
});

test('ocorrenciaFreq: quinzenal é +14 dias, não 2x por mês', () => {
  const base = parseDataLocal('2026-01-01');
  assert.equal(formatarData(ocorrenciaFreq(base, 'quinzenal', 1)), '2026-01-15');
  assert.equal(formatarData(ocorrenciaFreq(base, 'quinzenal', 2)), '2026-01-29');
  assert.equal(formatarData(ocorrenciaFreq(base, 'semanal', 1)), '2026-01-08');
  // mensal usa addMeses, com o clamp
  assert.equal(formatarData(ocorrenciaFreq(parseDataLocal('2026-01-31'), 'mensal', 1)), '2026-02-28');
});

test('montarRecorrencias: valor cheio e mesma descrição, ao contrário de parcelas', () => {
  const o = montarRecorrencias({
    data: '2026-01-10',
    descricao: 'Faxina',
    valor: 150,
    freqRec: 'mensal',
    fimRec: '2026-04-10',
  });
  assert.equal(o.length, 4);
  assert.ok(o.every((x) => x.valor === 150));
  assert.ok(o.every((x) => x.descricao === 'Faxina'));
  assert.deepEqual(o.map((x) => formatarData(x.data)), [
    '2026-01-10',
    '2026-02-10',
    '2026-03-10',
    '2026-04-10',
  ]);
});

test('montarRecorrencias: data fim anterior à inicial é recusada', () => {
  assert.throws(() =>
    montarRecorrencias({
      data: '2026-05-10',
      descricao: 'X',
      valor: 10,
      freqRec: 'mensal',
      fimRec: '2026-04-10',
    }),
  );
});

test('fracaoPagaPeloIrwin: base é a soma no parcelamento', () => {
  const parcelas = montarParcelas({
    data: '2026-01-15',
    descricao: 'Sofá',
    valor: 1000,
    parcelas: 3,
    tipoValor: 'total',
  });
  // Irwin pôs 700 dos 1000 → 70% de cada parcela.
  const f = fracaoPagaPeloIrwin({ quemPagou: 'Ambos', pagoIrwin: 700, repetir: false }, parcelas);
  assert.equal(f, 0.7);
});

test('fracaoPagaPeloIrwin: base é UMA ocorrência na recorrência', () => {
  const ocorr = montarRecorrencias({
    data: '2026-01-10',
    descricao: 'Faxina',
    valor: 150,
    freqRec: 'mensal',
    fimRec: '2026-03-10',
  });
  // Irwin pôs 90 de cada 150 — não de 450. Confundir isto foi bug real.
  const f = fracaoPagaPeloIrwin({ quemPagou: 'Ambos', pagoIrwin: 90, repetir: true }, ocorr);
  assert.equal(f, 0.6);
});

test('fracaoPagaPeloIrwin: null quando não é Ambos ou não há rateio', () => {
  const p = montarParcelas({ data: '2026-01-15', descricao: 'X', valor: 100, parcelas: 1 });
  assert.equal(fracaoPagaPeloIrwin({ quemPagou: 'Irwin', pagoIrwin: 100 }, p), null);
  assert.equal(fracaoPagaPeloIrwin({ quemPagou: 'Ambos', pagoIrwin: null }, p), null);
});

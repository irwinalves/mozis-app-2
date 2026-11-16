/**
 * Os casos são REAIS — saíram da fatura de outubro/2026 e da base do casal.
 * Inventar entrada aqui perderia o que importa: a regra existe por causa de
 * dois achados concretos, e são eles que precisam continuar valendo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acharNoApp, agruparIguais, type LancamentoNoApp } from './estornosNoApp';

const hering: LancamentoNoApp = {
  id: 3972,
  data: '2026-07-28',
  descricao: 'Heringblumenaubr',
  valor: 141.58,
  serieId: null,
};

/** `Torneiras` de 2020: o falso positivo que a regra existe para evitar. */
const torneiras: LancamentoNoApp = {
  id: 3172,
  data: '2020-07-08',
  descricao: 'Torneiras',
  valor: 540.0,
  serieId: null,
};

const leiturinha: LancamentoNoApp[] = Array.from({ length: 12 }, (_, k) => ({
  id: 3688 + k,
  data: `2026-${String(9 + Math.floor(k / 4)).padStart(2, '0')}-07`,
  descricao: `Leiturinha ${k + 1}/12`,
  valor: k === 11 ? 27.87 : 27.83,
  serieId: 99,
  serieQtd: 12,
  serieTotal: 334.0,
}));

test('Hering: 3 cancelamentos de 141,58, 1 lançamento no app', () => {
  const a = acharNoApp('Canc Parcela Sem Juros - Heringblumenaubr', 141.58, 3, [hering, torneiras]);
  assert.equal(a.tipo, 'parcelas');
  if (a.tipo !== 'parcelas') return;
  assert.equal(a.canceladas, 3, 'a fatura cancelou três');
  assert.equal(a.noApp, 1, 'o app só tem uma lançada — dizer isso é metade da informação');
  assert.deepEqual(a.ids, [3972]);
});

test('Leiturinha: 540,00 NÃO vira a torneira de 2020', () => {
  const a = acharNoApp('Leiturinhacampinasbr', 540.0, 1, [...leiturinha, torneiras]);
  // Acha o lojista Leiturinha, mas nenhum valor encaixa: nem parcela (27,83),
  // nem o total da série (334,00). O `Torneiras` tem o valor EXATO e não entra,
  // porque o nome não é do mesmo lojista.
  assert.equal(a.tipo, 'semEncaixe');
  if (a.tipo !== 'semEncaixe') return;
  assert.ok(!a.ids.includes(3172), 'a torneira de 2020 não pode aparecer');
});

test('valor sozinho nunca propõe nada', () => {
  // Estorno de 540,00 de um lojista que não existe no app.
  const a = acharNoApp('Loja Que Nao Existe', 540.0, 1, [torneiras]);
  assert.equal(a.tipo, 'nada');
});

test('estorno igual ao total da série cancela a compra inteira', () => {
  const a = acharNoApp('Leiturinhacampinasbr', 334.0, 1, leiturinha);
  assert.equal(a.tipo, 'serie');
  if (a.tipo !== 'serie') return;
  assert.equal(a.serieId, 99);
  assert.equal(a.ids.length, 12);
});

test('estorno igual a um lançamento solto oferece excluir', () => {
  const a = acharNoApp('Cancelamento De Compra - Heringblumenaubr', 141.58, 1, [hering]);
  assert.equal(a.tipo, 'lancamento');
  if (a.tipo !== 'lancamento') return;
  assert.deepEqual(a.ids, [3972]);
});

test('estorno parcial sugere o líquido', () => {
  const compra: LancamentoNoApp = {
    id: 900, data: '2026-08-10', descricao: 'Brs*sheincomsao Paulobr', valor: 134.7, serieId: null,
  };
  const a = acharNoApp('Cancelamento Parcial De Compra - Brs*sheincomsao Paulobr', 69.14, 1, [compra]);
  assert.equal(a.tipo, 'parcial');
  if (a.tipo !== 'parcial') return;
  assert.equal(a.valorAtual, 134.7);
  assert.equal(a.valorSugerido, 65.56, '134,70 − 69,14');
});

test('parcial com várias candidatas NÃO escolhe — é o caso Apple', () => {
  // Seis compras Apple no mês e um estorno de R$ 3,50 que não casa com nenhuma.
  const apple: LancamentoNoApp[] = [35, 15.14, 5.9, 66.9, 29.9, 10].map((v, k) => ({
    id: 500 + k, data: '2026-08-05', descricao: 'Apple.com/billsao Paulobr', valor: v, serieId: null,
  }));
  const a = acharNoApp('Cancelamento Parcial De Compra - Apple.com/billsao Paulobr', 3.5, 1, apple);
  assert.equal(a.tipo, 'semEncaixe', 'com seis candidatas a tela pergunta, não adivinha');
});

test('devoluções idênticas viram um grupo só', () => {
  const g = agruparIguais([
    { descricao: 'Canc Parcela Sem Juros - Heringblumenaubr', valor: -141.58 },
    { descricao: 'Canc Parcela Sem Juros - Heringblumenaubr', valor: -141.58 },
    { descricao: 'Canc Parcela Sem Juros - Heringblumenaubr', valor: -141.58 },
    { descricao: 'Leiturinhacampinasbr', valor: -540.0 },
  ]);
  assert.equal(g.length, 2, 'três Hering iguais são UMA pergunta, não três');
  const h = g.find((x) => x.loja === 'heringblumenaubr');
  assert.equal(h?.vezes, 3);
  assert.equal(h?.valorUnit, 141.58);
});

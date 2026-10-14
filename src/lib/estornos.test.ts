import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ligarEstornos, lojista, type LinhaPositiva, type Negativa } from './estornos';

const l = (i: number, descricao: string, valor: number, n?: number, de?: number): LinhaPositiva => ({
  i, descricao, valor, parcela: n && de ? { n, de } : null,
});
const neg = (descricao: string, valor: number, motivo = 'estorno ou crédito'): Negativa => ({
  linha: 1, descricao, valor, motivo,
});

// ---------------------------------------------------------------------------
// O lojista
// ---------------------------------------------------------------------------

test('cidade e UF grudadas não separam o mesmo lojista', () => {
  // Medido na fatura de agosto: a parcela 1 veio sem sufixo e as outras onze
  // com ele. Qualquer agrupamento que os separe já perde a linha que importa.
  assert.equal(lojista('Adaptaorg'), lojista('Adaptaorg Sao Paulo Br'));
});

test('o lojista está DEPOIS do asterisco, não antes', () => {
  // Antes disto, sete compras Shopee de vendedores diferentes viravam um grupo
  // só, e um estorno de R$ 0,01 apontava para R$ 868,77 de outras pessoas.
  assert.notEqual(
    lojista('Shopee *Etudofesta Sao Paulo Br'),
    lojista('Shopee *Cristorrisatel Brasilia Br'),
  );
  // E o mesmo lojista por intermediadores diferentes continua sendo o mesmo.
  assert.equal(
    lojista('Brs*Sheincomsao Paulobr'),
    lojista('Shein *Sheincomsao Paulobr'),
  );
});

test('o prefixo que o banco põe no estorno é ignorado', () => {
  assert.equal(
    lojista('Cancelamento De Compra - Apple.com/billsao Paulobr'),
    lojista('Apple.com/billsao Paulobr'),
  );
});

// ---------------------------------------------------------------------------
// O vínculo
// ---------------------------------------------------------------------------

test('estorno igual à soma das parcelas cancela a COMPRA INTEIRA', () => {
  // O caso da Adaptaorg: 12 × R$ 99 e um estorno de −R$ 1.188,00 na mesma
  // fatura. Sem isto o app grava uma série até junho de 2027 para uma compra
  // que a Maria cancelou.
  const linhas = Array.from({ length: 12 }, (_, k) =>
    l(k, k === 0 ? 'Adaptaorg' : 'Adaptaorg Sao Paulo Br', 99, k + 1, 12),
  );
  const [e] = ligarEstornos(linhas, [neg('Adaptaorg Sao Paulo Br', -1188)]);
  assert.equal(e.vinculo.tipo, 'integral');
  assert.equal(e.vinculo.tipo === 'integral' && e.vinculo.refs.length, 12);
});

test('estorno de valor idêntico a UMA linha aponta só para ela', () => {
  const [e] = ligarEstornos(
    [l(0, 'Loja X Sao Paulo Br', 53.78), l(1, 'Loja X Sao Paulo Br', 120)],
    [neg('Cancelamento De Compra - Loja X Sao Paulo Br', -53.78)],
  );
  assert.equal(e.vinculo.tipo, 'linha');
  assert.deepEqual(e.vinculo.tipo === 'linha' && e.vinculo.refs, [0]);
});

test('devolução de parte é marcada como parcial, sem escolher a linha', () => {
  // Qual compra foi reduzida, e em quanto, só quem comprou sabe. A tela mostra
  // e não mexe em nada — C7.
  const [e] = ligarEstornos(
    [l(0, 'Sheincomsao Paulobr', 134.7)],
    [neg('Cancelamento Parcial De Compra - Brs*Sheincomsao Paulobr', -69.14)],
  );
  assert.equal(e.vinculo.tipo, 'parcial');
});

test('estorno sem compra correspondente na fatura fica solto', () => {
  // Compra de outro mês, ou ajuste do banco. Inventar vínculo seria pior.
  const [e] = ligarEstornos([l(0, 'Outra Loja', 50)], [neg('Loja Sumida Br', -10)]);
  assert.equal(e.vinculo.tipo, 'solto');
});

test('pagamento da fatura não procura compra para cancelar', () => {
  // Ele não cancela nenhuma: paga todas. Sem esta exclusão, R$ 16.132,19
  // apareceriam todo mês como "estorno sem correspondência".
  const r = ligarEstornos(
    [l(0, 'Qualquer Coisa', 100)],
    [neg('Pagamento Debito Automatico', -16132.19, 'pagamento da fatura')],
  );
  assert.equal(r.length, 0);
});

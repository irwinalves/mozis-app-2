import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerElenco, podeEntrar, pessoaDoEmail, aOutra } from './pessoas';

const CASAL = { PESSOAS: 'Irwin=irwin@exemplo.com,Maria=maria@exemplo.com' };

test('reconhece cada pessoa pelo e-mail', () => {
  const e = lerElenco(CASAL);
  assert.equal(pessoaDoEmail(e, 'irwin@exemplo.com'), 'Irwin');
  assert.equal(pessoaDoEmail(e, 'maria@exemplo.com'), 'Maria');
});

test('e-mail chega do Google com caixa e espaços variados', () => {
  // O provider devolve o que o usuário cadastrou; comparar cru já quebrou login
  // em outros lugares por causa de uma maiúscula.
  const e = lerElenco(CASAL);
  assert.equal(pessoaDoEmail(e, '  IRWIN@Exemplo.COM '), 'Irwin');
  assert.equal(podeEntrar(e, 'Maria@EXEMPLO.com'), true);
});

test('quem não está na lista não entra', () => {
  const e = lerElenco(CASAL);
  assert.equal(podeEntrar(e, 'estranho@exemplo.com'), false);
  assert.equal(podeEntrar(e, ''), false);
  assert.equal(podeEntrar(e, null), false);
  assert.equal(podeEntrar(e, undefined), false);
});

test('elenco vazio recusa todo mundo — variável esquecida não vira porta aberta', () => {
  const e = lerElenco({});
  assert.equal(podeEntrar(e, 'irwin@exemplo.com'), false);
  assert.equal(podeEntrar(e, 'qualquer@um.com'), false);
});

test('EMAILS_PERMITIDOS ainda deixa entrar, mas sem identificar a pessoa', () => {
  // É a reserva que mantém o login funcionando entre publicar o código e
  // cadastrar PESSOAS na Vercel. Entra, mas a tela mostra os dois lados.
  const e = lerElenco({ EMAILS_PERMITIDOS: 'irwin@exemplo.com,maria@exemplo.com' });
  assert.equal(podeEntrar(e, 'irwin@exemplo.com'), true);
  assert.equal(pessoaDoEmail(e, 'irwin@exemplo.com'), null);
});

test('as duas variáveis convivem', () => {
  const e = lerElenco({ ...CASAL, EMAILS_PERMITIDOS: 'contador@exemplo.com' });
  assert.equal(pessoaDoEmail(e, 'irwin@exemplo.com'), 'Irwin');
  assert.equal(podeEntrar(e, 'contador@exemplo.com'), true);
  assert.equal(pessoaDoEmail(e, 'contador@exemplo.com'), null);
});

test('entrada malformada não derruba nem cria pessoa fantasma', () => {
  const e = lerElenco({ PESSOAS: 'Irwin=irwin@exemplo.com,lixo,=,Maria=' });
  assert.equal(pessoaDoEmail(e, 'irwin@exemplo.com'), 'Irwin');
  assert.equal(e.mapa.size, 1);
});

test('aOutra', () => {
  assert.equal(aOutra('Irwin'), 'Maria');
  assert.equal(aOutra('Maria'), 'Irwin');
});

/**
 * Verificação ponta a ponta: API → banco → API.
 *
 * A regra E1 do projeto diz que nada está pronto sem um lançamento real
 * conferido no banco — porque hash de código e teste de lógica pura não cruzam
 * a junta onde os bugs moram. Este script é essa regra automatizada.
 *
 * ⚠️ ESCREVE NA BASE. Cria um lançamento `ZZTESTE`, verifica, e apaga —
 * conferindo no fim que a contagem voltou ao número original. Não é destrutivo,
 * mas não é leitura: rodar durante uso do app é seguro, e ainda assim o
 * lançamento aparece por alguns segundos na lista de quem estiver com a tela
 * aberta.
 *
 * Uma armadilha custou tempo aqui: abrir uma conexão `postgres()` PRÓPRIA em
 * paralelo com o pool do Drizzle trava o script sem imprimir nada. Use `db` do
 * projeto para tudo, inclusive para as conferências diretas em SQL.
 *
 * Uso: npm run verificar-e2e
 */
import { salvarLancamento, obterLancamento, excluirLancamento,
         buscarLancamentos, ultimosLancamentos } from '../src/lib/api';
import { db } from '../src/db';
import { sql } from 'drizzle-orm';

let falhas = 0;
const ok = (c: boolean, m: string) => { if(!c) falhas++; console.log(`${c ? '  ok  ' : ' FALHA'}  ${m}`); };
const conta = async () => Number((await db.execute<{n:string}>(sql`select count(*) as n from lancamentos`))[0].n);

async function main(){
  const antes = await conta();
  console.log(`base tem ${antes} lançamentos\n`);

  const r = await salvarLancamento({
    data: '2026-08-20', descricao: 'ZZTESTE tag Andre', grupo: '5 Lazer & Pessoal',
    tipo: 'Variável', fonte: 'Cartão', valor: 137.31, divisao: '50/50',
    quemPagou: 'Irwin', gastoDe: 'André',
  });
  const id = r.linhas[0];
  const [linha] = await db.execute<{gasto_de:string|null; quem_pagou:string; saldo_irwin:string}>(
    sql`select gasto_de, quem_pagou, saldo_irwin::text from v_lancamentos where id = ${id}`);
  ok(linha.gasto_de === 'André', `gravou gasto_de='André' no banco (id ${id})`);
  ok(linha.quem_pagou === 'Irwin', 'quem_pagou continua independente da tag');
  ok(Math.abs(Number(linha.saldo_irwin) - 68.655) < 0.001,
     `a tag NÃO mexeu na divisão: saldo ${linha.saldo_irwin} = metade de 137,31`);
  ok((await obterLancamento(id)).gastoDe === 'André', 'obterLancamento devolve gastoDe (usado na edição)');

  const tem = (l: {linha:number}[]) => l.some((x) => x.linha === id);
  ok(tem(await buscarLancamentos('137,31')), 'busca por valor exato "137,31" acha');
  ok(tem(await buscarLancamentos('137')),    'busca por parte inteira "137" acha');
  ok(!tem(await buscarLancamentos('1137')),  'busca "1137" NÃO traz o de 137,31 — sem lixo de substring');
  ok(!tem(await buscarLancamentos('13')),    'busca "13" também não o traz');
  ok(tem(await buscarLancamentos('ZZTESTE')),   'busca por descrição continua funcionando');
  ok(tem(await buscarLancamentos('20/08/2026')),'busca por data continua funcionando');

  const fAndre = await ultimosLancamentos(50, 0, false, { gastoDe: 'André' });
  ok(fAndre.itens.length === 1 && fAndre.itens[0].linha === id, 'filtro gastoDe=André isola só o do André');
  ok(fAndre.resumo?.qtd === 1, `resumo traz qtd e soma: ${fAndre.resumo?.qtd} · R$ ${fAndre.resumo?.soma}`);
  const fParc = await ultimosLancamentos(5, 0, false, { parcelado: true });
  ok(fParc.itens.length > 0 && fParc.itens.every((x) => x.parcelado), `filtro parcelado: ${fParc.resumo?.qtd} lançamentos`);
  const fRec = await ultimosLancamentos(5, 0, false, { recorrente: true });
  ok(fRec.itens.length > 0 && fRec.itens.every((x) => x.recorrente), `filtro recorrente: ${fRec.resumo?.qtd} lançamentos`);
  const fCat = await ultimosLancamentos(5, 0, false, { categoria: '2 Carro' });
  ok(fCat.itens.every((x) => x.categoria === '2 Carro'), `filtro categoria: ${fCat.resumo?.qtd} em 2 Carro`);
  ok((await ultimosLancamentos(50,0,false,{gastoDe:'André',parcelado:true})).itens.length === 0,
     'filtros se combinam — André + parcelado dá 0, o de teste não é parcelado');
  ok((await ultimosLancamentos(5)).resumo === null, 'sem filtro não paga o custo do resumo');

  const pag = await ultimosLancamentos(400, 0, false);
  const datas = pag.itens.map((x) => x.data);
  ok(datas.every((d,i) => i === 0 || datas[i-1] >= d), 'data continua decrescente');

  // Achar um dia com VÁRIOS lançamentos. Sem isso a asserção passa por sorte:
  // uma lista de um item está sempre ordenada, e um teste que não pode falhar
  // não é evidência de nada. Na primeira execução foi exatamente o que houve.
  const porDia = new Map<string, string[]>();
  for (const it of pag.itens) porDia.set(it.data, [...(porDia.get(it.data) ?? []), it.descricao]);
  const cheio = [...porDia.entries()].filter(([, v]) => v.length >= 3)
                                     .sort((a,b) => b[1].length - a[1].length)[0];
  if (!cheio) {
    ok(false, 'nenhum dia com 3+ lançamentos — não deu para testar a ordem alfabética');
  } else {
    const [dia, descs] = cheio;
    const esperado = [...descs].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    ok(JSON.stringify(descs) === JSON.stringify(esperado),
       `${dia}: ${descs.length} lançamentos em ordem alfabética — ${descs.slice(0,4).join(' · ')}${descs.length>4?' …':''}`);
  }

  await excluirLancamento(id);
  const depois = await conta();
  ok(depois === antes, `lançamento de teste removido — base voltou a ${depois}`);

  console.log(`\n${falhas === 0 ? 'tudo passou' : falhas + ' falha(s)'}`);
  process.exit(falhas > 0 ? 1 : 0);
}
main().catch((e)=>{ console.error('ERRO:', e); process.exit(1); });

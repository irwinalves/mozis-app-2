/**
 * Enche um banco VAZIO com dados fictícios plausíveis, para quem clona o
 * repositório ver o app funcionando em cinco minutos.
 *
 * POR QUE ISTO EXISTE
 *
 * O app é de duas pessoas de verdade e o banco de produção não pode ser
 * publicado. Sem uma base de demonstração, quem clona sobe o projeto, faz login
 * e encontra seis telas vazias — e nenhuma delas explica o que o app faz.
 *
 * POR QUE ELE IMPORTA AS REGRAS EM VEZ DE REPETI-LAS
 *
 * `pctIrwinDe` e `pagoIrwinDe` vêm de `src/lib/lancamentos.ts`. Reescrever a
 * aritmética aqui criaria uma segunda implementação da divisão (regra nº 3 do
 * CLAUDE.md), e ela divergiria da primeira no dia em que alguém mudasse uma das
 * duas. Efeito colateral bom: os dados semeados obedecem aos MESMOS invariantes
 * dos reais, então `npm run invariantes` roda limpo sobre esta base.
 *
 * É DETERMINÍSTICO de propósito. O sorteio usa semente fixa, então duas pessoas
 * que rodam o script veem exatamente a mesma tela — e os prints da documentação
 * continuam valendo depois de qualquer reinstalação.
 *
 * Uso:
 *   npm run semear-demo              # exige banco vazio
 *   npm run semear-demo -- --limpar  # apaga tudo e recria
 */
import postgres from 'postgres';
import { pctIrwinDe, pagoIrwinDe } from '../src/lib/lancamentos';

const args = process.argv.slice(2);
const LIMPAR = args.includes('--limpar');
const REMOTO = args.includes('--remoto');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida. Ponha no `.env` e rode com `npm run semear-demo`.');
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return '(host ilegível)';
  }
})();
const local = ['localhost', '127.0.0.1', '::1'].includes(host);

console.log(`\nBanco alvo: ${host}${local ? '  (local)' : '  ⚠️  REMOTO'}`);

/* A trava que importa. Este script apaga dados, e o acidente clássico é rodar
   com o `.env` de produção aberto por engano. Num host remoto ele PARA, e só
   segue com um sinal explícito na linha de comando. */
if (!local && !REMOTO) {
  console.error(
    '\nRecusado: isto apaga e reescreve o banco inteiro, e o host não é local.\n' +
      'Se for mesmo o que você quer, repita com --remoto.\n',
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

/** Sorteio determinístico (mulberry32). Semente fixa: a demonstração é sempre igual. */
let semente = 20261118;
function rnd(): number {
  semente |= 0;
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const escolher = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const entre = (a: number, b: number) => Math.round((a + rnd() * (b - a)) * 100) / 100;
const arred = (n: number) => Math.round(n * 100) / 100;
const dia = (ano: number, mes: number, d: number) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`;

const CATEGORIAS = [
  ['1 Casa', 'Fixa', 1],
  ['2 Carro', 'Variável', 2],
  ['3 Comida', 'Variável', 3],
  ['4 Saúde', 'Variável', 4],
  ['5 Lazer & Pessoal', 'Variável', 5],
  ['6 Viagem', 'Variável', 6],
  ['7 Outros', 'Variável', 7],
  ['8 Investimentos', 'Investimento', 8],
  ['9 Acerto de Contas', 'Acerto', 9],
] as const;

/** Despesas fixas do mês. Sempre as mesmas, que é o que "fixa" quer dizer. */
const FIXAS = [
  ['Aluguel', '1 Casa', 2500, 5, 'Ambos'],
  ['Condomínio', '1 Casa', 640, 5, 'Ambos'],
  ['Luz', '1 Casa', 180, 12, 'Irwin'],
  ['Internet', '1 Casa', 129.9, 15, 'Irwin'],
  ['Plano de saúde', '4 Saúde', 740, 8, 'Maria'],
  ['Academia', '5 Lazer & Pessoal', 149, 10, 'Maria'],
  ['Streaming', '5 Lazer & Pessoal', 55.9, 20, 'Irwin'],
] as const;

const VARIAVEIS = [
  ['Supermercado', '3 Comida', 280, 760],
  ['Feira', '3 Comida', 95, 220],
  ['Padaria', '3 Comida', 28, 95],
  ['Restaurante', '3 Comida', 110, 340],
  ['Delivery', '3 Comida', 65, 190],
  ['Combustível', '2 Carro', 220, 430],
  ['Manutenção do carro', '2 Carro', 180, 980],
  ['Estacionamento', '2 Carro', 22, 75],
  ['Farmácia', '4 Saúde', 40, 260],
  ['Consulta', '4 Saúde', 150, 420],
  ['Cinema', '5 Lazer & Pessoal', 70, 140],
  ['Presente', '7 Outros', 90, 390],
  ['Livraria', '5 Lazer & Pessoal', 70, 210],
  ['Pet shop', '7 Outros', 120, 300],
  ['Roupas', '5 Lazer & Pessoal', 140, 620],
  ['Passagem', '6 Viagem', 400, 1400],
  ['Hospedagem', '6 Viagem', 350, 1200],
] as const;

type Linha = {
  data: string;
  descricao: string;
  categoria: string;
  tipo: string;
  valorTotal: number;
  divisao: string;
  pctCustom?: number | null;
  quemPagou: string | null;
  fonte?: string | null;
  recorrente?: boolean;
  gastoDe?: string | null;
  deFora?: boolean;
  serieId?: number | null;
  seq?: number | null;
  importacaoId?: number | null;
};

/** Monta a linha já com as colunas derivadas pelas MESMAS funções do app. */
function derivar(l: Linha) {
  const pct = pctIrwinDe(l.divisao, l.pctCustom ?? null, 0.55);
  const parteIrwin = arred(l.valorTotal * pct);
  const pago = pagoIrwinDe(l.quemPagou as never, l.valorTotal, parteIrwin, null);
  return {
    data: l.data,
    descricao: l.descricao,
    categoria: l.categoria,
    tipo: l.tipo,
    valor_total: l.valorTotal.toFixed(2),
    divisao: l.divisao,
    pct_irwin_custom: l.pctCustom == null ? null : String(l.pctCustom / 100),
    quem_pagou: l.quemPagou,
    pago_irwin: pago === null ? null : String(pago),
    pct_irwin: String(pct),
    // Derivada da categoria, nunca digitada: é o invariante A6.
    eh_quitacao: l.categoria.startsWith('9 '),
    de_fora: l.deFora ?? false,
    gasto_de: l.gastoDe ?? null,
    fonte: l.fonte ?? null,
    recorrente: l.recorrente ?? false,
    serie_id: l.serieId ?? null,
    seq: l.seq ?? null,
    importacao_id: l.importacaoId ?? null,
  };
}

async function main() {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from lancamentos`;
  if (n > 0 && !LIMPAR) {
    console.error(
      `\nRecusado: já existem ${n} lançamentos aqui.\n` +
        'Este script é para banco vazio. Para apagar tudo e recriar, use --limpar.\n',
    );
    await sql.end();
    process.exit(1);
  }
  if (n > 0) {
    console.log(`Apagando ${n} lançamentos e o resto da base…`);
    await sql`truncate lancamentos, series, importacoes, recorrencias, acerto_contas,
                       reembolsos, investimentos_movimentos, investimentos_contas,
                       patrimonio, plano_de_contas, config restart identity cascade`;
  }

  await sql`insert into config (id, pct_irwin_renda) values (1, 0.55)
            on conflict (id) do update set pct_irwin_renda = 0.55`;
  for (const [nome, tipoPadrao, ordem] of CATEGORIAS) {
    await sql`insert into plano_de_contas (nome, tipo_padrao, ordem)
              values (${nome}, ${tipoPadrao}, ${ordem})`;
  }

  /* Dezoito meses, atravessando a virada do ano. Com um ano só, o gráfico de
     evolução das fixas mostra uma barra sozinha e não evolui nada. */
  const MESES: [number, number][] = [
    [2025, 6], [2025, 7], [2025, 8], [2025, 9], [2025, 10], [2025, 11], [2025, 12],
    [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6],
    [2026, 7], [2026, 8], [2026, 9], [2026, 10], [2026, 11],
  ];

  /* As fixas são recorrentes, e recorrente de verdade tem REGRA: sem a linha em
     `recorrencias`, o cron não tem o que continuar e a despesa morre no fim do
     mês sem erro nenhum. É o invariante A10, e ele reprova a base semeada se
     este bloco não existir — foi assim que eu descobri que tinha esquecido. */
  const ULTIMO = MESES[MESES.length - 1];
  for (const [desc, cat, valor, d, quem] of FIXAS) {
    await sql`insert into recorrencias ${sql(
      {
        data_inicio: dia(MESES[0][0], MESES[0][1], d),
        descricao: desc,
        categoria: cat,
        fonte: 'Cartão',
        valor: valor.toFixed(2),
        divisao: desc === 'Academia' || desc === 'Streaming' ? `100% ${quem}` : '50/50',
        quem_pagou: quem,
        frequencia: 'Mensal',
        ultima_geracao: dia(ULTIMO[0], ULTIMO[1], d),
        ativo: true,
      } as never,
    )}`;
  }

  const linhas: Linha[] = [];
  for (const [ano, mes] of MESES) {
    for (const [desc, cat, valor, d, quem] of FIXAS) {
      linhas.push({
        data: dia(ano, mes, d),
        descricao: desc,
        categoria: cat,
        tipo: 'Fixa',
        valorTotal: desc === 'Luz' ? entre(valor * 0.8, valor * 1.3) : valor,
        divisao: desc === 'Academia' || desc === 'Streaming' ? `100% ${quem}` : '50/50',
        quemPagou: quem,
        recorrente: true,
      });
    }
    const quantas = 15 + Math.floor(rnd() * 8);
    for (let i = 0; i < quantas; i++) {
      const [desc, cat, min, max] = escolher(VARIAVEIS);
      const quem = escolher(['Irwin', 'Maria', 'Ambos'] as const);
      linhas.push({
        data: dia(ano, mes, 1 + Math.floor(rnd() * 27)),
        descricao: desc,
        categoria: cat,
        tipo: 'Variável',
        valorTotal: entre(min, max),
        divisao: escolher(['50/50', '50/50', '50/50', 'Renda', `100% ${quem === 'Ambos' ? 'Irwin' : quem}`]),
        quemPagou: quem,
        fonte: rnd() < 0.6 ? 'Cartão' : 'Pix',
      });
    }
  }

  /* Parcelamentos de verdade, com a ÚLTIMA parcela absorvendo o arredondamento.
     São DOIS, e não um, por causa da tela inicial: o acerto mostra três cortes
     (até o fim deste mês, até o fim do mês que vem, e o total). Com um único
     parcelamento terminando em dezembro, os dois últimos cortes davam o mesmo
     número e a tela ficava com cara de defeito sem ter defeito nenhum. Uma
     série que atravessa o ano é também o que acontece de verdade. */
  async function parcelar(
    descricao: string,
    categoria: string,
    total: number,
    vezes: number,
    anoInicio: number,
    mesInicio: number,
    quemPagou: string,
  ) {
    const [serie] = await sql<{ id: number }[]>`
      insert into series (tipo, descricao, total, origem)
      values ('Parcelamento', ${descricao}, ${vezes}, 'manual') returning id`;
    const base = Math.floor((total / vezes) * 100) / 100;
    for (let k = 1; k <= vezes; k++) {
      // Uma parcela por MÊS, virando o ano quando precisa. `dia()` não vira
      // sozinho: ele só formata, e mês 13 sairia como `2026-13-14`.
      const m = mesInicio + (k - 1);
      linhas.push({
        data: dia(anoInicio + Math.floor((m - 1) / 12), ((m - 1) % 12) + 1, 14),
        descricao: `${descricao} ${k}/${vezes}`,
        categoria,
        tipo: 'Variável',
        valorTotal: k === vezes ? arred(total - base * (vezes - 1)) : base,
        divisao: '50/50',
        quemPagou,
        fonte: 'Cartão',
        serieId: serie.id,
        seq: k,
      });
    }
  }

  await parcelar('Geladeira', '1 Casa', 2399.4, 6, 2026, 7, 'Irwin');
  await parcelar('Notebook', '5 Lazer & Pessoal', 6499.0, 12, 2026, 9, 'Maria');

  /* Um gasto de terceiro: passou pelo cartão do casal mas é de outra pessoa.
     Fica FORA do acerto dos dois e vira dívida dela, na tela de Terceiros. */
  linhas.push({
    data: dia(2026, 10, 9),
    descricao: 'Conta de celular da mãe',
    categoria: '7 Outros',
    tipo: 'Variável',
    valorTotal: 159.9,
    divisao: 'De fora',
    quemPagou: 'Irwin',
    fonte: 'Cartão',
    deFora: true,
    gastoDe: 'Mãe do Irwin',
  });
  linhas.push({
    data: dia(2026, 11, 9),
    descricao: 'Conta de celular da mãe',
    categoria: '7 Outros',
    tipo: 'Variável',
    valorTotal: 159.9,
    divisao: 'De fora',
    quemPagou: 'Irwin',
    fonte: 'Cartão',
    deFora: true,
    gastoDe: 'Mãe do Irwin',
  });

  /* Uma importação de fatura, para a tela de importação ter história. */
  const [imp] = await sql<{ id: number }[]>`
    insert into importacoes (tipo, titulo, arquivo, qtd, total, criada_por)
    values ('cartao', 'Fatura de outubro', 'fatura-2026-10.xlsx', 0, 0, 'Irwin') returning id`;
  const daFatura = [
    ['Assinatura de música', '5 Lazer & Pessoal', 21.9],
    ['Livraria online', '5 Lazer & Pessoal', 89.7],
    ['App de transporte', '2 Carro', 37.4],
    ['Mercado online', '3 Comida', 243.15],
    ['Papelaria', '7 Outros', 54.2],
  ] as const;
  for (const [desc, cat, valor] of daFatura) {
    linhas.push({
      data: dia(2026, 10, 3 + Math.floor(rnd() * 20)),
      descricao: desc,
      categoria: cat,
      tipo: 'Variável',
      valorTotal: valor,
      divisao: '100% Irwin',
      quemPagou: 'Irwin',
      fonte: 'Cartão',
      importacaoId: imp.id,
    });
  }

  /* Uma quitação entre os dois. Categoria 9 não é despesa, é acerto. */
  linhas.push({
    data: dia(2026, 9, 2),
    descricao: 'Acerto de agosto',
    categoria: '9 Acerto de Contas',
    tipo: 'Variável',
    valorTotal: 600,
    divisao: '100% Maria',
    quemPagou: 'Maria',
  });

  linhas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  for (const l of linhas) {
    const r = derivar(l);
    await sql`insert into lancamentos ${sql(r as never)}`;
  }
  await sql`update importacoes set qtd = ${daFatura.length},
              total = ${daFatura.reduce((s, [, , v]) => s + v, 0).toFixed(2)}
            where id = ${imp.id}`;

  /* A mãe já devolveu a primeira conta; a segunda ainda está em aberto. Assim a
     tela de Terceiros mostra os dois estados, que é o que ela existe para contar. */
  await sql`insert into reembolsos (data, pessoa, para_quem, valor, obs)
            values (${dia(2026, 10, 25)}, 'Mãe do Irwin', 'Irwin', '159.90', 'Pix')`;

  /* Investimentos: conta, aportes e a posição mensal. O rendimento não é
     digitado, ele sai da diferença entre posições menos os aportes do período,
     que é por que a posição precisa existir mês a mês. */
  await sql`insert into investimentos_contas ${sql(
    { nome: 'Tesouro Direto', apelido: 'Tesouro', classe: 'Renda fixa', de_quem: 'Ambos' } as never,
  )}`;
  let saldo = 12000;
  for (const [ano, mes] of MESES) {
    const aporte = 800;
    await sql`insert into investimentos_movimentos ${sql(
      { data: dia(ano, mes, 5), conta: 'Tesouro Direto', tipo: 'Aporte', valor: aporte.toFixed(2), de_quem: 'Ambos' } as never,
    )}`;
    saldo = arred(saldo + aporte + saldo * 0.008);
    await sql`insert into patrimonio ${sql(
      { data: dia(ano, mes, 28), total_investido: saldo.toFixed(2), dividas: '0.00', patrimonio_liquido: saldo.toFixed(2) } as never,
    )}`;
  }

  const [fim] = await sql<{ n: number; t: string }[]>`
    select count(*)::int as n, coalesce(sum(valor_total),0)::text as t from lancamentos`;
  const [ter] = await sql<{ pessoas: number; aberto: string }[]>`
    select count(*)::int as pessoas, coalesce(sum(saldo),0)::text as aberto
      from v_terceiros where saldo > 0.005`;
  const [ac] = await sql<{ saldo: string }[]>`
    select coalesce(sum(saldo_irwin),0)::text as saldo from v_lancamentos`;

  const [a0, m0] = MESES[0];
  const [a1, m1] = MESES[MESES.length - 1];
  console.log(
    `\n✓ ${fim.n} lançamentos entre ${String(m0).padStart(2, '0')}/${a0} e ${String(m1).padStart(2, '0')}/${a1}`,
  );
  console.log(`  2 parcelamentos (6x e 12x) · 1 importação de fatura · 1 quitação`);
  console.log(`  ${ter.pessoas} terceiro(s) devendo R$ ${Number(ter.aberto).toFixed(2)}`);
  console.log(`  acerto do casal: R$ ${Number(ac.saldo).toFixed(2)} (positivo = a Maria deve)`);
  console.log(`\nTudo fictício. Rode \`npm run invariantes\` para ver a base passar nas 20 regras.\n`);
  await sql.end();
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});

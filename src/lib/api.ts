/**
 * Os métodos que o `Form.html` chama.
 *
 * Mesmos nomes, mesmos argumentos e MESMO FORMATO DE RESPOSTA do backend Apps
 * Script — é isso que permite servir o front sem alteração. O que muda é só a
 * camada de dados: onde havia varredura de planilha, agora há SQL.
 *
 * Some por construção tudo que existia só por causa da planilha:
 * `garantirFormulas`, `proximaLinhaVazia`, `acharLinha`, a janela que cresce
 * (`JANELA_INICIAL`/`JANELA_MAXIMA`) e o `LockService`.
 */
import { db } from '@/db';
import { sql } from 'drizzle-orm';
import {
  arred,
  formatarData,
  montarParcelas,
  montarRecorrencias,
  pagoIrwinDe,
  pctIrwinDe,
  fracaoPagaPeloIrwin,
  type DadosParcelas,
  type DadosRecorrencia,
} from './lancamentos';

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** 'yyyy-MM-dd' → Date local, sem o desvio de fuso do construtor com string. */
function dataLocal(iso: string): Date {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** O driver devolve `date` como Date em meia-noite UTC — extrair em UTC. */
function isoDaLinha(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * Assinatura de um lançamento: data, descrição e valor.
 *
 * O front referencia o lançamento por um identificador que ele guardou quando a
 * lista foi carregada. Se o registro mudou nesse meio-tempo, gravar acertaria
 * outra coisa em silêncio. A assinatura viaja junto e é conferida antes de
 * qualquer escrita.
 */
function assinaturaDe(data: string, descricao: string, valor: number): string {
  return `${data}|${descricao}|${Number(valor).toFixed(2)}`;
}

interface LinhaView extends Record<string, unknown> {
  id: number;
  data: Date | string;
  descricao: string;
  categoria: string;
  tipo: string;
  fonte: string | null;
  valor_total: string;
  divisao: string;
  pct_irwin_custom: string | null;
  quem_pagou: string | null;
  obs: string | null;
  recorrente: boolean;
  parte_irwin: string | null;
  parte_maria: string | null;
  pago_irwin: string | null;
  saldo_irwin: string | null;
}

/** Converte uma linha da view no item que a lista do Início espera. */
function paraItem(r: LinhaView) {
  const iso = isoDaLinha(r.data);
  const d = dataLocal(iso);
  return {
    linha: r.id,
    data: iso,
    dia: String(d.getDate()).padStart(2, '0'),
    mesAbrev: MESES_PT[d.getMonth()].slice(0, 3).toUpperCase(),
    mesChave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    mesLabel: `${MESES_PT[d.getMonth()]} de ${d.getFullYear()}`,
    descricao: r.descricao,
    categoria: r.categoria,
    tipo: r.tipo,
    valor: Number(r.valor_total),
    parteIrwin: Number(r.parte_irwin ?? 0),
    parteMaria: Number(r.parte_maria ?? 0),
    quemPagou: r.quem_pagou ?? '',
    recorrente: !!r.recorrente,
  };
}

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

export async function getOpcoes() {
  const grupos = await db.execute<{ nome: string; tipo_padrao: string | null }>(
    sql`select nome, tipo_padrao from plano_de_contas order by ordem`,
  );
  const [conf] = await db.execute<{ pct_irwin_renda: string }>(
    sql`select pct_irwin_renda from config where id = 1`,
  );

  const lista = grupos.map((g) => ({ nome: g.nome, tipo: g.tipo_padrao ?? 'Variável' }));
  const hoje = new Date();

  return {
    grupos: lista,
    // '8 Investimentos' tem tela própria; '9 Acerto de Contas' fica, é o que o
    // botão Quitar usa.
    gruposLancar: lista.filter((g) => !g.nome.startsWith('8 ')),
    origens: ['Cartão', 'Pix'],
    divisoes: ['50/50', 'Renda', '100% Irwin', '100% Maria', 'Custom'],
    pagadores: ['Irwin', 'Maria', 'Ambos'],
    pagadoresLancar: ['Irwin', 'Maria', 'Ambos'],
    movimentosInvest: ['Aporte', 'Resgate'],
    classesInvestimento: ['Reserva', 'Renda fixa', 'Ações/FII', 'Previdência', 'Cripto', 'Outros'],
    pctIrwinRenda: Number(conf?.pct_irwin_renda ?? 0.4947),
    hoje: formatarData(hoje),
  };
}

// ---------------------------------------------------------------------------
// Leitura da lista
// ---------------------------------------------------------------------------

/**
 * Lançamentos recentes, ordenados pela DATA.
 *
 * Na planilha isto exigia ler um bloco contíguo e ordená-lo inteiro, porque
 * ordem física não é ordem de data — parcelas futuras e lançamentos
 * retroativos são gravados no fim. Aqui é `order by data desc` sobre um índice.
 */
export async function ultimosLancamentos(qtd = 50, offset = 0, incluirFuturos = false) {
  const limite = sql`(date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date`;

  const [{ n }] = await db.execute<{ n: string }>(
    sql`select count(*) as n from v_lancamentos where data > ${limite}`,
  );
  const qtdFuturos = Number(n);

  const filtro = incluirFuturos ? sql`true` : sql`data <= ${limite}`;

  const linhas = await db.execute<LinhaView>(
    sql`select * from v_lancamentos where ${filtro}
        order by data desc, id desc
        limit ${qtd + 1} offset ${offset}`,
  );

  const temMais = linhas.length > qtd;
  return { itens: linhas.slice(0, qtd).map(paraItem), temMais, qtdFuturos };
}

/**
 * Busca em todo o histórico, por descrição ou data.
 * Aceita `dd/mm` e `dd/mm/yyyy`, como o backend antigo. Teto de 60 resultados.
 */
export async function buscarLancamentos(termo: string) {
  const t = String(termo || '').trim();
  if (!t) return [];

  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  let filtro;
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    filtro = m[3]
      ? sql`data = make_date(${Number(m[3])}, ${mes}, ${dia})`
      : sql`extract(day from data) = ${dia} and extract(month from data) = ${mes}`;
  } else {
    filtro = sql`descricao ilike ${'%' + t + '%'}`;
  }

  const linhas = await db.execute<LinhaView>(
    sql`select * from v_lancamentos where ${filtro} order by data desc, id desc limit 60`,
  );
  return linhas.map(paraItem);
}

// ---------------------------------------------------------------------------
// Acerto de contas
// ---------------------------------------------------------------------------

function situacaoDoSaldo(saldo: number): string {
  const v = Math.abs(saldo).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  if (Math.abs(saldo) < 0.005) return 'Estão quites.';
  return saldo > 0 ? `Maria deve ${v} a Irwin` : `Irwin deve ${v} a Maria`;
}

/**
 * Saldo em 3 cortes. A regra não é recalculada: soma `saldo_irwin` da view e
 * desconta as quitações históricas, exatamente como antes.
 *
 * As datas são comparadas NO POSTGRES. Fazer isso em JS já custou caro: o
 * driver devolve `date` em meia-noite UTC e a comparação silenciosamente
 * nunca excluía nada.
 */
export async function getAcertoContas() {
  async function saldoAte(meses: number | null): Promise<number> {
    const corte =
      meses === null
        ? null
        : sql`(date_trunc('month', current_date) + (${meses + 1} || ' month')::interval - interval '1 day')::date`;
    const onde = corte ? sql`data <= ${corte}` : sql`true`;

    const [{ saldo }] = await db.execute<{ saldo: string }>(
      sql`select round(
            coalesce((select sum(saldo_irwin) from v_lancamentos where ${onde}), 0)
          + coalesce((select sum(case when quem_pagou = 'Irwin' then valor
                                      when quem_pagou = 'Maria' then -valor
                                      else 0 end)
                      from acerto_contas where ${onde}), 0)
          , 2) as saldo`,
    );
    return Number(saldo);
  }

  const [mesAtual, mesSeguinte, total] = await Promise.all([
    saldoAte(0),
    saldoAte(1),
    saldoAte(null),
  ]);

  return {
    mesAtual: { saldo: mesAtual, situacao: situacaoDoSaldo(mesAtual) },
    mesSeguinte: { saldo: mesSeguinte, situacao: situacaoDoSaldo(mesSeguinte) },
    total: { saldo: total, situacao: situacaoDoSaldo(total) },
  };
}

// ---------------------------------------------------------------------------
// Prévias (lógica pura — não tocam o banco)
// ---------------------------------------------------------------------------

const brl = (v: number) => v;

export async function previewParcelas(dados: DadosParcelas) {
  return montarParcelas(dados).map((p) => ({
    data: `${String(p.data.getDate()).padStart(2, '0')}/${String(p.data.getMonth() + 1).padStart(2, '0')}/${p.data.getFullYear()}`,
    descricao: p.descricao,
    valor: brl(p.valor),
  }));
}

export async function previewRecorrencia(dados: DadosRecorrencia) {
  return montarRecorrencias(dados).map((o) => ({
    data: `${String(o.data.getDate()).padStart(2, '0')}/${String(o.data.getMonth() + 1).padStart(2, '0')}/${o.data.getFullYear()}`,
    descricao: o.descricao,
    valor: brl(o.valor),
  }));
}

// ---------------------------------------------------------------------------
// Um lançamento
// ---------------------------------------------------------------------------

export async function obterLancamento(id: number) {
  const [r] = await db.execute<LinhaView>(
    sql`select * from v_lancamentos where id = ${id}`,
  );
  if (!r) throw new Error('Lançamento não encontrado.');

  const iso = isoDaLinha(r.data);
  return {
    linha: r.id,
    data: iso,
    descricao: r.descricao,
    categoria: r.categoria,
    tipo: r.tipo,
    fonte: r.fonte,
    valor: Number(r.valor_total),
    divisao: r.divisao,
    // O front fala PERCENTUAL; a coluna guarda fração. A conversão é aqui.
    pctCustom: r.pct_irwin_custom === null ? null : Number(r.pct_irwin_custom) * 100,
    quemPagou: r.quem_pagou,
    pagoIrwin: r.pago_irwin === null ? null : Number(r.pago_irwin),
    obs: r.obs,
    assinatura: assinaturaDe(iso, r.descricao, Number(r.valor_total)),
  };
}

interface DadosLancamento {
  data: string;
  descricao: string;
  categoria: string;
  tipo: string;
  fonte?: string;
  valor: number | string;
  divisao: string;
  pctIrwinCustom?: number | string | null;
  quemPagou?: string | null;
  pagoIrwin?: number | string | null;
  obs?: string | null;
  parcelado?: boolean;
  parcelas?: number | string;
  tipoValor?: 'total' | 'parcela';
  repetir?: boolean;
  freqRec?: string;
  fimRec?: string;
  semFimRec?: boolean;
  assinatura?: string;
}

/** Confere que o registro não mudou desde que o front carregou a lista. */
async function conferirAssinatura(id: number, assinatura: string | undefined) {
  const [r] = await db.execute<{ data: Date; descricao: string; valor_total: string }>(
    sql`select data, descricao, valor_total from lancamentos where id = ${id}`,
  );
  if (!r) throw new Error('Lançamento não encontrado.');
  const atual = assinaturaDe(isoDaLinha(r.data), r.descricao, Number(r.valor_total));
  if (!assinatura || assinatura !== atual) {
    throw new Error('Essa lista está desatualizada. Recarregue o app e tente de novo.');
  }
}

export async function salvarLancamento(dados: DadosLancamento) {
  if (!dados.descricao) throw new Error('Informe a descrição.');
  if (!dados.categoria) throw new Error('Escolha a categoria.');
  if (!dados.tipo) throw new Error('Escolha o tipo.');

  // Todo gasto recorrente é Fixa.
  const tipo = dados.repetir ? 'Fixa' : dados.tipo;

  const ocorrencias = dados.repetir
    ? montarRecorrencias(dados as DadosRecorrencia)
    : montarParcelas(dados as DadosParcelas);

  const fracao = fracaoPagaPeloIrwin(
    { quemPagou: dados.quemPagou as never, pagoIrwin: dados.pagoIrwin, repetir: dados.repetir },
    ocorrencias,
  );

  const pct = pctIrwinDe(dados.divisao, Number(dados.pctIrwinCustom));
  // A coluna guarda FRAÇÃO; o front manda percentual.
  const pctCustomFracao =
    dados.divisao === 'Custom' ? (Number(dados.pctIrwinCustom) || 0) / 100 : null;

  const total = ocorrencias.reduce((a, b) => a + b.valor, 0);
  let acumuladoPago = 0;

  const linhas = await db.transaction(async (tx) => {
    const ids: number[] = [];
    for (let i = 0; i < ocorrencias.length; i++) {
      const o = ocorrencias[i];
      const parteIrwin = arred(o.valor * pct);

      let pagoIrwin: number | null;
      if (fracao === null) {
        pagoIrwin = pagoIrwinDe(dados.quemPagou as never, o.valor, parteIrwin, dados.pagoIrwin);
      } else if (dados.repetir) {
        // Recorrência: cada ocorrência tem o valor cheio, o rateio se repete.
        pagoIrwin = arred(o.valor * fracao);
      } else {
        // Parcelamento: proporção aplicada a cada parcela, a última absorve o
        // arredondamento — igual ao que se faz com o valor.
        pagoIrwin =
          i === ocorrencias.length - 1
            ? arred(Number(dados.pagoIrwin) || arred(total * fracao)) - acumuladoPago
            : arred(o.valor * fracao);
        if (i < ocorrencias.length - 1) acumuladoPago += pagoIrwin;
      }

      const [row] = await tx.execute<{ id: number }>(
        sql`insert into lancamentos
              (data, descricao, categoria, tipo, fonte, valor_total, divisao,
               pct_irwin_custom, quem_pagou, pago_irwin, obs, recorrente)
            values (${formatarData(o.data)}, ${o.descricao}, ${dados.categoria}, ${tipo},
                    ${dados.fonte ?? null}, ${o.valor}, ${dados.divisao},
                    ${pctCustomFracao}, ${dados.quemPagou ?? null}, ${pagoIrwin},
                    ${dados.obs ?? null}, ${!!dados.repetir})
            returning id`,
      );
      ids.push(row.id);
    }
    return ids;
  });

  return { qtd: linhas.length, total: arred(total), linhas };
}

export async function atualizarLancamento(id: number, dados: DadosLancamento) {
  await conferirAssinatura(id, dados.assinatura);

  const pct = pctIrwinDe(dados.divisao, Number(dados.pctIrwinCustom));
  const valor = arred(Number(dados.valor));
  const parteIrwin = arred(valor * pct);
  const pagoIrwin = pagoIrwinDe(dados.quemPagou as never, valor, parteIrwin, dados.pagoIrwin);
  const pctCustomFracao =
    dados.divisao === 'Custom' ? (Number(dados.pctIrwinCustom) || 0) / 100 : null;

  // Edita UMA linha só: não mexe em parcelas irmãs, nem em Obs, nem na
  // categoria original — mesmo comportamento de antes.
  await db.execute(
    sql`update lancamentos set
          data = ${dados.data}, descricao = ${dados.descricao},
          categoria = ${dados.categoria}, tipo = ${dados.tipo},
          fonte = ${dados.fonte ?? null}, valor_total = ${valor},
          divisao = ${dados.divisao}, pct_irwin_custom = ${pctCustomFracao},
          quem_pagou = ${dados.quemPagou ?? null}, pago_irwin = ${pagoIrwin}
        where id = ${id}`,
  );
  return { ok: true };
}

export async function excluirLancamento(id: number, assinatura?: string) {
  // Numa exclusão a confusão de registro é irreversível — a conferência pesa mais.
  await conferirAssinatura(id, assinatura);
  await db.execute(sql`delete from lancamentos where id = ${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Investimentos
// ---------------------------------------------------------------------------

export async function salvarInvestimento(dados: {
  data: string;
  conta: string;
  movimento: string;
  valor: number | string;
  classe?: string;
  deQuem?: string;
  obs?: string;
}) {
  if (!dados.conta) throw new Error('Informe a instituição.');
  const valor = arred(Number(dados.valor));
  if (!(valor > 0)) throw new Error('Informe um valor maior que zero.');

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into investimentos_contas (nome, classe, de_quem)
          values (${dados.conta}, ${dados.classe ?? null}, ${dados.deQuem ?? null})
          on conflict (nome) do nothing`,
    );
    await tx.execute(
      sql`insert into investimentos_movimentos (data, conta, tipo, valor, de_quem, obs)
          values (${dados.data}, ${dados.conta}, ${dados.movimento}, ${valor},
                  ${dados.deQuem ?? null}, ${dados.obs ?? null})`,
    );
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getPatrimonio() {
  try {
    const [r] = await db.execute<{
      total_investido: string | null;
      dividas: string | null;
      patrimonio_liquido: string | null;
    }>(
      sql`select total_investido, dividas, patrimonio_liquido
          from patrimonio where patrimonio_liquido is not null
          order by data desc limit 1`,
    );
    if (!r) return { totalInvestido: null, dividas: null, patrimonioLiquido: null };
    return {
      totalInvestido: r.total_investido === null ? null : Number(r.total_investido),
      dividas: r.dividas === null ? null : Number(r.dividas),
      patrimonioLiquido:
        r.patrimonio_liquido === null ? null : Number(r.patrimonio_liquido),
    };
  } catch {
    // Nunca quebra o dashboard por causa do patrimônio — mostra "—".
    return { totalInvestido: null, dividas: null, patrimonioLiquido: null };
  }
}

export async function getDashboard(filtro?: {
  dataIni?: string;
  dataFim?: string;
  granularidade?: 'mensal' | 'anual';
}) {
  const granularidade = filtro?.granularidade ?? 'anual';
  // Investimento e '9 Acerto de Contas' ficam fora de todo relatório de gasto.
  const base = sql`from v_lancamentos
                   where tipo <> 'Investimento'
                     and categoria not like '9 %'
                     ${filtro?.dataIni ? sql`and data >= ${filtro.dataIni}` : sql``}
                     ${filtro?.dataFim ? sql`and data <= ${filtro.dataFim}` : sql``}`;

  const [mes] = await db.execute<{ fixa: string; variavel: string }>(
    sql`select
          coalesce(sum(valor_total) filter (where tipo = 'Fixa'), 0) as fixa,
          coalesce(sum(valor_total) filter (where tipo = 'Variável'), 0) as variavel
        ${base} and date_trunc('month', data) = date_trunc('month', current_date)`,
  );

  const [media] = await db.execute<{ fixa: string; variavel: string }>(
    sql`select
          coalesce(sum(valor_total) filter (where tipo = 'Fixa'), 0) / 12 as fixa,
          coalesce(sum(valor_total) filter (where tipo = 'Variável'), 0) / 12 as variavel
        ${base} and extract(year from data) = extract(year from current_date)`,
  );

  const evolucao = await db.execute<{ rotulo: string; pct: string }>(
    granularidade === 'mensal'
      ? sql`select to_char(data, 'MM/YY') as rotulo,
                   round(100.0 * coalesce(sum(valor_total) filter (where tipo = 'Fixa'), 0)
                         / nullif(sum(valor_total), 0), 1) as pct
            ${base}
            group by date_trunc('month', data), to_char(data, 'MM/YY')
            order by date_trunc('month', data) desc limit 12`
      : sql`select extract(year from data)::text as rotulo,
                   round(100.0 * coalesce(sum(valor_total) filter (where tipo = 'Fixa'), 0)
                         / nullif(sum(valor_total), 0), 1) as pct
            ${base}
            group by extract(year from data)
            order by extract(year from data) desc limit 8`,
  );

  const categorias = await db.execute<{
    categoria: string; total: string; irwin: string; maria: string;
  }>(
    sql`select categoria,
               sum(valor_total) as total,
               sum(parte_irwin) as irwin,
               sum(parte_maria) as maria
        ${base} and date_trunc('month', data) = date_trunc('month', current_date)
        group by categoria order by sum(valor_total) desc`,
  );

  const [ritmo] = await db.execute<{ anual: string; minimo: string; maximo: string }>(
    sql`with por_mes as (
          select date_trunc('month', data) as m, sum(valor_total) as t
          ${base} and data >= current_date - interval '12 months'
          group by 1
        )
        select coalesce(sum(t), 0) as anual,
               coalesce(min(t), 0) as minimo,
               coalesce(max(t), 0) as maximo
        from por_mes`,
  );

  return {
    mesAtual: { fixa: Number(mes?.fixa ?? 0), variavel: Number(mes?.variavel ?? 0) },
    mediaAno: { fixa: Number(media?.fixa ?? 0), variavel: Number(media?.variavel ?? 0) },
    evolucaoFixas: evolucao.reverse().map((e) => ({
      rotulo: e.rotulo,
      pct: Number(e.pct ?? 0),
    })),
    categorias: categorias.map((c) => ({
      categoria: c.categoria,
      total: Number(c.total),
      irwin: Number(c.irwin ?? 0),
      maria: Number(c.maria ?? 0),
    })),
    ofensores: categorias.map((c) => ({
      categoria: c.categoria,
      quem:
        Math.abs(Number(c.irwin) - Number(c.maria)) < 0.005
          ? 'Empate'
          : Number(c.irwin) > Number(c.maria)
            ? 'Irwin'
            : 'Maria',
    })),
    ritmoAnual: Number(ritmo?.anual ?? 0),
    ritmoMin: Number(ritmo?.minimo ?? 0),
    ritmoMax: Number(ritmo?.maximo ?? 0),
    patrimonio: await getPatrimonio(),
  };
}

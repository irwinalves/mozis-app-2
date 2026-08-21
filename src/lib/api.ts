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
import type { Pessoa } from './pessoas';
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
import {
  parsePorTipo,
  sugerirCategoria,
  type CategoriaKw,
} from './importacao';

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
 * A4 — todo lançamento precisa de pagador.
 *
 * Sem pagador a linha nasce com o desembolso vazio e fica FORA do acerto: o
 * gasto aparece no resultado mas não na dívida entre os dois, sem erro e sem
 * aviso. Havia 19 linhas assim no histórico, de 2020 a 2026, nenhuma percebida.
 *
 * A checagem mora aqui, no servidor, porque a tela é só UMA das portas —
 * importação em lote e gatilho de recorrência entram por outras.
 */
/**
 * A11 — quitação é tipo de registro, não categoria especial.
 *
 * O texto da categoria é interpretado AQUI e só aqui, na fronteira onde o dado
 * entra. Dali para dentro o que circula é o booleano `eh_quitacao`. No app
 * antigo essa string era casada em quatro lugares diferentes.
 */
export function ehQuitacaoDe(categoria: unknown): boolean {
  return String(categoria ?? '').trim().startsWith('9 ');
}

function exigirPagador(quemPagou: unknown): string {
  const q = String(quemPagou ?? '').trim();
  if (!q) {
    throw new Error('Escolha quem pagou — sem isso o lançamento fica fora do acerto de contas.');
  }
  return q;
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
  gasto_de: string | null;
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
    // C1: o que importa por linha é QUANTO ISSO MEXEU NO ACERTO, com sinal —
    // não a fatia de cada um. Duas transações de R$ 200 meio a meio parecem
    // idênticas quando se mostra "100 e 100", mesmo com efeito oposto no saldo.
    // Vai UM número só: o outro lado é o negativo exato, derivado no front.
    saldoIrwin: r.saldo_irwin === null ? null : Number(r.saldo_irwin),
    quemPagou: r.quem_pagou ?? '',
    recorrente: !!r.recorrente,
    gastoDe: r.gasto_de ?? '',
    // Derivado da descrição, não de coluna: quem numera as parcelas é
    // `montarParcelas`, sempre no formato " N/M" no fim. Não há coluna de
    // parcelamento e criar uma deixaria as 272 linhas do histórico de fora.
    parcelado: / \d+\/\d+$/.test(String(r.descricao || '')),
  };
}

// ---------------------------------------------------------------------------
// Opções
// ---------------------------------------------------------------------------

/**
 * `pessoa` chega de fora — a ROTA resolve a sessão e passa.
 *
 * Não é aqui que se chama `auth()`: este módulo também é importado por scripts
 * que rodam fora do Next (`verificar-e2e`, `sync`, `reconcile`), e puxar
 * NextAuth para dentro deles quebraria todos por causa de um campo.
 */
export async function getOpcoes(pessoa: Pessoa | null = null) {
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

    /**
     * Quem está olhando a tela — 'Irwin', 'Maria' ou null.
     *
     * A lista usa isto para mostrar só o lado de quem entrou no efeito de cada
     * lançamento sobre o acerto, e a tela de Lançar para já abrir marcada em
     * quem pagou. `null` quando a sessão não identifica a pessoa: aí a tela
     * volta ao formato antigo, com os dois lados.
     */
    eu: pessoa,
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
/**
 * A ordem da lista, em um lugar só.
 *
 * Data decrescente como sempre foi; o que mudou é o desempate DENTRO do mesmo
 * dia, que era a ordem de gravação e agora é alfabético.
 *
 * `collate "pt-BR-x-icu"` não é preciosismo: a collation padrão ordena por byte
 * e coloca "açaí" depois de "Aveia" e "Ávila" depois de "Bold". Medido contra o
 * banco antes de escolher. O `id` no fim mantém a ordem estável quando duas
 * linhas têm data e descrição iguais — sem ele a paginação pode repetir ou
 * pular um item entre uma página e outra.
 */
const ORDEM = sql`order by data desc, descricao collate "pt-BR-x-icu" asc, id desc`;

/** Os filtros da tela de Início. Todos opcionais; combinam entre si com AND. */
export interface FiltrosLista {
  /** Só recorrentes. */
  recorrente?: boolean;
  /** Só parceladas. */
  parcelado?: boolean;
  /** 'André' — ou 'casal' para o que NÃO tem dono. */
  gastoDe?: string;
  categoria?: string;
  quemPagou?: string;
}

function clausulasDe(f: FiltrosLista = {}) {
  const partes = [];
  if (f.recorrente) partes.push(sql`recorrente = true`);
  // O mesmo padrão " N/M" que `paraItem` usa — a regra de reconhecer parcela
  // vive nos dois lugares porque um é SQL e o outro é JS, mas é a MESMA regra:
  // se mudar aqui, muda lá.
  if (f.parcelado) partes.push(sql`descricao ~ ' [0-9]+/[0-9]+$'`);
  if (f.gastoDe === 'casal') partes.push(sql`gasto_de is null`);
  else if (f.gastoDe) partes.push(sql`gasto_de = ${f.gastoDe}`);
  if (f.categoria) partes.push(sql`categoria = ${f.categoria}`);
  if (f.quemPagou) partes.push(sql`quem_pagou = ${f.quemPagou}`);
  if (!partes.length) return sql`true`;
  return partes.reduce((a, b) => sql`${a} and ${b}`);
}

export async function ultimosLancamentos(
  qtd = 50,
  offset = 0,
  incluirFuturos = false,
  filtros: FiltrosLista = {},
) {
  const limite = sql`(date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date`;

  const [{ n }] = await db.execute<{ n: string }>(
    sql`select count(*) as n from v_lancamentos where data > ${limite}`,
  );
  const qtdFuturos = Number(n);

  const janela = incluirFuturos ? sql`true` : sql`data <= ${limite}`;
  const filtro = sql`${janela} and ${clausulasDe(filtros)}`;

  const linhas = await db.execute<LinhaView>(
    sql`select * from v_lancamentos where ${filtro}
        ${ORDEM}
        limit ${qtd + 1} offset ${offset}`,
  );

  // Com filtro ativo, "quantos e quanto somam" costuma ser a pergunta real por
  // trás do filtro — e não dá para responder pela página, que é parcial.
  const temFiltro = Object.keys(filtros).some((k) => filtros[k as keyof FiltrosLista]);
  let resumo = null;
  if (temFiltro) {
    const [r] = await db.execute<{ n: string; soma: string | null }>(
      sql`select count(*) as n, sum(valor_total) as soma from v_lancamentos where ${filtro}`,
    );
    resumo = { qtd: Number(r.n), soma: Number(r.soma ?? 0) };
  }

  const temMais = linhas.length > qtd;
  return { itens: linhas.slice(0, qtd).map(paraItem), temMais, qtdFuturos, resumo };
}

/**
 * Busca em todo o histórico, por descrição, data ou valor.
 *
 * O tipo de busca sai do FORMATO do que foi digitado, não de um seletor na
 * tela — quem procura já sabe o que está procurando, e escolher em qual campo
 * buscar é trabalho que o programa consegue fazer sozinho:
 *
 *   `20/08` ou `20/08/2026`  → data
 *   `320` ou `320,50`        → valor
 *   qualquer outra coisa     → descrição
 *
 * Teto de 60 resultados, como antes.
 */
export async function buscarLancamentos(termo: string, filtros: FiltrosLista = {}) {
  const t = String(termo || '').trim();
  if (!t && !Object.keys(filtros).length) return [];

  let alvo;
  const mData = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  const mValor = t.match(/^(\d+)(?:[.,](\d{1,2}))?$/);

  if (mData) {
    const dia = Number(mData[1]);
    const mes = Number(mData[2]);
    alvo = mData[3]
      ? sql`data = make_date(${Number(mData[3])}, ${mes}, ${dia})`
      : sql`extract(day from data) = ${dia} and extract(month from data) = ${mes}`;
  } else if (mValor) {
    // Com centavos, é exato: quem digita `320,50` quer aquele lançamento.
    // Sem centavos, casa a parte inteira — `320` acha 320,00 e 320,90, e não
    // arrasta 1.320,00 nem 3.200,00 junto. Buscar por substring do número traz
    // esse lixo e faz o resultado parecer aleatório.
    alvo = mValor[2]
      ? sql`valor_total = ${`${mValor[1]}.${mValor[2].padEnd(2, '0')}`}`
      : sql`trunc(valor_total) = ${Number(mValor[1])}`;
  } else if (t) {
    alvo = sql`descricao ilike ${'%' + t + '%'}`;
  } else {
    alvo = sql`true`;
  }

  const linhas = await db.execute<LinhaView>(
    sql`select * from v_lancamentos
         where ${alvo} and ${clausulasDe(filtros)}
         ${ORDEM} limit 60`,
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
    gastoDe: r.gasto_de ?? '',
  };
}

interface DadosLancamento {
  data: string;
  descricao: string;
  /**
   * A categoria. Chama-se `grupo` porque é ASSIM que o front manda — o nome
   * vem do mapa `COL.grupo` do backend Apps Script.
   *
   * Ler `categoria` aqui foi o bug de 20/08: a gravação recusava com
   * "Escolha a categoria" mesmo com a categoria escolhida na tela. Meus testes
   * usavam MEUS nomes de campo, então nunca poderiam pegar isso.
   *
   * Regra: o front é o contrato. Quem adapta é a API.
   */
  grupo: string;
  tipo: string;
  fonte?: string;
  valor: number | string;
  divisao: string;
  pctIrwinCustom?: number | string | null;
  quemPagou?: string | null;
  pagoIrwin?: number | string | null;
  obs?: string | null;
  /**
   * De quem é o custo. Vazio ou ausente = do casal.
   *
   * Não afeta divisão, pagador nem acerto: um gasto do André pago pelo Irwin e
   * dividido 50/50 continua dividido 50/50. A tag classifica, não redistribui.
   */
  gastoDe?: string | null;
  parcelado?: boolean;
  parcelas?: number | string;
  tipoValor?: 'total' | 'parcela';
  repetir?: boolean;
  freqRec?: string;
  fimRec?: string;
  semFimRec?: boolean;
}

export async function salvarLancamento(dados: DadosLancamento) {
  if (!dados.descricao) throw new Error('Informe a descrição.');
  if (!dados.grupo) throw new Error('Escolha a categoria.');
  if (!dados.tipo) throw new Error('Escolha o tipo.');
  const quemPagou = exigirPagador(dados.quemPagou);

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
               pct_irwin_custom, pct_irwin, eh_quitacao, quem_pagou, pago_irwin,
               obs, recorrente, gasto_de)
            values (${formatarData(o.data)}, ${o.descricao}, ${dados.grupo}, ${tipo},
                    ${dados.fonte ?? null}, ${o.valor}, ${dados.divisao},
                    ${pctCustomFracao}, ${pct}, ${ehQuitacaoDe(dados.grupo)},
                    ${quemPagou}, ${pagoIrwin},
                    ${dados.obs ?? null}, ${!!dados.repetir}, ${dados.gastoDe || null})
            returning id`,
      );
      ids.push(row.id);
    }
    return ids;
  });

  return { qtd: linhas.length, total: arred(total), linhas };
}

export async function atualizarLancamento(id: number, dados: DadosLancamento) {
  const quemPagouAtual = exigirPagador(dados.quemPagou);
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
          categoria = ${dados.grupo}, tipo = ${dados.tipo},
          fonte = ${dados.fonte ?? null}, valor_total = ${valor},
          divisao = ${dados.divisao}, pct_irwin_custom = ${pctCustomFracao},
          pct_irwin = ${pct}, eh_quitacao = ${ehQuitacaoDe(dados.grupo)},
          quem_pagou = ${quemPagouAtual}, pago_irwin = ${pagoIrwin},
          gasto_de = ${dados.gastoDe || null}
        where id = ${id}`,
  );
  return { ok: true };
}

export async function excluirLancamento(id: number) {
  // B2 — sem assinatura de conteúdo, de propósito.
  //
  // A assinatura existia no app antigo como contorno para um modelo SEM id: a
  // linha era identificada pela posição, que muda quando a planilha é
  // reordenada. Aqui `id` é chave primária estável — o problema não existe, e
  // portar o contorno seria copiar um remendo achando que é regra.
  const r = await db.execute(sql`delete from lancamentos where id = ${id} returning id`);
  if (!r.length) throw new Error('Lançamento não encontrado.');
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
  /** `quem`, não `deQuem` — mesmo motivo: é o nome que o front manda. */
  quem?: string;
  obs?: string;
}) {
  if (!dados.conta) throw new Error('Informe a instituição.');
  const valor = arred(Number(dados.valor));
  if (!(valor > 0)) throw new Error('Informe um valor maior que zero.');

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`insert into investimentos_contas (nome, classe, de_quem)
          values (${dados.conta}, ${dados.classe ?? null}, ${dados.quem ?? null})
          on conflict (nome) do nothing`,
    );
    await tx.execute(
      sql`insert into investimentos_movimentos (data, conta, tipo, valor, de_quem, obs)
          values (${dados.data}, ${dados.conta}, ${dados.movimento}, ${valor},
                  ${dados.quem ?? null}, ${dados.obs ?? null})`,
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
                     and not eh_quitacao
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

// ---------------------------------------------------------------------------
// Importação de extrato
// ---------------------------------------------------------------------------

/**
 * Categorias que entram na sugestão automática.
 * Filtra `8 ` (investimento tem tela própria) e `9 ` (acerto não é gasto).
 */
async function planoParaSugestao(): Promise<CategoriaKw[]> {
  const linhas = await db.execute<{ nome: string; palavras_chave: string | null }>(
    sql`select nome, palavras_chave from plano_de_contas
        where nome not like '8 %' and nome not like '9 %'
        order by ordem`,
  );
  return linhas.map((r) => ({
    nome: r.nome,
    keywords: String(r.palavras_chave ?? '')
      .toLowerCase()
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  }));
}

async function planoTipoPadrao(categoria: string): Promise<string> {
  const [r] = await db.execute<{ tipo_padrao: string | null }>(
    sql`select tipo_padrao from plano_de_contas where nome = ${categoria}`,
  );
  return r?.tipo_padrao ?? 'Variável';
}

/** Lista sugerida, sem gravar nada. */
export async function previewImportacao(conteudo: string, tipoArquivo: string) {
  const transacoes = parsePorTipo(conteudo, tipoArquivo);
  const plano = await planoParaSugestao();
  return transacoes.map((t) => ({
    data: t.data,
    descricao: t.descricao,
    valor: arred(t.valor),
    categoria: sugerirCategoria(t.descricao, plano),
  }));
}

/**
 * Grava o lote.
 *
 * Mapa de atribuição: Irwin → `100% Irwin`; Maria → `100% Maria`; Ambos → a
 * divisão escolhida na tela. Com 'Ambos' não há rateio por transação — cada um
 * entra com a própria parte, então a importação NÃO gera dívida entre os dois.
 */
export async function lancarImportacaoLote(
  transacoes: { data: string; descricao: string; valor: number; categoria: string }[],
  quemPagou: string,
  divisao?: string,
) {
  if (!transacoes || !transacoes.length) throw new Error('Nada para lançar.');
  exigirPagador(quemPagou);

  const divisaoFinal =
    quemPagou === 'Irwin' ? '100% Irwin'
    : quemPagou === 'Maria' ? '100% Maria'
    : divisao || 'Renda';

  const [conf] = await db.execute<{ pct_irwin_renda: string }>(
    sql`select pct_irwin_renda from config where id = 1`,
  );
  const pctI = pctIrwinDe(divisaoFinal, null, Number(conf?.pct_irwin_renda ?? 0.4947));

  // Uma consulta por categoria distinta, não uma por transação.
  const tipos = new Map<string, string>();
  for (const c of new Set(transacoes.map((t) => t.categoria))) {
    tipos.set(c, await planoTipoPadrao(c));
  }

  let total = 0;
  await db.transaction(async (tx) => {
    for (const t of transacoes) {
      const valor = arred(Number(t.valor));
      const parteIrwin = arred(valor * pctI);
      const pagoIrwin = pagoIrwinDe(quemPagou as never, valor, parteIrwin, null);
      await tx.execute(
        sql`insert into lancamentos
              (data, descricao, categoria, tipo, cat_original, fonte, valor_total,
               divisao, pct_irwin, eh_quitacao, quem_pagou, pago_irwin, recorrente)
            values (${t.data}, ${t.descricao}, ${t.categoria},
                    ${tipos.get(t.categoria) ?? 'Variável'}, 'Importação OFX/CSV',
                    'Extrato banco', ${valor}, ${divisaoFinal}, ${pctI},
                    ${ehQuitacaoDe(t.categoria)}, ${quemPagou},
                    ${pagoIrwin}, false)`,
      );
      total += valor;
    }
  });

  return { ok: true, qtd: transacoes.length, total: arred(total) };
}

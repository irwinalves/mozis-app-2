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
  normalizarFreq,
  ocorrenciaFreq,
  type DadosParcelas,
  type DadosRecorrencia,
} from './lancamentos';
import {
  parsePorTipo,
  sugerirCategoria,
  type CategoriaKw,
} from './importacao';
import { lerFaturaXlsx } from './faturaArquivo';
import {
  cruzar,
  type ParcelaExistente,
  type LancamentoExistente,
} from './cruzamento';

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
  serie_id: number | null;
  seq: number | null;
  importacao_id: number | null;
  importacao_linha: number | null;
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
    parcelado: / \(?\d[\d,+]*\/\d+\)?$/.test(String(r.descricao || '')),
    // Quando veio de um lote: a lista mostra o selo e o selo abre o lote.
    importacaoId: r.importacao_id ?? null,
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
  /** Só o que veio de um lote de importação. */
  importado?: boolean;
  /** Só as quitações do acerto. */
  quitacao?: boolean;
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
  // Dois formatos convivem na base: ` N/M`, que o app gera, e ` (N/M)`, de 11
  // linhas lançadas à mão antes disso. Reconhecer só o primeiro deixava a série
  // `Vacina RH- (1/4)` inteira fora do filtro.
  // `[(]` e não `\(`: dentro de uma template string a contrabarra é consumida
  // pelo JavaScript antes de chegar ao Postgres, e o padrão vira ` (?...)?$`,
  // que o Postgres recusa com "quantifier operand invalid". Classe de caractere
  // não tem esse problema — e o typecheck não pega, porque é só uma string.
  // `[0-9][0-9,+]*` cobre também as parcelas AGRUPADAS num lançamento só —
  // "Fotos parto 2+3/5" e "Japaratinga 3,4,5/6" são parceladas como as outras.
  if (f.parcelado) partes.push(sql`descricao ~ ' [(]?[0-9][0-9,+]*/[0-9]+[)]?$'`);
  if (f.importado) partes.push(sql`importacao_id is not null`);
  // A mesma regra do `ehQuitacaoDe`, do lado do SQL: categoria do grupo 9.
  if (f.quitacao) partes.push(sql`categoria ~ '^9 '`);
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
  const itens = linhas.slice(0, qtd).map(paraItem);

  /**
   * As importações que a lista deve mostrar como EVENTO.
   *
   * Um lote não é um lançamento e não pode virar um: seria uma linha a mais no
   * resultado do mês. Vem em separado e a lista o encaixa pela data — do mesmo
   * jeito que uma quitação aparece entre os gastos sem ser gasto.
   *
   * Aparece SEMPRE, mesmo com efeito zero no acerto: o app não serve só para o
   * acerto, serve para saber como andam os gastos, e uma fatura inteira que
   * entrou de uma vez é a informação mais volumosa do mês.
   */
  const eventos = await eventosDeImportacao(itens.length ? itens[itens.length - 1].data : null);

  return { itens, temMais, qtdFuturos, resumo, eventos };
}

async function eventosDeImportacao(dataMaisAntiga: string | null) {
  if (!dataMaisAntiga) return [];
  const linhas = await db.execute<{
    id: number; titulo: string; criada_em: string | Date; qtd: number;
    total: string; saldo: string | null;
  }>(sql`select i.id, i.titulo, i.criada_em, i.qtd, i.total,
                (select round(sum(l.saldo_irwin)::numeric, 2)::text
                   from v_lancamentos l where l.importacao_id = i.id) as saldo
         from importacoes i
         where i.criada_em::date >= ${dataMaisAntiga}
         order by i.criada_em desc limit 24`);
  return linhas.map((i) => ({
    id: i.id,
    data: isoDaLinha(i.criada_em),
    titulo: i.titulo,
    qtd: i.qtd,
    total: Number(i.total),
    efeitoNoAcerto: Number(i.saldo ?? 0),
  }));
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

  // A série a que este lançamento pertence, se houver. É o que permite a tela
  // de edição oferecer o caminho para a série inteira — sem isso a tela nova
  // existe numa URL que ninguém alcança.
  const [s] = r.serie_id
    ? await db.execute<{ id: number; tipo: string; total: number | null; lancamentos: number }>(
        sql`select id, tipo, total, lancamentos from v_series where id = ${r.serie_id}`,
      )
    : [undefined];

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
    serieId: s ? s.id : null,
    serieTipo: s ? s.tipo : null,
    serieTotal: s ? s.total : null,
    serieLancamentos: s ? s.lancamentos : 0,
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

    // A10 — recorrência indefinida é REGRA + geração incremental idempotente.
    //
    // Sem isto o lançamento nasce só com as ocorrências até o fim do mês
    // corrente e MORRE ali, sem erro e sem aviso, porque o cron não tem regra
    // para continuar. O app antigo gravava a regra (`Codigo.gs:328`,
    // `criarRegraRecorrente`) e a migração perdeu esse passo.
    //
    // Não é hipótese: em 22/08/2026 havia UM órfão na base, o `Financiamento`
    // de R$ 6.800,00/mês criado em 16/08 — o maior valor recorrente do casal,
    // com uma única ocorrência e nenhuma regra. Sumiria em setembro.
    //
    // Dentro da MESMA transação das ocorrências, de propósito: regra sem
    // ocorrência e ocorrência sem regra são os dois estados quebrados, e o
    // segundo é justamente o que se está corrigindo aqui.
    // Antes: só `semFimRec`. Uma recorrência COM data fim gerava as ocorrências
    // e não criava regra — então não havia onde guardar a vigência, a série
    // nascia órfã, e não dava para editar "até quando". Agora as duas criam
    // regra; o que muda é `data_fim`, que o cron respeita.
    if (dados.repetir) {
      await tx.execute(
        sql`insert into recorrencias
              (data_inicio, descricao, categoria, fonte, valor, divisao,
               pct_irwin_custom, quem_pagou, frequencia, data_fim, ultima_geracao,
               ativo, gasto_de)
            values (${dados.data}, ${dados.descricao}, ${dados.grupo},
                    ${dados.fonte ?? null},
                    -- cada ocorrência tem o valor CHEIO (A6/A9): o valor da
                    -- regra é o de uma ocorrência, não a soma delas
                    ${ocorrencias[0].valor}, ${dados.divisao},
                    ${pctCustomFracao}, ${quemPagou},
                    ${normalizarFreq(dados.freqRec)},
                    ${dados.semFimRec ? null : (dados.fimRec ?? null)},
                    ${formatarData(ocorrencias[ocorrencias.length - 1].data)},
                    true, ${dados.gastoDe || null})`,
      );
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

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------

interface LinhaSerie {
  id: number;
  seq: number | null;
  data: string | Date;
  descricao: string;
  categoria: string;
  tipo: string;
  fonte: string | null;
  valor_total: string;
  divisao: string;
  pct_irwin_custom: string | null;
  quem_pagou: string | null;
  pago_irwin: string | null;
  saldo_irwin: string | null;
  gasto_de: string | null;
}

/** O valor que mais se repete. É o que a tela mostra como “o valor da série”. */
function maisComum<T>(valores: T[]): T | null {
  const conta = new Map<T, number>();
  for (const v of valores) conta.set(v, (conta.get(v) ?? 0) + 1);
  let melhor: T | null = null;
  let max = 0;
  for (const [v, n] of conta) if (n > max) { max = n; melhor = v; }
  return melhor;
}

/**
 * Quais campos DIVERGEM dentro de um conjunto de linhas.
 *
 * Existe por C7: o cabeçalho mostra um valor por campo, e se o campo varia
 * entre as linhas ele precisa dizer isso em vez de escolher um e calar. Nas
 * duas séries reais que motivaram a tela — `Seguro Carro` e `Clube Livelo` —
 * três campos variam, porque as duas foram reclassificadas à mão, linha a
 * linha, indo para frente.
 */
const CAMPOS_CLASSIF = [
  ['categoria', 'Categoria'],
  ['tipo', 'Tipo'],
  ['fonte', 'Origem'],
  ['divisao', 'Como dividir'],
  ['quem_pagou', 'Quem paga'],
  ['valor_total', 'Valor'],
] as const;

function camposQueVariam(linhas: LinhaSerie[]) {
  return CAMPOS_CLASSIF.filter(([campo]) => {
    const vistos = new Set(linhas.map((l) => String(l[campo] ?? '')));
    return vistos.size > 1;
  }).map(([campo, rotulo]) => {
    const vistos = new Map<string, number>();
    for (const l of linhas) {
      const v = String(l[campo] ?? '');
      vistos.set(v, (vistos.get(v) ?? 0) + 1);
    }
    return {
      campo,
      rotulo,
      valores: [...vistos]
        .sort((a, b) => b[1] - a[1])
        .map(([valor, qtd]) => ({ valor, qtd })),
    };
  });
}

interface Regra {
  id: number;
  frequencia: string;
  data_inicio: string | Date;
  data_fim: string | Date | null;
  ultima_geracao: string | Date | null;
  ativo: boolean;
  valor: string;
}

/**
 * Uma série inteira: o resumo do cabeçalho, a regra quando houver, e as linhas.
 *
 * `pessoa` decide de que lado o efeito no acerto é mostrado (C1) e vem da
 * ROTA, nunca daqui — este módulo roda em scripts fora do Next.
 *
 * `ancora` é o lançamento de onde o usuário veio; a tela o marca, e é dele que
 * o escopo “esta e as seguintes” parte.
 */
export async function obterSerie(id: number, ancora?: number, pessoa: Pessoa | null = null) {
  const [s] = await db.execute<{
    id: number; tipo: string; descricao: string; total: number | null;
    recorrencia_id: number | null; origem: string; lancamentos: number;
    completa: boolean | null; primeira: string | Date | null; ultima: string | Date | null;
    futuras: number; total_valor: string | null; saldo_irwin: string | null;
  }>(sql`select * from v_series where id = ${id}`);
  if (!s) throw new Error('Série não encontrada.');

  const linhas = await db.execute<LinhaSerie & Record<string, unknown>>(
    sql`select id, seq, data, descricao, categoria, tipo, fonte, valor_total, divisao,
               pct_irwin_custom, quem_pagou, pago_irwin, saldo_irwin, gasto_de
        from v_lancamentos where serie_id = ${id}
        order by data, id`,
  );

  // O corte entre passado e futuro sai do POSTGRES, não do JavaScript — regra
  // nº 6. Comparar data em JS já escondeu 11 parcelas futuras fazendo os três
  // cortes do acerto darem idênticos, com a suíte inteira verde.
  const [{ hoje }] = await db.execute<{ hoje: string }>(sql`select current_date::text as hoje`);

  const [regra] = s.recorrencia_id
    ? await db.execute<Regra & Record<string, unknown>>(
        sql`select id, frequencia, data_inicio, data_fim, ultima_geracao, ativo, valor
            from recorrencias where id = ${s.recorrencia_id}`,
      )
    : [undefined];

  const itens = linhas.map((l, i) => ({
    id: l.id,
    seq: l.seq,
    total: s.total,
    // A posição de uma ocorrência de recorrência é a ordem cronológica: a
    // recorrência não tem total, então `36/36` viraria mentira no mês seguinte.
    posicao: s.tipo === 'recorrencia' ? i + 1 : l.seq,
    data: isoDaLinha(l.data),
    descricao: l.descricao,
    categoria: l.categoria,
    tipo: l.tipo,
    fonte: l.fonte,
    valor: Number(l.valor_total),
    divisao: l.divisao,
    pctCustom: l.pct_irwin_custom === null ? null : Number(l.pct_irwin_custom) * 100,
    quemPagou: l.quem_pagou,
    pagoIrwin: l.pago_irwin === null ? null : Number(l.pago_irwin),
    saldoIrwin: l.saldo_irwin === null ? null : Number(l.saldo_irwin),
    gastoDe: l.gasto_de,
    futura: isoDaLinha(l.data) > hoje,
  }));

  // A mais recente, que é o estado atual da série.
  const atual = linhas.length ? linhas[linhas.length - 1] : null;

  const proxima = regra
    ? formatarData(
        ocorrenciaFreq(
          dataLocal(isoDaLinha(regra.ultima_geracao ?? regra.data_inicio)),
          normalizarFreq(regra.frequencia),
          1,
        ),
      )
    : null;

  return {
    id: s.id,
    tipo: s.tipo,
    descricao: s.descricao,
    total: s.total,
    origem: s.origem,
    recorrenciaId: s.recorrencia_id,
    completa: !!s.completa,
    lancamentos: s.lancamentos,
    futuras: s.futuras,
    primeira: s.primeira ? isoDaLinha(s.primeira) : null,
    ultima: s.ultima ? isoDaLinha(s.ultima) : null,
    totalValor: Number(s.total_valor ?? 0),
    saldoIrwin: s.saldo_irwin === null ? null : Number(s.saldo_irwin),
    /**
     * O valor de UMA parcela — o mais COMUM, não o mais recente: a última
     * parcela absorve o arredondamento de propósito (A7), então ela é a que
     * tem mais chance de ser a diferente.
     */
    valorUnitario: linhas.length ? Number(maisComum(linhas.map((l) => l.valor_total))) : 0,
    /**
     * A classificação da linha MAIS RECENTE — a série como ela é hoje, não a
     * média do histórico. A diferença importa porque este é o valor que a tela
     * de edição pré-preenche: com o atual, abrir a edição não propõe mudança
     * nenhuma e o botão nasce apagado; com o mais comum, abrir já proporia
     * reverter a reclassificação mais nova.
     *
     * `variam` é o que impede isso de virar meia-verdade.
     */
    classificacao: atual
      ? {
          categoria: atual.categoria,
          tipo: atual.tipo,
          fonte: atual.fonte,
          divisao: atual.divisao,
          quemPagou: atual.quem_pagou,
        }
      : { categoria: '', tipo: '', fonte: null, divisao: '50/50', quemPagou: null },
    variam: camposQueVariam(linhas),
    regra: regra
      ? {
          id: regra.id,
          frequencia: regra.frequencia,
          ativo: regra.ativo,
          dataInicio: isoDaLinha(regra.data_inicio),
          dataFim: regra.data_fim ? isoDaLinha(regra.data_fim) : null,
          ultimaGeracao: regra.ultima_geracao ? isoDaLinha(regra.ultima_geracao) : null,
          proxima,
          valor: Number(regra.valor),
        }
      : null,
    hoje,
    eu: pessoa,
    ancora: ancora ?? null,
    itens,
  };
}

/**
 * A série a que um lançamento pertence — o caminho que a lista usa ao tocar
 * numa parcela. Devolve `null` para lançamento avulso, que é a maioria.
 */
export async function serieDoLancamento(idLancamento: number) {
  const [r] = await db.execute<{ serie_id: number | null }>(
    sql`select serie_id from lancamentos where id = ${idLancamento}`,
  );
  return r?.serie_id ?? null;
}

// ---------------------------------------------------------------------------
// Editar uma série
// ---------------------------------------------------------------------------

/**
 * Os quatro escopos, dois por porta de entrada.
 *
 * Pelo CABEÇALHO, quando não se veio de nenhuma linha:
 *   `daAtual`  — o que ainda não passou (e, na recorrência, a regra)
 *   `todas`    — tudo, inclusive o que já foi lançado
 *
 * Por uma LINHA:
 *   `soEsta`          — só ela
 *   `estaEseguintes`  — dela para frente, mesmo que ela já tenha passado
 *
 * A assimetria é deliberada e foi decidida em 23/08/2026: pelo cabeçalho o
 * passado exige escolher `todas`; por uma linha o passado entra junto quando é
 * dali que a mudança começa a valer — com o aviso dizendo quantas já lançadas.
 */
export type EscopoSerie = 'daAtual' | 'todas' | 'soEsta' | 'estaEseguintes';

export interface MudancasSerie {
  descricao?: string;
  grupo?: string;
  tipo?: string;
  fonte?: string | null;
  divisao?: string;
  pctIrwinCustom?: number | string | null;
  quemPagou?: string | null;
  gastoDe?: string | null;
  /** Valor de UMA parcela/ocorrência. */
  valor?: number | string;
  /**
   * Valor TOTAL do escopo. Exclusivo com `valor`: aqui a divisão entre as
   * linhas é recalculada e a ÚLTIMA absorve o arredondamento (A7).
   */
  valorTotal?: number | string;
  /** Só recorrência. `null` = indefinidamente. */
  dataFim?: string | null;
  ativo?: boolean;
}

/** As linhas que um escopo alcança, e se ele chega no que ainda será gerado. */
async function linhasDoEscopo(serieId: number, escopo: EscopoSerie, ancoraId?: number) {
  const [{ hoje }] = await db.execute<{ hoje: string }>(sql`select current_date::text as hoje`);

  const todas = await db.execute<LinhaSerie & Record<string, unknown>>(
    sql`select id, seq, data, descricao, categoria, tipo, fonte, valor_total, divisao,
               pct_irwin_custom, quem_pagou, pago_irwin, saldo_irwin, gasto_de
        from v_lancamentos where serie_id = ${serieId} order by data, id`,
  );

  const iso = (l: LinhaSerie) => isoDaLinha(l.data);
  let alvo: (LinhaSerie & Record<string, unknown>)[];

  if (escopo === 'todas') {
    alvo = todas;
  } else if (escopo === 'daAtual') {
    alvo = todas.filter((l) => iso(l) > hoje);
  } else {
    const ancora = todas.find((l) => l.id === ancoraId);
    if (!ancora) throw new Error('A parcela de onde a edição partiu não está nesta série.');
    alvo =
      escopo === 'soEsta'
        ? todas.filter((l) => l.id === ancoraId)
        : todas.filter((l) => iso(l) >= iso(ancora));
  }

  return {
    hoje,
    alvo,
    jaLancadas: alvo.filter((l) => iso(l) <= hoje).length,
    // Só `soEsta` não alcança o futuro. Nos outros a regra tem que mudar
    // junto, senão a próxima ocorrência nasce com o valor velho.
    alcancaFuturo: escopo !== 'soEsta',
  };
}

/** Aplica as mudanças a uma linha e devolve os campos finais. */
function aplicarMudancas(
  l: LinhaSerie,
  m: MudancasSerie,
  valorDaLinha: number,
  pctRenda: number,
) {
  const divisao = m.divisao ?? l.divisao;
  const pctCustomPct =
    m.pctIrwinCustom !== undefined
      ? Number(m.pctIrwinCustom)
      : l.pct_irwin_custom === null
        ? null
        : Number(l.pct_irwin_custom) * 100;
  const pct = pctIrwinDe(divisao, pctCustomPct, pctRenda);
  const quemPagou = exigirPagador(m.quemPagou ?? l.quem_pagou);
  const parteIrwin = arred(valorDaLinha * pct);

  // O desembolso é recalculado por `pagoIrwinDe`, nunca por um mapa próprio —
  // regra nº 3. Um ternário paralelo aqui foi exatamente o defeito que fazia o
  // cron gravar NULL para 'Ambos' e tirar a linha do acerto em silêncio.
  const pagoIrwin = pagoIrwinDe(quemPagou as never, valorDaLinha, parteIrwin, null);

  return {
    data: isoDaLinha(l.data),
    descricao: m.descricao ? trocarRaiz(l.descricao, m.descricao) : l.descricao,
    categoria: m.grupo ?? l.categoria,
    tipo: m.tipo ?? l.tipo,
    fonte: m.fonte !== undefined ? m.fonte : l.fonte,
    valor: valorDaLinha,
    divisao,
    pctCustomFracao: divisao === 'Custom' ? (pctCustomPct ?? 0) / 100 : null,
    pct,
    quemPagou,
    pagoIrwin,
    gastoDe: m.gastoDe !== undefined ? m.gastoDe || null : l.gasto_de,
    saldoIrwin: (pagoIrwin ?? 0) - valorDaLinha * pct,
  };
}

/** Troca a raiz preservando o sufixo `N/M` e o que vier depois dele. */
function trocarRaiz(descricao: string, novaRaiz: string): string {
  const m = /^(.*?)(\s[(]?\d[\d,+]*\/\d+[)]?(?:\s|$).*)$/.exec(descricao);
  return m ? novaRaiz + m[2] : novaRaiz;
}

/**
 * Como o valor se distribui pelas linhas do escopo.
 *
 * Com `valorTotal`, a ÚLTIMA linha absorve o arredondamento — a mesma regra de
 * quando o parcelamento é criado (A7), e por isso ela não é reescrita aqui:
 * quem divide 100,00 em 3 tem 33,33 · 33,33 · 33,34, nunca três de 33,33 e um
 * centavo perdido.
 */
function valoresPorLinha(qtd: number, m: MudancasSerie, atuais: number[]): number[] {
  if (m.valorTotal !== undefined && m.valorTotal !== null && m.valorTotal !== '') {
    const total = arred(Number(m.valorTotal));
    const base = arred(total / qtd);
    const v = Array(qtd).fill(base);
    v[qtd - 1] = arred(total - base * (qtd - 1));
    return v;
  }
  if (m.valor !== undefined && m.valor !== null && m.valor !== '') {
    return Array(qtd).fill(arred(Number(m.valor)));
  }
  return atuais;
}

async function pctDaRenda() {
  const [conf] = await db.execute<{ pct_irwin_renda: string }>(
    sql`select pct_irwin_renda from config where id = 1`,
  );
  return Number(conf?.pct_irwin_renda ?? 0.4947);
}

/**
 * O que a gravação vai fazer, sem fazer.
 *
 * Devolve linha a linha o antes e o depois, e o **delta no acerto** — que é o
 * número que separa esta tela de uma armadilha: mexer em divisão ou pagador de
 * 10 parcelas move dinheiro entre os dois, e ver quanto antes de confirmar é a
 * diferença entre editar e descobrir depois.
 */
export async function previewEdicaoSerie(
  serieId: number,
  escopo: EscopoSerie,
  ancoraId: number | null,
  mudancas: MudancasSerie,
) {
  const { alvo, jaLancadas, alcancaFuturo, hoje } = await linhasDoEscopo(
    serieId,
    escopo,
    ancoraId ?? undefined,
  );
  if (!alvo.length) return { qtd: 0, jaLancadas: 0, linhas: [], deltaAcerto: 0, mudaRegra: false, hoje };

  const pctRenda = await pctDaRenda();
  const valores = valoresPorLinha(
    alvo.length,
    mudancas,
    alvo.map((l) => Number(l.valor_total)),
  );

  const linhas = alvo.map((l, i) => {
    const depois = aplicarMudancas(l, mudancas, valores[i], pctRenda);
    const antes = {
      data: isoDaLinha(l.data),
      descricao: l.descricao,
      categoria: l.categoria,
      tipo: l.tipo,
      fonte: l.fonte,
      valor: Number(l.valor_total),
      divisao: l.divisao,
      quemPagou: l.quem_pagou,
      gastoDe: l.gasto_de,
      saldoIrwin: l.saldo_irwin === null ? null : Number(l.saldo_irwin),
    };
    return {
      id: l.id,
      antes,
      depois,
      mudou:
        antes.descricao !== depois.descricao ||
        antes.categoria !== depois.categoria ||
        antes.tipo !== depois.tipo ||
        (antes.fonte ?? '') !== (depois.fonte ?? '') ||
        Math.abs(antes.valor - depois.valor) >= 0.005 ||
        antes.divisao !== depois.divisao ||
        (antes.quemPagou ?? '') !== (depois.quemPagou ?? '') ||
        (antes.gastoDe ?? '') !== (depois.gastoDe ?? ''),
    };
  });

  // O delta é calculado NO POSTGRES, não aqui.
  //
  // Somar em JavaScript e arredondar no fim erra por um centavo, e não por
  // descuido: o delta real desta edição é R$ 15,345, e `Math.round(15.345*100)`
  // devolve 1534 porque o float mais próximo de 15,345 é 15,34499999999998. A
  // gravação, feita em `numeric` exato, move o acerto em R$ 15,35 — e a prévia
  // prometia 15,34.
  //
  // Um centavo é pouco; uma prévia que não bate com o que acontece é o
  // problema. `saldo_irwin` chega da view como texto e é aqui que ele deve
  // continuar exato.
  // Via JSON, e não array: interpolar um array de JS no `sql` do Drizzle vira
  // uma TUPLA — `($1, $2, $3)` — e o Postgres recusa com "cannot cast type
  // record to integer[]".
  const pares = JSON.stringify(
    linhas.map((l) => ({ id: l.id, novo: String(l.depois.saldoIrwin) })),
  );
  const [{ delta }] = await db.execute<{ delta: string }>(
    sql`select coalesce(round(sum(n.novo - l.saldo_irwin)::numeric, 2), 0)::text as delta
        from jsonb_to_recordset(${pares}::jsonb) as n(id int, novo numeric)
        join v_lancamentos l on l.id = n.id`,
  );
  const deltaAcerto = Number(delta);

  const [s] = await db.execute<{ recorrencia_id: number | null }>(
    sql`select recorrencia_id from series where id = ${serieId}`,
  );

  return {
    qtd: linhas.length,
    jaLancadas,
    linhas,
    deltaAcerto,
    /** A regra só muda quando o escopo alcança o que ainda vai ser gerado. */
    mudaRegra: alcancaFuturo && !!s?.recorrencia_id,
    hoje,
  };
}

/**
 * Grava. Uma transação só: ou tudo, ou nada.
 *
 * A regra da recorrência é atualizada JUNTO quando o escopo alcança o futuro.
 * Deixá-la para trás recria o defeito silencioso — a próxima ocorrência nasce
 * com o valor velho e ninguém vê.
 */
export async function atualizarSerie(
  serieId: number,
  escopo: EscopoSerie,
  ancoraId: number | null,
  mudancas: MudancasSerie,
) {
  const { alvo, alcancaFuturo } = await linhasDoEscopo(serieId, escopo, ancoraId ?? undefined);
  if (!alvo.length) throw new Error('Nenhuma linha no escopo escolhido.');

  const pctRenda = await pctDaRenda();
  const valores = valoresPorLinha(
    alvo.length,
    mudancas,
    alvo.map((l) => Number(l.valor_total)),
  );

  const [s] = await db.execute<{ recorrencia_id: number | null; descricao: string }>(
    sql`select recorrencia_id, descricao from series where id = ${serieId}`,
  );

  await db.transaction(async (tx) => {
    for (let i = 0; i < alvo.length; i++) {
      const d = aplicarMudancas(alvo[i], mudancas, valores[i], pctRenda);
      await tx.execute(
        sql`update lancamentos set
              descricao = ${d.descricao}, categoria = ${d.categoria}, tipo = ${d.tipo},
              fonte = ${d.fonte}, valor_total = ${d.valor}, divisao = ${d.divisao},
              pct_irwin_custom = ${d.pctCustomFracao}, pct_irwin = ${d.pct},
              eh_quitacao = ${ehQuitacaoDe(d.categoria)},
              quem_pagou = ${d.quemPagou}, pago_irwin = ${d.pagoIrwin},
              gasto_de = ${d.gastoDe}
            where id = ${alvo[i].id}`,
      );
    }

    if (mudancas.descricao) {
      await tx.execute(
        sql`update series set descricao = ${mudancas.descricao} where id = ${serieId}`,
      );
    }

    if (alcancaFuturo && s?.recorrencia_id) {
      const pctCustomFracao =
        mudancas.divisao === 'Custom'
          ? (Number(mudancas.pctIrwinCustom) || 0) / 100
          : mudancas.divisao
            ? null
            : undefined;
      await tx.execute(
        sql`update recorrencias set
              ${mudancas.descricao ? sql`descricao = ${mudancas.descricao},` : sql``}
              ${mudancas.grupo ? sql`categoria = ${mudancas.grupo},` : sql``}
              ${mudancas.fonte !== undefined ? sql`fonte = ${mudancas.fonte},` : sql``}
              ${mudancas.valor !== undefined ? sql`valor = ${arred(Number(mudancas.valor))},` : sql``}
              ${mudancas.divisao ? sql`divisao = ${mudancas.divisao},` : sql``}
              ${pctCustomFracao !== undefined ? sql`pct_irwin_custom = ${pctCustomFracao},` : sql``}
              ${mudancas.quemPagou ? sql`quem_pagou = ${mudancas.quemPagou},` : sql``}
              ${mudancas.gastoDe !== undefined ? sql`gasto_de = ${mudancas.gastoDe || null},` : sql``}
              ${mudancas.dataFim !== undefined ? sql`data_fim = ${mudancas.dataFim},` : sql``}
              ${mudancas.ativo !== undefined ? sql`ativo = ${mudancas.ativo},` : sql``}
              id = id
            where id = ${s.recorrencia_id}`,
      );
    }
  });

  return { ok: true, qtd: alvo.length, mudouRegra: alcancaFuturo && !!s?.recorrencia_id };
}

// ---------------------------------------------------------------------------
// Importação de fatura
// ---------------------------------------------------------------------------

/**
 * Lê a fatura e cruza com o que já existe. NÃO grava nada.
 *
 * O arquivo chega em base64 porque a rota de RPC fala JSON — e a fatura real
 * tem 15 KB, então não vale inventar um segundo transporte para ela.
 */
export async function analisarFatura(arquivoB64: string, nomeArquivo: string) {
  const buffer = Buffer.from(arquivoB64, 'base64');
  const r = await lerFaturaXlsx(buffer);
  if (!r.linhas.length) {
    throw new Error('Nenhum lançamento reconhecido. Confira se o arquivo é a fatura do cartão.');
  }

  const primeira = r.linhas.map((l) => l.data).sort()[0];

  // Os candidatos do cruzamento. `parcelas` é a chave forte — posição na série;
  // `avulsos` é a fraca — valor e data próxima.
  const parcelas = await db.execute<ParcelaExistente & Record<string, unknown>>(
    sql`select l.id as "lancamentoId", s.id as "serieId", s.descricao as "serieDescricao",
               l.seq, s.total, l.data::text as data, l.valor_total::float as valor
        from lancamentos l join series s on s.id = l.serie_id
        where s.tipo = 'parcelamento' and s.total is not null and l.seq is not null`,
  );
  const avulsos = await db.execute<LancamentoExistente & Record<string, unknown>>(
    sql`select id, data::text as data, descricao, valor_total::float as valor
        from lancamentos where data >= ${primeira}`,
  );

  const classificadas = cruzar(r.linhas, parcelas, avulsos);

  // O lado do APP para as que casaram: é o que a tela de conciliação mostra
  // ao lado do lado da fatura, e é onde aparecem as divergências de valor.
  const ids = classificadas
    .map((c) => ('lancamentoId' in c.situacao ? c.situacao.lancamentoId : null))
    .filter((x): x is number => x !== null);
  const doApp = new Map<number, Record<string, unknown>>();
  if (ids.length) {
    const linhas = await db.execute<{ id: number } & Record<string, unknown>>(
      sql`select id, data::text as data, descricao, categoria, tipo, fonte,
                 valor_total::float as valor, divisao, quem_pagou as "quemPagou",
                 gasto_de as "gastoDe", serie_id as "serieId"
          from lancamentos where id in ${sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`}`,
    );
    for (const l of linhas) doApp.set(l.id, l);
  }

  const plano = await planoParaSugestao();

  return {
    arquivo: nomeArquivo,
    total: r.total,
    descartadas: r.descartadas,
    linhas: classificadas.map((c, i) => {
      const idApp = 'lancamentoId' in c.situacao ? c.situacao.lancamentoId : null;
      const app = idApp !== null ? (doApp.get(idApp) ?? null) : null;
      return {
        // Índice estável para a tela referenciar a linha sem precisar de id —
        // ela ainda não existe no banco.
        i,
        ...c.linha,
        situacao: c.situacao,
        app,
        /**
         * A categoria sugerida. Quando a linha CASOU, herda a de quem casou —
         * muito melhor que adivinhar por um texto como
         * `Ifd*dpc Culinaria Japonesbelo`. Sem casamento, cai na sugestão por
         * palavra-chave, que erra bastante e por isso a tela deixa editar.
         */
        categoriaSugerida:
          (app?.categoria as string | undefined) ?? sugerirCategoria(c.linha.descricao, plano),
        /** Divergência de valor com o que está no app, quando houver. */
        difValor: app ? arred(c.linha.valor - Number(app.valor)) : null,
      };
    }),
  };
}

export interface LinhaParaLancar {
  data: string;
  descricao: string;
  valor: number;
  grupo: string;
  tipo?: string;
  quemPagou: string;
  divisao: string;
  pctIrwinCustom?: number | null;
  gastoDe?: string | null;
  /** Quando vem de `Parcela 1 de N`: cria a série inteira, não uma linha. */
  parcelas?: number | null;
  /**
   * Qual linha da fatura é esta. É o elo que permite corrigir um lote em bloco
   * sem apagá-lo inteiro: com ele a gravação sabe exatamente quais lançamentos
   * substituir e quais deixar em paz.
   */
  ref?: number | null;
}

/**
 * O `tx` que `db.transaction` entrega. Derivado do próprio tipo do driver, em
 * vez de escrito à mão: assim ele não pode divergir da biblioteca.
 */
type Transacao = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * O corpo da gravação de um lote, sem a transação e sem a linha de
 * `importacoes`.
 *
 * Existe para `lancarFatura` e `regravarImportacao` gravarem pelo MESMO
 * caminho. Duas cópias divergiriam no primeiro ajuste — e a que fica para trás
 * é sempre a que grava dinheiro errado sem ninguém ver.
 */
async function gravarLote(
  tx: Transacao,
  impId: number,
  linhas: LinhaParaLancar[],
  pctRenda: number,
) {
  let qtd = 0;
  let total = 0;
  const paraGravar: Record<string, string | number | boolean | null>[] = [];

  for (const l of linhas) {
    const pct = pctIrwinDe(l.divisao, l.pctIrwinCustom ?? null, pctRenda);
    const pctCustomFracao =
      l.divisao === 'Custom' ? (Number(l.pctIrwinCustom) || 0) / 100 : null;
    const tipoFinal = l.tipo || (await planoTipoPadrao(l.grupo));

    // Parcelada: a série inteira. `montarParcelas` é reaproveitada, não
    // reescrita — é ela que faz a última absorver o arredondamento (A7).
    const ocorrencias =
      l.parcelas && l.parcelas > 1
        ? montarParcelas({
            data: l.data,
            descricao: l.descricao,
            valor: arred(l.valor * l.parcelas),
            parcelado: true,
            parcelas: l.parcelas,
            tipoValor: 'total',
          } as DadosParcelas)
        : [{ data: dataLocal(l.data), descricao: l.descricao, valor: arred(l.valor) }];

    let serieId: number | null = null;
    if (ocorrencias.length > 1) {
      const [s] = await tx.execute<{ id: number }>(
        sql`insert into series (tipo, descricao, total, origem)
            values ('parcelamento', ${l.descricao}, ${ocorrencias.length}, 'fatura')
            returning id`,
      );
      serieId = s.id;
    }

    for (let k = 0; k < ocorrencias.length; k++) {
      const o = ocorrencias[k];
      const parteIrwin = arred(o.valor * pct);
      const pagoIrwin = pagoIrwinDe(l.quemPagou as never, o.valor, parteIrwin, null);
      // Os números vão como TEXTO e o Postgres os lê como `numeric`. Passar
      // `float` aqui reintroduziria a regra nº 4 pela porta dos fundos: o
      // JSON de um `number` é decimal binário, e 15,345 não existe nele.
      paraGravar.push({
        data: formatarData(o.data),
        descricao: o.descricao,
        categoria: l.grupo,
        tipo: tipoFinal,
        valor: String(o.valor),
        divisao: l.divisao,
        pct_custom: pctCustomFracao === null ? null : String(pctCustomFracao),
        pct: String(pct),
        eh_quitacao: ehQuitacaoDe(l.grupo),
        quem_pagou: l.quemPagou,
        pago_irwin: pagoIrwin === null ? null : String(pagoIrwin),
        gasto_de: l.gastoDe || null,
        serie_id: serieId,
        seq: serieId ? k + 1 : null,
        ref: l.ref ?? null,
      });
      qtd++;
      total += o.valor;
    }
  }

  /**
   * Uma inserção só, não 154.
   *
   * Medido em 26/08/2026: o laço linha a linha levava 10,7 s para a fatura de
   * agosto — 70 ms de ida e volta vezes 154. Cabe no limite da função hoje,
   * mas é o tipo de custo que cresce com o tamanho da fatura e falha no dia
   * em que ela for maior. `jsonb_to_recordset` faz o banco receber o lote
   * inteiro de uma vez; a regra de montagem das parcelas (A7, A8) continua
   * exatamente onde estava, em `montarParcelas`.
   */
  if (paraGravar.length) {
    await tx.execute(
      sql`insert into lancamentos
            (data, descricao, categoria, tipo, cat_original, fonte, valor_total,
             divisao, pct_irwin_custom, pct_irwin, eh_quitacao, quem_pagou,
             pago_irwin, recorrente, gasto_de, serie_id, seq, importacao_id,
             importacao_linha)
          select r.data::date, r.descricao, r.categoria, r.tipo,
                 'Fatura do cartão', 'Cartão', r.valor::numeric, r.divisao,
                 r.pct_custom::numeric, r.pct::numeric, r.eh_quitacao,
                 r.quem_pagou, r.pago_irwin::numeric, false, r.gasto_de,
                 r.serie_id, r.seq, ${impId}, r.ref
          from jsonb_to_recordset(${JSON.stringify(paraGravar)}::jsonb) as r(
            data text, descricao text, categoria text, tipo text, valor text,
            divisao text, pct_custom text, pct text, eh_quitacao boolean,
            quem_pagou text, pago_irwin text, gasto_de text,
            serie_id int, seq int, ref int)`,
    );
  }

  return { qtd, total: arred(total) };
}

/**
 * Tira do banco tudo que um lote criou: os lançamentos e as séries que
 * ficaram vazias. Compartilhado pelo desfazer e pela regravação.
 */
async function apagarLoteDe(tx: Transacao, id: number) {
  const series = await tx.execute<{ serie_id: number }>(
    sql`select distinct serie_id from lancamentos
        where importacao_id = ${id} and serie_id is not null`,
  );
  await tx.execute(sql`delete from lancamentos where importacao_id = ${id}`);
  for (const s of series) {
    // Só apaga a série se ela ficou vazia: uma parcela lançada à mão pode ter
    // sido ligada à mesma série depois.
    await tx.execute(
      sql`delete from series where id = ${s.serie_id}
          and not exists (select 1 from lancamentos where serie_id = ${s.serie_id})`,
    );
  }
}

/**
 * Grava o lote. Uma transação só.
 *
 * Uma linha marcada como `Parcela 1 de N` vira N lançamentos, um por mês, com
 * `serie_id` — e não uma linha na data da compra. É o que faz a fatura do mês
 * seguinte reconhecer a parcela 2 em vez de duplicar.
 */
export async function lancarFatura(
  linhas: LinhaParaLancar[],
  meta: {
    titulo: string;
    arquivo?: string;
    criadaPor?: string | null;
    /** As decisões da revisão, para o lote poder ser reaberto e ajustado. */
    estado?: unknown;
  },
) {
  if (!linhas.length) throw new Error('Nada marcado para lançar.');
  for (const l of linhas) exigirPagador(l.quemPagou);

  const pctRenda = await pctDaRenda();

  return db.transaction(async (tx) => {
    const [imp] = await tx.execute<{ id: number }>(
      sql`insert into importacoes (tipo, titulo, arquivo, criada_por, qtd, total, estado)
          values ('fatura', ${meta.titulo}, ${meta.arquivo ?? null},
                  ${meta.criadaPor ?? null}, 0, 0,
                  ${meta.estado === undefined ? null : JSON.stringify(meta.estado)}::jsonb)
          returning id`,
    );

    const r = await gravarLote(tx, imp.id, linhas, pctRenda);

    await tx.execute(
      sql`update importacoes set qtd = ${r.qtd}, total = ${r.total} where id = ${imp.id}`,
    );
    return { importacaoId: imp.id, ...r };
  });
}

/** Um lote, com o que ele criou — a tela do evento e o desfazer. */
export async function obterImportacao(id: number, pessoa: Pessoa | null = null) {
  const [imp] = await db.execute<{
    id: number; tipo: string; titulo: string; arquivo: string | null;
    criada_em: string | Date; criada_por: string | null; qtd: number; total: string;
    estado: unknown;
  }>(sql`select * from importacoes where id = ${id}`);
  if (!imp) throw new Error('Importação não encontrada.');

  const linhas = await db.execute<LinhaView & Record<string, unknown>>(
    sql`select * from v_lancamentos where importacao_id = ${id} order by data desc, id desc`,
  );
  const [ef] = await db.execute<{ saldo: string }>(
    sql`select coalesce(round(sum(saldo_irwin)::numeric, 2), 0)::text as saldo
        from v_lancamentos where importacao_id = ${id}`,
  );
  const [{ n: series }] = await db.execute<{ n: string }>(
    sql`select count(distinct serie_id)::text as n from lancamentos
        where importacao_id = ${id} and serie_id is not null`,
  );

  return {
    id: imp.id,
    tipo: imp.tipo,
    titulo: imp.titulo,
    arquivo: imp.arquivo,
    criadaEm: isoDaLinha(imp.criada_em),
    criadaPor: imp.criada_por,
    qtd: imp.qtd,
    total: Number(imp.total),
    series: Number(series),
    efeitoNoAcerto: Number(ef?.saldo ?? 0),
    // Só um lote que guardou as decisões da revisão pode ser reaberto. Os
    // anteriores à coluna `estado` só têm o desfazer.
    podeEditar: imp.estado != null,
    eu: pessoa,
    itens: linhas.map(paraItem),
  };
}

/** As importações, da mais recente para trás. */
export async function listarImportacoes(limite = 12) {
  const linhas = await db.execute<{
    id: number; titulo: string; criada_em: string | Date; qtd: number; total: string;
  }>(sql`select id, titulo, criada_em, qtd, total from importacoes
         order by criada_em desc limit ${limite}`);
  return linhas.map((i) => ({
    id: i.id,
    titulo: i.titulo,
    criadaEm: isoDaLinha(i.criada_em),
    qtd: i.qtd,
    total: Number(i.total),
  }));
}

/**
 * Desfaz o lote inteiro: apaga tudo que ele criou e o próprio registro.
 *
 * Diferente do ajuste, que mexe só nas linhas alteradas. Aqui a intenção é
 * "essa importação não devia ter acontecido".
 */
export async function desfazerImportacao(id: number) {
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.execute<{ n: string }>(
      sql`select count(*)::text as n from lancamentos where importacao_id = ${id}`,
    );
    await apagarLoteDe(tx, id);
    await tx.execute(sql`delete from importacoes where id = ${id}`);
    return { ok: true, apagados: Number(n) };
  });
}

/**
 * O que a tela de edição de um lote precisa para abrir.
 *
 * Vêm DUAS coisas, e a diferença entre elas é o ponto:
 *
 * - `estado` são as DECISÕES do dia da importação, inclusive sobre as linhas
 *   que ficaram de fora. É a única fonte para elas: o lote não guarda o que
 *   não entrou.
 * - `atual` é o que os lançamentos SÃO agora, lidos do banco. É o que preserva
 *   o trabalho feito à mão depois da importação — se alguém renomeou ou
 *   recategorizou uma linha na tela normal, é isso que a edição em lote tem
 *   que mostrar, não o que a fatura dizia em agosto.
 *
 * Uma linha marcada no `estado` mas ausente do `atual` foi apagada à mão. A
 * tela mostra como desmarcada, que é a verdade do banco.
 */
export async function estadoDaImportacao(id: number) {
  const [r] = await db.execute<{ estado: unknown; titulo: string; arquivo: string | null }>(
    sql`select estado, titulo, arquivo from importacoes where id = ${id}`,
  );
  if (!r) throw new Error('Importação não encontrada.');
  if (r.estado == null) {
    throw new Error(
      'Esta importação foi feita antes da edição existir e não guardou as decisões da revisão. ' +
        'Dá para desfazer e importar de novo.',
    );
  }

  /**
   * `order by seq nulls first` e o `[1]`: numa série, a PRIMEIRA parcela é a
   * que carrega o valor unitário limpo — a última absorve o arredondamento
   * (A7) e não serve de referência.
   */
  const linhas = await db.execute<{
    ref: number; n: number; descricao: string; categoria: string; tipo: string;
    divisao: string; quem_pagou: string | null; valor: string; total: string;
  }>(sql`select importacao_linha as ref, count(*)::int as n,
                (array_agg(descricao   order by seq nulls first, data, id))[1] as descricao,
                (array_agg(categoria   order by seq nulls first, data, id))[1] as categoria,
                (array_agg(tipo        order by seq nulls first, data, id))[1] as tipo,
                (array_agg(divisao     order by seq nulls first, data, id))[1] as divisao,
                (array_agg(quem_pagou  order by seq nulls first, data, id))[1] as quem_pagou,
                (array_agg(valor_total order by seq nulls first, data, id))[1]::text as valor,
                round(sum(valor_total)::numeric, 2)::text as total
         from v_lancamentos
         where importacao_id = ${id} and importacao_linha is not null
         group by importacao_linha`);

  const atual: Record<number, {
    parcelas: number; descricao: string; categoria: string; tipo: string;
    divisao: string; quemPagou: string | null; valor: number; total: number;
  }> = {};
  for (const l of linhas) {
    atual[l.ref] = {
      parcelas: l.n,
      // O sufixo ` N/M` é gerado por `montarParcelas`; o nome da série é o que
      // sobra. Sem tirar, reabrir e regravar somaria um sufixo a cada vez.
      descricao: l.n > 1 ? String(l.descricao).replace(/ \(?\d[\d,+]*\/\d+\)?$/, '') : l.descricao,
      categoria: l.categoria,
      tipo: l.tipo,
      divisao: l.divisao,
      quemPagou: l.quem_pagou,
      valor: Number(l.valor),
      total: Number(l.total),
    };
  }

  return { estado: r.estado, titulo: r.titulo, arquivo: r.arquivo, atual };
}

/**
 * Corrige um lote em bloco, mexendo SÓ no que mudou.
 *
 * A tela manda as linhas da fatura que foram alteradas — `linhas` para as que
 * devem existir com estes valores, `apagar` para as que a pessoa desmarcou. O
 * que não vem em nenhuma das duas listas não é tocado, e é essa a garantia que
 * importa: uma edição feita à mão depois da importação sobrevive à correção em
 * lote de outras linhas.
 *
 * Dentro de uma linha alterada a substituição é total — uma parcelada de 5x é
 * remontada por `montarParcelas`, porque mudar o valor ou o número de parcelas
 * muda todas as datas. Isso só acontece na linha que a pessoa mexeu.
 */
export async function ajustarImportacao(
  id: number,
  mudancas: { linhas: LinhaParaLancar[]; apagar: number[] },
  meta: { estado?: unknown } = {},
) {
  for (const l of mudancas.linhas) exigirPagador(l.quemPagou);

  const [existe] = await db.execute<{ id: number }>(
    sql`select id from importacoes where id = ${id}`,
  );
  if (!existe) throw new Error('Importação não encontrada.');

  const pctRenda = await pctDaRenda();
  const refs = [
    ...new Set([...mudancas.apagar, ...mudancas.linhas.map((l) => Number(l.ref))]),
  ].filter((r) => Number.isInteger(r));

  return db.transaction(async (tx) => {
    if (refs.length) await apagarLinhasDe(tx, id, refs);
    if (mudancas.linhas.length) await gravarLote(tx, id, mudancas.linhas, pctRenda);

    // `qtd` e `total` são do lote inteiro, não do que passou por aqui: eles
    // descrevem o que existe agora, e o resto do lote continuou existindo.
    const [r] = await tx.execute<{ n: string; soma: string | null }>(
      sql`select count(*)::text as n, sum(valor_total)::text as soma
          from lancamentos where importacao_id = ${id}`,
    );
    await tx.execute(
      sql`update importacoes set qtd = ${Number(r.n)}, total = ${arred(Number(r.soma ?? 0))},
                 estado = ${meta.estado === undefined ? null : JSON.stringify(meta.estado)}::jsonb
          where id = ${id}`,
    );
    return { importacaoId: id, qtd: Number(r.n), total: arred(Number(r.soma ?? 0)) };
  });
}

/** As linhas de um lote correspondentes a estas posições da fatura. */
async function apagarLinhasDe(tx: Transacao, id: number, refs: number[]) {
  const lista = JSON.stringify(refs.map((r) => ({ r })));
  const series = await tx.execute<{ serie_id: number }>(
    sql`select distinct l.serie_id from lancamentos l
        join jsonb_to_recordset(${lista}::jsonb) as x(r int) on x.r = l.importacao_linha
        where l.importacao_id = ${id} and l.serie_id is not null`,
  );
  await tx.execute(
    sql`delete from lancamentos l
        using jsonb_to_recordset(${lista}::jsonb) as x(r int)
        where l.importacao_id = ${id} and l.importacao_linha = x.r`,
  );
  for (const s of series) {
    await tx.execute(
      sql`delete from series where id = ${s.serie_id}
          and not exists (select 1 from lancamentos where serie_id = ${s.serie_id})`,
    );
  }
}

/**
 * Adota o valor da fatura num lançamento que já existe.
 *
 * A prévia vem antes, porque mudar o valor mexe no acerto daquele mês — e a
 * regra é a mesma da edição de série: o número aparece antes de confirmar.
 */
export async function previewConciliacao(idLancamento: number, novoValor: number) {
  const [l] = await db.execute<LinhaView>(
    sql`select * from v_lancamentos where id = ${idLancamento}`,
  );
  if (!l) throw new Error('Lançamento não encontrado.');

  const valor = arred(novoValor);
  const pct = Number(l.pct_irwin);
  const parteIrwin = arred(valor * pct);
  const pagoIrwin = pagoIrwinDe(l.quem_pagou as never, valor, parteIrwin, null);
  const novoSaldo = (pagoIrwin ?? 0) - valor * pct;

  const [{ delta }] = await db.execute<{ delta: string }>(
    sql`select round((${String(novoSaldo)}::numeric - saldo_irwin)::numeric, 2)::text as delta
        from v_lancamentos where id = ${idLancamento}`,
  );

  return {
    antes: { valor: Number(l.valor_total), saldoIrwin: l.saldo_irwin === null ? null : Number(l.saldo_irwin) },
    depois: { valor, saldoIrwin: novoSaldo },
    deltaAcerto: Number(delta),
  };
}

export async function conciliarValor(idLancamento: number, novoValor: number) {
  const [l] = await db.execute<LinhaView>(
    sql`select * from v_lancamentos where id = ${idLancamento}`,
  );
  if (!l) throw new Error('Lançamento não encontrado.');

  const valor = arred(novoValor);
  const pct = Number(l.pct_irwin);
  const parteIrwin = arred(valor * pct);
  const pagoIrwin = pagoIrwinDe(l.quem_pagou as never, valor, parteIrwin, null);

  await db.execute(
    sql`update lancamentos set valor_total = ${valor}, pago_irwin = ${pagoIrwin}
        where id = ${idLancamento}`,
  );
  return { ok: true };
}

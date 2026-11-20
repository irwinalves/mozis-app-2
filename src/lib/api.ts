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
import { montarIndice, sugerirPorHistorico, type Indice } from './aprendizado';
import { ligarEstornos } from './estornos';
import {
  acharNoApp,
  agruparIguais,
  type EstornoNoApp,
  type LancamentoNoApp,
} from './estornosNoApp';
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

/**
 * `De fora` exige o nome de quem é o gasto — a mesma lógica do pagador
 * obrigatório, aplicada à outra conta.
 *
 * Sem o nome o lançamento fica fora das duas contas E fora da dívida de
 * terceiro: desaparece de tudo, silenciosamente. Era exatamente esse silêncio
 * que fazia a Vivo da mãe do Irwin não ser lançada.
 *
 * A trava é no servidor e não só na tela porque as três portas de gravação
 * (salvar, editar, importar em lote) chegam aqui, e foi assim que o pagador
 * obrigatório pegou os casos que a tela deixava passar.
 */
function exigirDonoSeDeFora(deFora: unknown, gastoDe: unknown): string | null {
  if (!deFora) return String(gastoDe ?? '').trim() || null;
  const nome = String(gastoDe ?? '').trim();
  if (!nome) {
    throw new Error(
      'Diga de quem é o gasto — sem o nome, "De fora" sai das suas contas e também da dívida de quem deve devolver.',
    );
  }
  return nome;
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
    /**
     * Duas origens, e só. `Pix` virou `Banco` porque a distinção nunca
     * significou nada: um TED não é um Pix, e os dois saem da mesma conta.
     *
     * Os rótulos antigos continuam sendo LIDOS — `Pix` e `Extrato banco` são
     * Banco. `Família` e `Mozi` são outra coisa, e não meio de pagamento
     * nenhum: são os GRUPOS DO SPLITWISE de onde o histórico foi importado
     * (A27). Ficam porque jogar fora a procedência seria perder informação
     * que ninguém tem como recuperar.
     *
     * Aceitar na leitura e nunca na escrita é a A15; criar um "não informado"
     * no formulário seria resolver o passado abrindo o futuro.
     */
    origens: ['Cartão', 'Banco'],
    /* `divisoes` SAIU daqui. Era uma segunda lista das mesmas opções, e
       divergiu: a canonica, em `components/DivisaoEPagador`, tem `De fora` e
       esta não tinha. As telas que liam daqui — revisar importação e editar
       série — ficaram sem como marcar gasto de terceiro, e o defeito era
       invisível de dentro de cada arquivo. Lista de domínio com duas cópias
       é lista que vai divergir; agora tem uma. */
    pagadores: ['Irwin', 'Maria', 'Ambos'],
    pagadoresLancar: ['Irwin', 'Maria', 'Ambos'],
    movimentosInvest: ['Aporte', 'Resgate'],
    pctIrwinRenda: Number(conf?.pct_irwin_renda ?? 0.5),
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
  /**
   * Só o que é do casal — e o critério tem DOIS lados, não um.
   *
   * Uma linha entra aqui se o CUSTO é repartido (`pct_irwin` entre 0 e 1,
   * exclusive) ou se o PAGAMENTO foi dos dois (`quem_pagou = 'Ambos'`).
   * Qualquer um dos dois já faz a linha ser assunto dos dois — e são
   * independentes: 100% do Irwin pago pelos dois é dividido no pagamento;
   * 50/50 pago só pela Maria é dividido no custo.
   *
   * `de_fora` nunca entra: não é gasto de ninguém daqui.
   *
   * O número que explica por que isto existe: na base inteira 98% das linhas
   * são divididas, então no histórico o filtro esconde quase nada. Mas no
   * último lote de fatura, 47 das 55 linhas eram 100% de um só. A lista era
   * compartilhada porque vinha da planilha do casal; com a importação de
   * fatura ela passa a receber compra pessoal.
   */
  dividido?: boolean;
  /** Início do intervalo de datas, 'YYYY-MM-DD'. Inclusive. */
  de?: string;
  /** Fim do intervalo de datas, 'YYYY-MM-DD'. Inclusive. */
  ate?: string;
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
  // Custo repartido OU pagamento dos dois — ver o comentário em `dividido`.
  if (f.dividido) {
    partes.push(
      sql`de_fora = false
          and ((pct_irwin > 0 and pct_irwin < 1) or quem_pagou = 'Ambos')`,
    );
  }
  // As datas são comparadas NO POSTGRES, com cast explícito. Fazer isso em JS
  // já custou caro neste app: o driver devolve `date` à meia-noite UTC e a
  // comparação silenciosamente nunca excluía nada — os três cortes do acerto
  // deram idênticos e esconderam R$ 2.719,16. Regra nº 6 do projeto.
  if (f.de) partes.push(sql`data >= ${f.de}::date`);
  if (f.ate) partes.push(sql`data <= ${f.ate}::date`);
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

  /**
   * Um intervalo de datas pedido à mão MANDA mais que a janela padrão.
   *
   * A lista corta no fim do mês corrente e esconde o futuro atrás do
   * "ver N lançamentos futuros". Mas quem digita "de 01/12 a 31/12" está
   * pedindo o futuro de propósito — manter o corte devolveria lista vazia
   * sem explicar por quê, que é o mesmo defeito da prévia que sumia.
   */
  const pediuIntervalo = Boolean(filtros.de || filtros.ate);
  const janela = incluirFuturos || pediuIntervalo ? sql`true` : sql`data <= ${limite}`;
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

  /* A dívida de terceiro vem junto, e não numa chamada própria, por um motivo
     só: a tela inicial não vai pedir duas coisas para desenhar uma linha. Ela
     é contabilmente OUTRA conta — `de_fora` já zerou o efeito destes gastos no
     acerto do casal — e a tela diz isso com todas as letras. Vem aqui porque
     este é o método que o Início já chama. */
  const [mesAtual, mesSeguinte, total, terceiros] = await Promise.all([
    saldoAte(0),
    saldoAte(1),
    saldoAte(null),
    db.execute<{ aberto: string; pessoas: number }>(
      sql`select coalesce(sum(saldo), 0)::text as aberto,
                 count(*)::int as pessoas
            from v_terceiros where saldo > 0.005`,
    ),
  ]);

  return {
    mesAtual: { saldo: mesAtual, situacao: situacaoDoSaldo(mesAtual) },
    mesSeguinte: { saldo: mesSeguinte, situacao: situacaoDoSaldo(mesSeguinte) },
    total: { saldo: total, situacao: situacaoDoSaldo(total) },
    terceiros: {
      aberto: Number(terceiros[0]?.aberto ?? 0),
      pessoas: Number(terceiros[0]?.pessoas ?? 0),
    },
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
    /* Sem isto a edição não enxerga o `De fora`, e marcar errado vira
       definitivo — o campo nasceu no formulário de Lançar e a tela de editar
       não soube dele. É a regra nº 3 cobrando: enquanto houver mais de um
       formulário do mesmo objeto, campo novo entra num e some nos outros. */
    deFora: r.de_fora,
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
  /**
   * Gasto que passou pelo cartão de vocês mas não é de vocês — alguém de fora
   * devolve. Fica registrado e fora das duas contas; ver `lancamentos.de_fora`.
   */
  deFora?: boolean;
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
  exigirDonoSeDeFora(dados.deFora, dados.gastoDe);

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

    /**
     * Um parcelamento é uma SÉRIE, e precisa nascer com id.
     *
     * Isto faltava, e é a mesma falha da A10 do outro lado da moeda: em agosto
     * eu consertei a recorrência indefinida que nascia órfã e não olhei o
     * parcelamento. Resultado medido em 09/10/2026: 17 parcelas criadas em
     * setembro pela tela de Lançar, todas sem `serie_id`.
     *
     * O que isso custa, e não é pouco:
     *
     * - A tela de editar série não as alcança — exatamente a função que a
     *   Fase 3 existiu para entregar.
     * - O cruzamento da fatura usa `series` como CHAVE FORTE. Uma
     *   `Leiturinha 6/12` chegando na fatura do mês que vem não casaria com
     *   nada, e entraria duplicada.
     */
    let serieId: number | null = null;
    if (!dados.repetir && ocorrencias.length > 1) {
      const [s] = await tx.execute<{ id: number }>(
        sql`insert into series (tipo, descricao, total, origem)
            values ('parcelamento', ${dados.descricao}, ${ocorrencias.length}, 'app')
            returning id`,
      );
      serieId = s.id;
    }

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
               obs, recorrente, gasto_de, de_fora, serie_id, seq)
            values (${formatarData(o.data)}, ${o.descricao}, ${dados.grupo}, ${tipo},
                    ${dados.fonte ?? null}, ${o.valor}, ${dados.divisao},
                    ${pctCustomFracao}, ${pct}, ${ehQuitacaoDe(dados.grupo)},
                    ${quemPagou}, ${pagoIrwin},
                    ${dados.obs ?? null}, ${!!dados.repetir}, ${dados.gastoDe || null},
                    ${!!dados.deFora}, ${serieId}, ${serieId ? i + 1 : null})
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
  exigirDonoSeDeFora(dados.deFora, dados.gastoDe);
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
          gasto_de = ${dados.gastoDe || null}, de_fora = ${!!dados.deFora}
        where id = ${id}`,
  );
  return { ok: true };
}

/**
 * Baixar o valor de um lançamento ANTIGO por causa de um estorno parcial.
 *
 * É a primeira porta pela qual a importação mexe em dado fora do próprio
 * lote, e por isso ela é estreita de propósito: muda `valor_total` e carimba
 * a Obs, mais nada. Categoria, divisão, pagador e data ficam onde estão —
 * quem quiser mudá-los abre o lançamento.
 *
 * `pago_irwin` ACOMPANHA, e não acompanhar seria o defeito silencioso: um
 * lançamento de R$ 134,70 pago inteiro pelo Irwin que vira R$ 65,56 com
 * `pago_irwin` em 134,70 passa a dizer que ele desembolsou mais do que a
 * compra custou, e o acerto sai errado sem nada na tela indicar.
 */
export async function ajustarValorLancamento(
  id: number,
  novoValor: number | string,
  motivo?: string,
) {
  const valor = arred(Number(novoValor));
  if (!(valor > 0)) throw new Error('O valor novo precisa ser maior que zero.');

  const [l] = await db.execute<LinhaView>(sql`select * from v_lancamentos where id = ${id}`);
  if (!l) throw new Error('Lançamento não encontrado.');

  const anterior = Number(l.valor_total);
  if (valor > anterior + 0.005) {
    throw new Error(
      `Este caminho só REDUZ o valor: ${brlTexto(anterior)} não pode virar ${brlTexto(valor)}.`,
    );
  }

  const pct = Number(l.pct_irwin);
  const parteIrwin = arred(valor * pct);
  const pagoIrwin = pagoIrwinDe(l.quem_pagou as never, valor, parteIrwin, null);

  const carimbo = `${motivo ?? 'Ajustado por estorno'} · de ${brlTexto(anterior)} para ${brlTexto(valor)}`;
  const obs = l.obs ? `${l.obs}\n${carimbo}` : carimbo;

  await db.execute(
    sql`update lancamentos
        set valor_total = ${valor}, pago_irwin = ${pagoIrwin}, obs = ${obs}
        where id = ${id}`,
  );
  return { ok: true, anterior, valor };
}

function brlTexto(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function excluirLancamento(id: number) {
  // B2 — sem assinatura de conteúdo, de propósito.
  //
  // A assinatura existia no app antigo como contorno para um modelo SEM id: a
  // linha era identificada pela posição, que muda quando a planilha é
  // reordenada. Aqui `id` é chave primária estável — o problema não existe, e
  // portar o contorno seria copiar um remendo achando que é regra.
  return db.transaction(async (tx) => {
    const [antes] = await tx.execute<{ serie_id: number | null }>(
      sql`select serie_id from lancamentos where id = ${id}`,
    );
    if (!antes) throw new Error('Lançamento não encontrado.');

    await tx.execute(sql`delete from lancamentos where id = ${id}`);

    /* A série morre junto quando fica vazia.
       `apagarLinhasDe` já fazia isto no caminho da importação; esta porta
       não fazia, e aí excluir as três parcelas de uma compra cancelada
       deixava a série para trás, sem nenhum membro. A tela da série passava
       a abrir vazia e o invariante de numeração contava uma série a mais.
       Pego ao excluir o Hering pela aba de estornos. */
    if (antes.serie_id !== null) {
      await tx.execute(
        sql`delete from series where id = ${antes.serie_id}
            and not exists (select 1 from lancamentos where serie_id = ${antes.serie_id})`,
      );
    }
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------


export async function getDashboard(filtro?: {
  dataIni?: string;
  dataFim?: string;
  granularidade?: 'mensal' | 'anual';
}) {
  const granularidade = filtro?.granularidade ?? 'anual';
  /* Investimento, '9 Acerto de Contas' e o que é de fora ficam fora de todo
     relatório de gasto. Os três por motivos diferentes: o segundo é
     transferência entre os dois, o terceiro nem é gasto do casal — só passou
     pelo cartão — e o primeiro é herança: a tela de investimentos foi
     aposentada em 17/11/2026 sem nunca ter sido usada, mas a migração do
     Splitwise deixou uma linha com `tipo = 'Investimento'`, e o filtro
     continua valendo para ela. */
  const base = sql`from v_lancamentos
                   where tipo <> 'Investimento'
                     and not eh_quitacao
                     and not de_fora
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

  /* A evolução para no mês corrente, e isso é regra, não gosto.
     Um parcelamento nasce com a série inteira (A19) e uma compra em 12x joga
     linhas até o ano que vem; as fixas, ao contrário, só são geradas até hoje
     (A18). O futuro então tem parcela e não tem fixa, e o gráfico desenhava
     uma fileira de meses em 0,0% — que não é "o casal parou de ter aluguel",
     é "esse mês ainda não aconteceu". */
  const ateAgora = sql`and data < date_trunc('month', current_date) + interval '1 month'`;

  const evolucao = await db.execute<{ rotulo: string; pct: string }>(
    granularidade === 'mensal'
      ? sql`select to_char(data, 'MM/YY') as rotulo,
                   round(100.0 * coalesce(sum(valor_total) filter (where tipo = 'Fixa'), 0)
                         / nullif(sum(valor_total), 0), 1) as pct
            ${base} ${ateAgora}
            group by date_trunc('month', data), to_char(data, 'MM/YY')
            order by date_trunc('month', data) desc limit 12`
      : sql`select extract(year from data)::text as rotulo,
                   round(100.0 * coalesce(sum(valor_total) filter (where tipo = 'Fixa'), 0)
                         / nullif(sum(valor_total), 0), 1) as pct
            ${base} ${ateAgora}
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
  };
}

// ---------------------------------------------------------------------------
// Importação de extrato
// ---------------------------------------------------------------------------

/**
 * Categorias que entram na sugestão automática.
 * Filtra `8 ` (investimento tem tela própria) e `9 ` (acerto não é gasto).
 */
/**
 * O índice do histórico, montado na hora.
 *
 * Duas colunas sobre os lançamentos já categorizados — `7 Outros` fica de fora
 * porque ele não vota (ver `aprendizado.ts`). Importação é coisa rara, e em
 * troca de uma consulta toda correção feita na revisão vale já na fatura
 * seguinte.
 */
async function indiceDoHistorico(): Promise<Indice> {
  const linhas = await db.execute<{ descricao: string; categoria: string }>(
    sql`select descricao, categoria from lancamentos
        where categoria is not null
          and categoria not like '7 %'
          and categoria not like '8 %'
          and categoria not like '9 %'`,
  );
  return montarIndice(linhas);
}

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
  const [plano, idx] = await Promise.all([planoParaSugestao(), indiceDoHistorico()]);
  return transacoes.map((t) => ({
    data: t.data,
    descricao: t.descricao,
    valor: arred(t.valor),
    // O histórico primeiro; a palavra-chave é o que sobra quando ele não sabe.
    categoria: sugerirPorHistorico(t.descricao, idx) ?? sugerirCategoria(t.descricao, plano),
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
  const pctI = pctIrwinDe(divisaoFinal, null, Number(conf?.pct_irwin_renda ?? 0.5));

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
  de_fora: boolean | null;
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
               pct_irwin_custom, quem_pagou, pago_irwin, saldo_irwin, gasto_de, de_fora
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
          // Sem estes três a tela de série não consegue PREENCHER o bloco de
          // rateio: abriria propondo 50/50 numa série que é 70/30, e o botão
          // nasceria aceso oferecendo uma mudança que ninguém pediu.
          pctIrwinCustom:
            atual.pct_irwin_custom === null ? null : Number(atual.pct_irwin_custom) * 100,
          deFora: atual.de_fora ?? false,
          gastoDe: atual.gasto_de ?? null,
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
  /**
   * `De fora` também vale para série inteira.
   *
   * Faltava, e o sintoma era o mesmo do lançamento avulso: a divisão podia
   * virar 'De fora' na tela e a coluna continuava `false`, deixando a série
   * mexendo no acerto. Regra nº 3 — o campo tem que existir nas quatro portas
   * ou não existe em nenhuma.
   */
  deFora?: boolean;
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
               pct_irwin_custom, quem_pagou, pago_irwin, saldo_irwin, gasto_de, de_fora
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
    gastoDe: exigirDonoSeDeFora(
      divisao === 'De fora' ? true : (m.deFora ?? l.de_fora ?? false),
      m.gastoDe !== undefined ? m.gastoDe : l.gasto_de,
    ),
    // A divisão manda: escolher 'De fora' na tela JÁ quer dizer de_fora. Ler
    // só `m.deFora` deixaria os dois discordando quando a tela mudasse um sem
    // o outro — e discordar aqui significa série fora do acerto sem aviso.
    deFora: divisao === 'De fora' ? true : (m.deFora ?? l.de_fora ?? false),
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
  return Number(conf?.pct_irwin_renda ?? 0.5);
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
              gasto_de = ${d.gastoDe}, de_fora = ${d.deFora}
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

  const [plano, idxHistorico] = await Promise.all([
    planoParaSugestao(),
    indiceDoHistorico(),
  ]);

  /**
   * Os negativos ligados à compra que cancelam, DENTRO da mesma fatura.
   *
   * A A13 manda descartar negativo, e está certa — não é gasto novo. Mas
   * descartar em silêncio esconde o que importa: em agosto, `Adaptaorg` vem
   * com as doze parcelas de R$ 99 e com um estorno de −R$ 1.188,00. Sem
   * ligar os dois, o app grava uma série até junho de 2027 para uma compra
   * cancelada.
   */
  const estornos = ligarEstornos(
    classificadas.map((c, i) => ({
      i,
      descricao: c.linha.descricao,
      valor: c.linha.valor,
      parcela: c.linha.parcela,
    })),
    r.descartadas,
  );

  /**
   * O que cada devolução cancela entre os lançamentos JÁ GRAVADOS.
   *
   * `ligarEstornos` só olha para a própria fatura, e isso deixa de fora o
   * caso mais caro: a compra foi lançada meses atrás e o cancelamento chega
   * agora. Em outubro/2026 são três `Canc Parcela Sem Juros - Hering` de
   * R$ 141,58 — um parcelamento 3x cancelado inteiro, cuja primeira parcela
   * está lançada no app desde 28/07. Sem este cruzamento a tela diz "não
   * corresponde a nenhuma compra desta fatura" e o lançamento de uma compra
   * que não existe mais fica para sempre no resultado do mês.
   *
   * Busca pelo VALOR, nos últimos 24 meses. O filtro por valor existe para
   * não trazer a base inteira para a memória; quem decide se é a mesma compra
   * é o lojista, dentro de `acharNoApp` — valor sozinho nunca propõe nada.
   */
  /**
   * Quais devoluções a fatura NÃO explica sozinha.
   *
   * Não basta pegar as `solto`. Em outubro vêm TRÊS `Canc Parcela Sem Juros -
   * Hering` de R$ 141,58 e a fatura tem UMA linha Hering de R$ 141,58 — a
   * parcela 3 de 3. As três se ligam àquela mesma linha e nenhuma fica
   * `solto`, mas duas parcelas continuam lançadas no app, de faturas
   * anteriores. Se o critério fosse `solto`, o caso que motivou tudo isto
   * passaria batido.
   *
   * Por isso a conta é por GRUPO de devoluções idênticas: quantas vieram,
   * menos quantas linhas distintas desta fatura elas cobrem. O que sobra é o
   * que se procura no app.
   */
  const porGrupo = agruparIguais(
    estornos.map((e, i) => ({ i, descricao: e.negativa.descricao, valor: e.negativa.valor })),
  );
  const semParNaFatura = porGrupo
    .map((g) => {
      /* Só desconta a linha da fatura que AINDA NÃO ESTÁ no app.
         Uma linha que o cruzamento marcou como já lançada não resolve a
         devolução: ela É um dos lançamentos que precisam sair. Descontá-la
         fazia a tela dizer "cancelou 2" quando foram 3, e deixar uma parcela
         de pé. O teste com a fatura de outubro pegou exatamente isso. */
      const refs = new Set<number>();
      for (const it of g.itens) {
        const v = estornos[(it as { i: number }).i].vinculo;
        if (v.tipo === 'solto') continue;
        for (const r of v.refs) {
          const t = classificadas[r]?.situacao.tipo;
          if (t !== 'jaLancado' && t !== 'suspeita') refs.add(r);
        }
      }
      return { g, faltam: g.vezes - refs.size };
    })
    .filter(({ faltam }) => faltam > 0);

  let estornosNoApp: EstornoNoApp[] = [];
  if (semParNaFatura.length) {
    const alvos = semParNaFatura.flatMap(({ g, faltam }) => [g.valorUnit, g.valorUnit * faltam]);
    /* `in` e não `= any()`: o template de SQL renderiza um array JS como
       tupla — `($1, $2)` — que é exatamente o que `in` espera e o que
       `= any()` recusa, porque ANY pede um array de verdade.
       (O comentário mora aqui e não dentro do SQL: crase dentro de template
       string fecha a string, e o arquivo deixa de compilar.) */
    const valores = [...new Set(alvos.map((v) => Number(v.toFixed(2))))];
    const candidatos = await db.execute<{
      id: number; data: string | Date; descricao: string; valor_total: string;
      serie_id: number | null; serie_qtd: number | null; serie_total: string | null;
    }>(
      sql`select l.id, l.data, l.descricao, l.valor_total, l.serie_id,
                 s.lancamentos as serie_qtd, s.soma::text as serie_total
          from v_lancamentos l
          left join (select serie_id, count(*) as lancamentos, sum(valor_total) as soma
                     from v_lancamentos where serie_id is not null group by serie_id) s
                 on s.serie_id = l.serie_id
          where l.data >= (current_date - interval '24 months')
            and (round(l.valor_total, 2) in ${valores}
                 or round(s.soma, 2) in ${valores})`,
    );
    const lancs: LancamentoNoApp[] = candidatos.map((c) => ({
      id: c.id,
      data: isoDaLinha(c.data),
      descricao: c.descricao,
      valor: Number(c.valor_total),
      serieId: c.serie_id,
      serieQtd: c.serie_qtd,
      serieTotal: c.serie_total === null ? null : Number(c.serie_total),
    }));
    estornosNoApp = semParNaFatura.map(({ g, faltam }) => ({
      // O índice do PRIMEIRO estorno do grupo: três Hering idênticos são uma
      // pergunta só, e a tela precisa saber a qual linha pendurar a resposta.
      i: (g.itens[0] as { i: number }).i,
      // `faltam`, não `vezes`: o que se procura no app é o que a fatura não
      // explicou. Das três parcelas canceladas do Hering, uma está nesta
      // fatura e duas estão lá atrás.
      achado: acharNoApp(g.itens[0].descricao, g.valorUnit, faltam, lancs),
    }));
  }

  /** As linhas que um estorno INTEGRAL cobre — nascem desmarcadas. */
  const estornadas = new Set<number>();
  for (const e of estornos) {
    if (e.vinculo.tipo === 'integral') for (const ref of e.vinculo.refs) estornadas.add(ref);
  }

  return {
    arquivo: nomeArquivo,
    total: r.total,
    descartadas: r.descartadas,
    estornos,
    estornosNoApp,
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
          (app?.categoria as string | undefined) ??
          sugerirPorHistorico(c.linha.descricao, idxHistorico) ??
          sugerirCategoria(c.linha.descricao, plano),
        /** Divergência de valor com o que está no app, quando houver. */
        difValor: app ? arred(c.linha.valor - Number(app.valor)) : null,
        /** Um estorno desta fatura cobre a compra inteira. Entra desmarcada. */
        estornada: estornadas.has(i),
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
  /**
   * De onde saiu o dinheiro. Era fixo em `Cartão` para tudo que vinha de
   * fatura, e quase sempre é — mas uma linha de fatura pode ter sido débito,
   * e a tela de revisão passou a deixar corrigir. Ausente mantém `Cartão`.
   */
  origem?: string | null;
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
  /**
   * Qual pedaço desta linha é — `1` quando a linha não foi dividida.
   *
   * Vai junto do `ref` e não no lugar dele: `ref` diz DE QUAL linha da fatura
   * veio, `pedaco` diz QUAL parte dela. Juntos, reabrir o lote sabe o que
   * está olhando sem deduzir nada.
   */
  pedaco?: number | null;
  /** `De fora`: registrado e fora das duas contas. */
  deFora?: boolean;
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
        fonte: l.origem || 'Cartão',
        serie_id: serieId,
        seq: serieId ? k + 1 : null,
        ref: l.ref ?? null,
        pedaco: l.pedaco ?? 1,
        de_fora: !!l.deFora,
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
             pago_irwin, recorrente, gasto_de, de_fora, serie_id, seq,
             importacao_id, importacao_linha, importacao_pedaco)
          select r.data::date, r.descricao, r.categoria, r.tipo,
                 'Fatura do cartão', r.fonte, r.valor::numeric, r.divisao,
                 r.pct_custom::numeric, r.pct::numeric, r.eh_quitacao,
                 r.quem_pagou, r.pago_irwin::numeric, false, r.gasto_de,
                 r.de_fora, r.serie_id, r.seq, ${impId}, r.ref, r.pedaco
          from jsonb_to_recordset(${JSON.stringify(paraGravar)}::jsonb) as r(
            data text, descricao text, categoria text, tipo text, valor text,
            divisao text, pct_custom text, pct text, eh_quitacao boolean,
            quem_pagou text, pago_irwin text, gasto_de text, fonte text,
            de_fora boolean, serie_id int, seq int, ref int, pedaco int)`,
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
  // Um lote de 86 linhas é onde um `De fora` sem dono passa despercebido: a
  // linha fica fora das duas contas e fora da dívida, e ninguém reconfere 86.
  for (const l of linhas) exigirDonoSeDeFora(l.deFora, l.gastoDe);
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
    ref: number; pedaco: number; n: number; descricao: string; categoria: string;
    tipo: string; divisao: string; quem_pagou: string | null; valor: string; total: string;
    gasto_de: string | null; de_fora: boolean | null; fonte: string | null; data: string;
    pct_custom: string | null;
  }>(sql`select importacao_linha as ref, importacao_pedaco as pedaco, count(*)::int as n,
                (array_agg(descricao   order by seq nulls first, data, id))[1] as descricao,
                (array_agg(categoria   order by seq nulls first, data, id))[1] as categoria,
                (array_agg(tipo        order by seq nulls first, data, id))[1] as tipo,
                (array_agg(divisao     order by seq nulls first, data, id))[1] as divisao,
                (array_agg(quem_pagou  order by seq nulls first, data, id))[1] as quem_pagou,
                /* O dono vem do banco como todo o resto desta consulta: quem
                   marcou "é da mãe do Irwin" na tela normal não pode ver a
                   revisão do lote oferecendo desmarcar sem avisar. */
                (array_agg(gasto_de     order by seq nulls first, data, id))[1] as gasto_de,
                (array_agg(de_fora      order by seq nulls first, data, id))[1] as de_fora,
                (array_agg(fonte        order by seq nulls first, data, id))[1] as fonte,
                /* A porcentagem do Valor exato. Sem ela, reabrir um lote com
                   divisao Custom voltaria com 50/50 e a correcao em lote
                   regravaria metade para cada um — dinheiro mudando de dono
                   em silencio. */
                (array_agg(pct_irwin_custom order by seq nulls first, data, id))[1]::text as pct_custom,
                /* A data da PRIMEIRA parcela e a da compra; as outras sao
                   derivadas dela por montarParcelas. Sem crase aqui dentro: a
                   consulta mora numa template string, e a crase a encerra. */
                to_char((array_agg(data order by seq nulls first, data, id))[1], 'YYYY-MM-DD') as data,
                (array_agg(valor_total order by seq nulls first, data, id))[1]::text as valor,
                round(sum(valor_total)::numeric, 2)::text as total
         from v_lancamentos
         where importacao_id = ${id} and importacao_linha is not null
         /* Agrupa por LINHA E PEDAÇO. Só por linha, uma linha dividida em dois
            pedaços de valores diferentes voltaria como "2 parcelas" de uma
            compra só — e a correção seguinte reescreveria os dois com o mesmo
            valor unitário, somando ou perdendo dinheiro em silêncio. */
         group by importacao_linha, importacao_pedaco
         order by importacao_linha, importacao_pedaco`);

  interface PedacoAtual {
    pedaco: number;
    parcelas: number;
    descricao: string;
    categoria: string;
    tipo: string;
    divisao: string;
    quemPagou: string | null;
    deFora: boolean;
    gastoDe: string | null;
    origem: string | null;
    data: string;
    /** 0 a 100, so quando a divisao e `Custom`. */
    pctCustom: number | null;
    valor: number;
    total: number;
  }

  /**
   * Por linha da fatura. Os campos de topo são os do PRIMEIRO pedaço, que é a
   * linha inteira no caso normal — é o que a tela já lia e continua lendo.
   * `pedacos` só importa para linha dividida, e aí tem todos, inclusive o
   * primeiro, para a reconstrução não precisar juntar duas fontes.
   */
  const atual: Record<number, PedacoAtual & { pedacos: PedacoAtual[] }> = {};

  for (const l of linhas) {
    const p: PedacoAtual = {
      pedaco: l.pedaco,
      parcelas: l.n,
      // O sufixo ` N/M` é gerado por `montarParcelas`; o nome da série é o que
      // sobra. Sem tirar, reabrir e regravar somaria um sufixo a cada vez.
      descricao: l.n > 1 ? String(l.descricao).replace(/ \(?\d[\d,+]*\/\d+\)?$/, '') : l.descricao,
      categoria: l.categoria,
      tipo: l.tipo,
      divisao: l.divisao,
      quemPagou: l.quem_pagou,
      deFora: !!l.de_fora,
      gastoDe: l.gasto_de,
      origem: l.fonte,
      data: l.data,
      pctCustom: l.pct_custom === null ? null : Number(l.pct_custom) * 100,
      valor: Number(l.valor),
      total: Number(l.total),
    };
    const ja = atual[l.ref];
    if (ja) ja.pedacos.push(p);
    else atual[l.ref] = { ...p, pedacos: [p] };
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

// ---------------------------------------------------------------------------
// Terceiros — quem pagamos e quem nos deve
//
// A dívida de um terceiro NÃO é gravada em nenhum lugar: ela sai de
// `v_terceiros`, que soma os lançamentos `de_fora` dele e desconta as
// devoluções. Ver o cabeçalho da tabela `reembolsos` para o porquê.
//
// Nada aqui toca o acerto entre Irwin e Maria. `de_fora` já zera o
// `saldo_irwin` do lançamento, e `reembolsos` é tabela própria — de propósito,
// e não por falta de alternativa: encaixar a devolução de um terceiro em
// `acerto_contas` funcionaria na aritmética de hoje e explodiria no primeiro
// `quem_pagou = 'Irwin'` com `para_quem` fora do casal, somando a dívida da
// mãe dele ao que a Maria deve. Tabela separada não tem como errar isso.
// ---------------------------------------------------------------------------

export interface Terceiro {
  pessoa: string;
  adiantado: number;
  devolvido: number;
  saldo: number;
  lancamentos: number;
  devolucoes: number;
  primeiroGasto: string | null;
  ultimoGasto: string | null;
  ultimaDevolucao: string | null;
}

/** Todos os terceiros com movimento, quem deve primeiro. */
export async function listarTerceiros(): Promise<Terceiro[]> {
  const linhas = await db.execute<{
    pessoa: string;
    adiantado: string;
    devolvido: string;
    saldo: string;
    lancamentos: number;
    devolucoes: number;
    primeiro_gasto: unknown;
    ultimo_gasto: unknown;
    ultima_devolucao: unknown;
  }>(sql`select * from v_terceiros order by saldo desc, pessoa`);

  return linhas.map((r) => ({
    pessoa: r.pessoa,
    adiantado: Number(r.adiantado),
    devolvido: Number(r.devolvido),
    saldo: Number(r.saldo),
    lancamentos: Number(r.lancamentos),
    devolucoes: Number(r.devolucoes),
    primeiroGasto: r.primeiro_gasto ? isoDaLinha(r.primeiro_gasto) : null,
    ultimoGasto: r.ultimo_gasto ? isoDaLinha(r.ultimo_gasto) : null,
    ultimaDevolucao: r.ultima_devolucao ? isoDaLinha(r.ultima_devolucao) : null,
  }));
}

/**
 * O extrato de uma pessoa: os gastos que passaram pelo nosso cartão e as
 * devoluções, numa linha do tempo só.
 *
 * Duas listas separadas obrigariam quem olha a intercalar as datas de cabeça
 * para responder "ela pagou aquele mês?" — que é a única pergunta que se faz
 * nesta tela.
 */
export async function extratoTerceiro(pessoa: string) {
  const [gastos, devolucoes] = await Promise.all([
    db.execute<{ id: number; data: unknown; descricao: string; valor_total: string; quem_pagou: string | null }>(
      sql`select id, data, descricao, valor_total, quem_pagou
            from lancamentos
           where de_fora and gasto_de = ${pessoa}
           order by data desc, id desc`,
    ),
    db.execute<{ id: number; data: unknown; valor: string; para_quem: string; obs: string | null }>(
      sql`select id, data, valor, para_quem, obs from reembolsos
           where pessoa = ${pessoa} order by data desc, id desc`,
    ),
  ]);

  const [t] = await listarTerceirosDe(pessoa);
  return {
    pessoa,
    saldo: t?.saldo ?? 0,
    adiantado: t?.adiantado ?? 0,
    devolvido: t?.devolvido ?? 0,
    gastos: gastos.map((g) => ({
      id: g.id,
      data: isoDaLinha(g.data),
      descricao: g.descricao,
      valor: Number(g.valor_total),
      quemPagou: g.quem_pagou,
    })),
    devolucoes: devolucoes.map((d) => ({
      id: d.id,
      data: isoDaLinha(d.data),
      valor: Number(d.valor),
      paraQuem: d.para_quem,
      obs: d.obs,
    })),
  };
}

async function listarTerceirosDe(pessoa: string): Promise<Terceiro[]> {
  const todos = await listarTerceiros();
  return todos.filter((t) => t.pessoa === pessoa);
}

/**
 * Registra que um terceiro devolveu dinheiro.
 *
 * `paraQuem` é obrigatório pela mesma razão que o pagador de um lançamento é
 * (A4): sem saber quem recebeu, a devolução some do controle de quem adiantou.
 * O valor pode ser maior que o saldo — a mãe pode adiantar o mês que vem — e
 * por isso não há trava, só o saldo negativo aparecendo na tela.
 */
export async function registrarReembolso(dados: {
  pessoa: string;
  paraQuem: string;
  valor: number;
  data: string;
  obs?: string | null;
  lancamentoId?: number | null;
}) {
  const pessoa = String(dados.pessoa ?? '').trim();
  if (!pessoa) throw new Error('Diga de quem é a devolução.');

  const paraQuem = String(dados.paraQuem ?? '').trim();
  if (paraQuem !== 'Irwin' && paraQuem !== 'Maria')
    throw new Error('Diga quem recebeu a devolução.');

  const valor = arred(Number(dados.valor));
  if (!(valor > 0)) throw new Error('O valor da devolução tem que ser maior que zero.');

  if (!dados.data) throw new Error('Diga a data da devolução.');

  const [r] = await db.execute<{ id: number }>(
    sql`insert into reembolsos (data, pessoa, para_quem, valor, obs, lancamento_id)
        values (${dados.data}::date, ${pessoa}, ${paraQuem}, ${valor},
                ${dados.obs?.trim() || null}, ${dados.lancamentoId ?? null})
        returning id`,
  );
  return { id: r.id, saldo: (await listarTerceirosDe(pessoa))[0]?.saldo ?? 0 };
}

export async function excluirReembolso(id: number) {
  const [r] = await db.execute<{ pessoa: string }>(
    sql`delete from reembolsos where id = ${id} returning pessoa`,
  );
  if (!r) throw new Error('Devolução não encontrada.');
  return { ok: true, pessoa: r.pessoa };
}

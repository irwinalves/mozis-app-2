/**
 * Schema do Mozi's App 2.0.
 *
 * Espelha a planilha "DRE - Casal - v2", mas com uma diferença estrutural:
 * aqui só existem as colunas de ENTRADA. Tudo que na planilha é fórmula
 * (Parte Irwin, Parte Maria, Pago Maria, Saldo Irwin, Ano, Mês) vive na view
 * `v_lancamentos` — ver `sql/0001_view.sql`.
 *
 * Isso elimina de uma vez a classe de bug que derrubou o recurso de dois
 * pagadores em 12/08/2026: não há "copiar a fórmula da linha 6", não há
 * fórmula arrastada além da última linha, e não há mapa posicional de colunas.
 */
import {
  pgTable,
  serial,
  integer,
  text,
  date,
  numeric,
  boolean,
  index,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Painel único de configuração — equivalente à aba `Config`, célula C6.
 * Uma linha só (id = 1). Mudar aqui recalcula tudo, como na planilha.
 */
export const config = pgTable('config', {
  id: integer('id').primaryKey().default(1),
  /** % do Irwin na divisão "por renda". Hoje ≈ 0.4947. */
  pctIrwinRenda: numeric('pct_irwin_renda', { precision: 6, scale: 4 })
    .notNull()
    .default('0.4947'),
});

/**
 * Aba `Plano de Contas` (B6:D14): 8 categorias de gasto + `9 Acerto de Contas`.
 * `palavrasChave` alimenta a categorização automática da importação de extrato.
 */
export const planoDeContas = pgTable('plano_de_contas', {
  nome: text('nome').primaryKey(),
  palavrasChave: text('palavras_chave'),
  tipoPadrao: text('tipo_padrao'),
  ordem: integer('ordem').notNull(),
});

/**
 * A identidade que o app nunca teve: o que liga as parcelas de uma compra, e
 * os lançamentos de uma regra de recorrência, uns aos outros.
 *
 * Antes disto o único vínculo entre parcelas era o sufixo da descrição
 * (`" 3/12"`), e agrupar por texto é adivinhação. A base prova: `Seguro Carro`
 * são DUAS séries — 10x de R$ 407,52 em 2025 e 12x de R$ 199,77 a partir de
 * dez/25 — com a mesma raiz de descrição. Agrupadas por texto virariam uma
 * série só, de 22 parcelas, e editar uma editaria a outra.
 *
 * `total` é quantas parcelas a série declara ter, não quantas existem: 40 das
 * 85 séries do histórico têm parcela faltando, porque nem toda compra foi
 * lançada inteira. Faltar parcela é história, não ambiguidade — a série
 * continua sendo uma só, e `completa` é atributo, não condição de existir.
 */
export const series = pgTable('series', {
  id: serial('id').primaryKey(),
  /** parcelamento · recorrencia. São modelos diferentes (A6) e não se misturam. */
  tipo: text('tipo').notNull(),
  /** A descrição SEM o sufixo `N/M`. O sufixo é apresentação, `seq` é o dado. */
  descricao: text('descricao').notNull(),
  /** Nº de parcelas declarado. NULL para recorrência, que não tem fim previsto. */
  total: integer('total'),
  recorrenciaId: integer('recorrencia_id'),
  /**
   * Como esta série foi identificada. Existe por causa da C7 — honestidade
   * sobre a qualidade do dado: uma série reconstruída por heurística no
   * backfill não é a mesma coisa que uma criada pelo app, e a tela precisa
   * poder dizer isso.
   */
  origem: text('origem').notNull().default('app'),
  criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Aba `Lançamentos`. Só colunas de entrada — ver o mapa `COL` do backend antigo
 * (`Codigo.gs:25`) para a correspondência.
 *
 * `linhaOrigem` guarda o número da linha na planilha durante a fase paralela,
 * para a reconciliação conseguir apontar exatamente onde divergiu. Perde o
 * sentido depois do cutover.
 */
export const lancamentos = pgTable(
  'lancamentos',
  {
    id: serial('id').primaryKey(),
    data: date('data').notNull(),
    descricao: text('descricao').notNull(),
    categoria: text('categoria').notNull(),
    /** Fixa · Variável · Investimento. Campo próprio do lançamento, não derivado da categoria. */
    tipo: text('tipo').notNull(),
    catOriginal: text('cat_original'),
    /** Cartão · Pix · "Extrato banco" (importação). */
    fonte: text('fonte'),
    valorTotal: numeric('valor_total', { precision: 12, scale: 2 }).notNull(),
    /** 50/50 · Renda · 100% Irwin · 100% Maria · Custom. */
    divisao: text('divisao').notNull(),
    /**
     * Só quando divisao = 'Custom'. É FRAÇÃO (0.4), não percentual (40).
     *
     * Medido nos 3.504 lançamentos: todos os valores são ≤ 1, e a fórmula da
     * planilha é `G*I` — sem `/100`.
     *
     * A unidade muda de camada, e as duas estão certas: o front e a API falam
     * PERCENTUAL (70), e `escreverLinha` converte com `/100` antes de gravar.
     * Quem lê esta coluna já recebe fração e não deve dividir de novo.
     *
     * Sem precisão declarada de propósito: o histórico do Splitwise tem valores
     * como 0.39999999999999997 e 0.06059005578102704, vindos do rateio real de
     * cada despesa. Um numeric(5,2) truncaria isso e quebraria a reconciliação.
     */
    pctIrwinCustom: numeric('pct_irwin_custom'),
    /** Irwin · Maria · Ambos. 'Conjunta' é o rótulo antigo, ainda aceito. */
    quemPagou: text('quem_pagou'),
    /**
     * Quanto o Irwin efetivamente desembolsou. É ENTRADA, não fórmula.
     * NULL = sem pagador definido: a linha fica fora do acerto, como sempre foi.
     *
     * SEM precisão declarada, e isso NÃO é excesso de zelo: quando os dois
     * pagam e cada um põe a própria parte, o desembolso é metade do valor — e
     * metade de um valor de centavo ímpar é MEIO CENTAVO. Medido na base:
     * 2 linhas com 3 casas decimais (`Aluguel Dez21` = 2193,63/2 = 1096,815 e
     * `Luz Agosto/20` = 113,29/2 = 56,645). Com numeric(12,2) elas divergiam.
     *
     * Mesma classe de erro que `pct_irwin_custom` — precisão declarada por
     * suposição sobre o que "dinheiro tem que ter".
     */
    pagoIrwin: numeric('pago_irwin'),
    obs: text('obs'),
    recorrente: boolean('recorrente').notNull().default(false),

    /**
     * De quem é o custo — NÃO quem pagou.
     *
     * São perguntas diferentes e o app já modelava só a segunda. `quem_pagou`
     * diz de quem saiu o dinheiro; esta coluna diz a quem o gasto se refere,
     * para responder "quanto custa o André" sem depender de a descrição conter
     * a palavra "André".
     *
     * NULL = gasto do casal, que é a esmagadora maioria. Texto e não booleano
     * porque uma segunda pessoa não deveria exigir migração de tipo — é o mesmo
     * padrão de `quem_pagou`, que também é texto com um conjunto conhecido de
     * valores.
     *
     * Deliberadamente NÃO entra no cálculo do acerto: um gasto do André pago
     * pelo Irwin e dividido 50/50 continua dividido 50/50. A tag classifica,
     * não redistribui.
     */
    gastoDe: text('gasto_de'),

    /**
     * % do Irwin JÁ RESOLVIDO, congelado na gravação.
     *
     * A regra que escolhe o percentual (`pctIrwinDe`) existe em UM lugar só, em
     * TypeScript. A view faz aritmética sobre esta coluna, não repete a tabela
     * de casos — antes o `CASE` do SQL duplicava a regra, e duas
     * implementações da mesma coisa divergem mais cedo ou mais tarde.
     *
     * Efeito colateral desejado: mudar a proporção de renda passa a valer só
     * para lançamentos novos. Antes reescrevia o passado. Conferido antes de
     * adotar: nenhuma das 3.510 linhas usa divisão 'Renda', então congelar
     * produziu números idênticos.
     */
    pctIrwin: numeric('pct_irwin').notNull(),

    /**
     * Quitação de dívida entre os dois — NÃO é despesa.
     *
     * Campo próprio em vez de casar o texto da categoria (`'9 Acerto…'`), que
     * era string mágica repetida em quatro lugares no app antigo.
     */
    ehQuitacao: boolean('eh_quitacao').notNull().default(false),

    /** A série a que este lançamento pertence. NULL = lançamento avulso. */
    serieId: integer('serie_id'),
    /**
     * O lote de importação que criou esta linha. NULL = lançado à mão.
     * É o que permite desfazer o lote inteiro e o que dá o selo na lista.
     */
    importacaoId: integer('importacao_id'),
    /**
     * A posição na série — o `3` de `3/12`. É o DADO; o texto da descrição é
     * apresentação e continua carregando o sufixo, porque é o que a lista
     * mostra e o que a busca encontra.
     */
    seq: integer('seq'),

    /**
     * Desempate de mesma data, que o `PARA-O-APP-2.0.md` deixou em aberto: sem
     * carimbo de criação, dois lançamentos do mesmo dia não têm ordem estável.
     * O `id desc` da ordenação fazia esse papel por acaso; aqui fica explícito.
     */
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),

    linhaOrigem: integer('linha_origem'),
  },
  (t) => [
    // A ordenação da lista é por DATA — na planilha isso exigia ler um bloco
    // contíguo e ordenar inteiro, porque ordem física != ordem de data.
    index('idx_lancamentos_data').on(t.data),
    index('idx_lancamentos_categoria').on(t.categoria),
    // O relatório por pessoa filtra por esta coluna, e a esmagadora maioria das
    // linhas é NULL — um índice parcial cobre as que interessam a custo baixo.
    index('idx_lancamentos_gasto_de').on(t.gastoDe),
    // A tela de série carrega todas as linhas de uma série de uma vez.
    index('idx_lancamentos_serie').on(t.serieId, t.seq),
  ],
);

/**
 * Um lote de importação.
 *
 * Existe por causa do DESFAZER, que não é enfeite: sem ele o primeiro erro
 * custa limpar 120 linhas à mão, e o medo disso é o que faz a importação não
 * ser usada — que é literalmente o estado de hoje, com zero linhas importadas
 * em 3.544.
 *
 * E existe também para o lote poder ser VISTO. Uma importação é um evento: num
 * dia entraram 120 gastos de uma fatura. Sem o lote, essa informação se dissolve
 * em 120 linhas soltas e ninguém consegue mais responder o que entrou no dia.
 */
export const importacoes = pgTable('importacoes', {
  id: serial('id').primaryKey(),
  /** fatura · extrato. O sinal do valor é OPOSTO entre os dois. */
  tipo: text('tipo').notNull(),
  /** O que a tela mostra, por exemplo Cartão Itaú · Agosto/2026. */
  titulo: text('titulo').notNull(),
  arquivo: text('arquivo'),
  criadaEm: timestamp('criada_em', { withTimezone: true }).notNull().defaultNow(),
  /** Quem importou. Não é quem pagou — a fatura traz um pagador por linha. */
  criadaPor: text('criada_por'),
  qtd: integer('qtd').notNull().default(0),
  total: numeric('total', { precision: 12, scale: 2 }).notNull().default('0'),
});

/**
 * Aba `Recorrências`: regras de gasto recorrente indefinido.
 * `ultimaGeracao` é o que torna o gatilho idempotente — impede voltar no tempo
 * e duplicar lançamentos já gerados.
 */
export const recorrencias = pgTable('recorrencias', {
  id: serial('id').primaryKey(),
  dataInicio: date('data_inicio').notNull(),
  descricao: text('descricao').notNull(),
  categoria: text('categoria').notNull(),
  fonte: text('fonte'),
  valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
  divisao: text('divisao').notNull(),
  pctIrwinCustom: numeric('pct_irwin_custom', { precision: 5, scale: 2 }),
  quemPagou: text('quem_pagou'),
  /** mensal · quinzenal (+14 dias) · semanal. */
  frequencia: text('frequencia').notNull().default('mensal'),
  /**
   * Até quando a recorrência vale. NULL = indefinidamente.
   *
   * Antes disto, marcar "repetir até 31/12" gerava as ocorrências de uma vez e
   * NÃO criava regra nenhuma — então não havia onde guardar a vigência, nem
   * como editá-la, e a série nascia órfã. Era o mesmo buraco que deixou o
   * `Financiamento` sem regra, de outro ângulo.
   */
  dataFim: date('data_fim'),
  ultimaGeracao: date('ultima_geracao'),
  ativo: boolean('ativo').notNull().default(true),
  /** Propagado para cada lançamento gerado — ver `lancamentos.gastoDe`. */
  gastoDe: text('gasto_de'),
});

/**
 * Aba `Acerto de Contas`, linhas 12+: as quitações históricas importadas do
 * Splitwise. Entram no saldo: quem pagou Maria → saldo -= valor; Irwin → += valor.
 *
 * Quitações NOVAS não vêm para cá — viram lançamento na categoria
 * `9 Acerto de Contas`, para não haver duas verdades.
 */
export const acertoContas = pgTable('acerto_contas', {
  id: serial('id').primaryKey(),
  data: date('data').notNull(),
  descricao: text('descricao'),
  quemPagou: text('quem_pagou'),
  paraQuem: text('para_quem'),
  valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
  obs: text('obs'),
});

/**
 * Bloco CONTAS da aba `Investimentos`.
 * Na planilha isso era localizado por busca de texto (`acharLinha`), porque os
 * dois blocos dividiam a mesma aba. Aqui são duas tabelas normais.
 */
export const investimentosContas = pgTable('investimentos_contas', {
  id: serial('id').primaryKey(),
  nome: text('nome').notNull().unique(),
  apelido: text('apelido'),
  classe: text('classe'),
  deQuem: text('de_quem'),
});

/** Bloco MOVIMENTOS da aba `Investimentos`. */
export const investimentosMovimentos = pgTable('investimentos_movimentos', {
  id: serial('id').primaryKey(),
  data: date('data').notNull(),
  conta: text('conta').notNull(),
  /** Aporte · Resgate. */
  tipo: text('tipo').notNull(),
  valor: numeric('valor', { precision: 12, scale: 2 }).notNull(),
  deQuem: text('de_quem'),
  obs: text('obs'),
});

/** Aba `Patrimônio`: a posição mensal, anotada no ritual do fim do mês. */
export const patrimonio = pgTable('patrimonio', {
  id: serial('id').primaryKey(),
  data: date('data').notNull(),
  totalInvestido: numeric('total_investido', { precision: 14, scale: 2 }),
  dividas: numeric('dividas', { precision: 14, scale: 2 }),
  patrimonioLiquido: numeric('patrimonio_liquido', { precision: 14, scale: 2 }),
});

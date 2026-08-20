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
     */
    pagoIrwin: numeric('pago_irwin', { precision: 12, scale: 2 }),
    obs: text('obs'),
    recorrente: boolean('recorrente').notNull().default(false),

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

    linhaOrigem: integer('linha_origem'),
  },
  (t) => [
    // A ordenação da lista é por DATA — na planilha isso exigia ler um bloco
    // contíguo e ordenar inteiro, porque ordem física != ordem de data.
    index('idx_lancamentos_data').on(t.data),
    index('idx_lancamentos_categoria').on(t.categoria),
  ],
);

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
  ultimaGeracao: date('ultima_geracao'),
  ativo: boolean('ativo').notNull().default(true),
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

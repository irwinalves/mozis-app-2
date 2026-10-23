-- =====================================================================
-- v_lancamentos
--
-- Aqui há SÓ ARITMÉTICA. A regra que decide o percentual de cada divisão
-- (50/50, Renda, 100%, Custom) vive em UM lugar: `pctIrwinDe()` em
-- `src/lib/lancamentos.ts`, e o resultado é gravado na coluna `pct_irwin`.
--
-- A versão anterior desta view repetia a tabela de casos num CASE. Duas
-- implementações da mesma regra divergem — é questão de tempo, e quando
-- divergem não há como saber qual está certa, só que os números não batem.
--
-- Transcrição das fórmulas originais da planilha, para rastreabilidade:
--   J Parte Irwin  = valor * pct          (sem arredondar — a planilha não arredonda)
--   K Parte Maria  = valor - Parte Irwin
--   M Saldo Irwin  = Pago Irwin - Parte Irwin
--   S Pago Maria   = valor - Pago Irwin
-- =====================================================================

drop view if exists v_lancamentos;

create view v_lancamentos as
select
  id,
  data,
  descricao,
  categoria,
  tipo,
  cat_original,
  fonte,
  valor_total,
  divisao,
  pct_irwin_custom,
  quem_pagou,
  obs,
  recorrente,
  eh_quitacao,
  de_fora,
  gasto_de,
  linha_origem,
  pct_irwin,
  serie_id,
  seq,
  criado_em,
  importacao_id,
  importacao_linha,

  -- Sem arredondamento, de propósito: a fórmula da planilha é multiplicação
  -- crua, e arredondar aqui produziria divergência sistemática de centavo.
  valor_total * pct_irwin                  as parte_irwin,
  valor_total - (valor_total * pct_irwin)  as parte_maria,

  pago_irwin,
  valor_total - pago_irwin                 as pago_maria,

  -- O acerto inteiro sai daqui: o que a pessoa desembolsou menos o que lhe
  -- coube. Positivo = Maria deve a Irwin.
  --
  -- NULL quando não há pagador definido. Desde a Versão 42 gravar assim é
  -- recusado, mas a leitura continua tolerando o histórico.
  -- `de_fora` zera o efeito: a compra passou pelo cartão, mas não é gasto do
  -- casal e não cria dívida entre os dois. Zero, e não NULL, porque NULL aqui
  -- já quer dizer outra coisa — lançamento sem pagador definido.
  case when de_fora then 0
       else pago_irwin - (valor_total * pct_irwin) end as saldo_irwin,

  extract(year  from data)::int            as ano,
  extract(month from data)::int            as mes
from lancamentos;

-- =====================================================================
-- v_series
--
-- O resumo de cada série numa linha só: quantas parcelas existem, de quando
-- até quando, quantas ainda estão no futuro, e o efeito acumulado no acerto.
--
-- Existe para a tela de série não precisar carregar todas as linhas só para
-- mostrar o cabeçalho — e para a lista conseguir dizer "3 de 12" sem ler a
-- série inteira.
-- =====================================================================

drop view if exists v_series;

create view v_series as
select
  s.id,
  s.tipo,
  s.descricao,
  s.total,
  s.recorrencia_id,
  s.origem,
  count(l.id)::int                                        as lancamentos,
  -- `total` é o que a série DECLARA ter; `lancamentos` é o que existe. Os dois
  -- divergem em 40 das 85 séries do histórico, porque nem toda compra foi
  -- lançada inteira. Faltar parcela é história, não defeito.
  (s.total is not null and count(l.id) = s.total)         as completa,
  min(l.data)                                             as primeira,
  max(l.data)                                             as ultima,
  count(l.id) filter (where l.data > current_date)::int   as futuras,
  sum(l.valor_total)                                      as total_valor,
  sum(l.pago_irwin - (l.valor_total * l.pct_irwin))       as saldo_irwin
from series s
left join lancamentos l on l.serie_id = s.id
group by s.id, s.tipo, s.descricao, s.total, s.recorrencia_id, s.origem;

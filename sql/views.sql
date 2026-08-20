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
  linha_origem,
  pct_irwin,

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
  pago_irwin - (valor_total * pct_irwin)   as saldo_irwin,

  extract(year  from data)::int            as ano,
  extract(month from data)::int            as mes
from lancamentos;

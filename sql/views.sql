-- =====================================================================
-- v_lancamentos — o que na planilha eram fórmulas de célula.
--
-- Cada expressão aqui é transcrição da fórmula REAL, lida da exportação XLSX
-- da planilha de produção (não do código: `moldeFormulas()` lê as fórmulas da
-- linha 6 em tempo de execução, então o texto delas só existe na planilha).
--
--   J Parte Irwin  =IF($G="","",IF($H="50/50",$G*0.5,IF($H="Renda",$G*Config!$C$6,
--                    IF($H="100% Irwin",$G,IF($H="100% Maria",0,
--                    IF($H="Custom",$G*$I,$G*0.5))))))
--   K Parte Maria  =IF($G="","",$G-$J)
--   M Saldo Irwin  =IF(OR($R="",$G=""),"",$R-$J)        -- R = Pago Irwin
--   S Pago Maria   =IF(OR($R="",$G=""),"",$G-$R)
--   O Ano          =IF($A="","",YEAR($A))
--   P Mês          =IF($A="","",MONTH($A))
--
-- Na planilha isso vivia como fórmula copiada da linha 6 a cada gravação. Foi
-- essa mecânica que, em 12/08/2026, deixou linhas novas nascerem com a fórmula
-- ANTIGA do Saldo Irwin e zerou o recurso de dois pagadores. Aqui não há
-- linha-molde, arrasto nem mapa posicional: a regra existe em um lugar só.
-- =====================================================================

drop view if exists v_lancamentos;

create view v_lancamentos as
with base as (
  select
    l.*,
    -- A tabela de casos, na ORDEM da fórmula. Duas diferenças em relação ao
    -- `pctIrwinDe()` do backend antigo, ambas resolvidas a favor da planilha,
    -- que é a fonte de verdade dos 3.503 lançamentos:
    --
    --   1. Custom usa a coluna DIRETO ($G*$I). O backend faz `/100`.
    --   2. O fallback é 0.5, não 'Renda'. (Na prática nunca dispara: não há
    --      uma única linha com divisão fora da lista conhecida.)
    case l.divisao
      when '50/50'       then 0.5::numeric
      when 'Renda'       then c.pct_irwin_renda
      when '100% Irwin'  then 1::numeric
      when '100% Maria'  then 0::numeric
      when 'Custom'      then coalesce(l.pct_irwin_custom, 0)
      else 0.5::numeric
    end as pct_irwin
  from lancamentos l
  cross join (select pct_irwin_renda from config where id = 1) c
)
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
  linha_origem,
  pct_irwin,

  -- ⚠️ SEM arredondamento, de propósito. A fórmula da planilha é multiplicação
  -- crua: não há ARRED/ROUND em lugar nenhum dela. Arredondar aqui produziria
  -- divergência sistemática de centavo contra a base real.
  valor_total * pct_irwin                        as parte_irwin,
  valor_total - (valor_total * pct_irwin)        as parte_maria,

  pago_irwin,
  valor_total - pago_irwin                       as pago_maria,

  -- O acerto inteiro sai daqui: quanto a pessoa desembolsou menos o que lhe coube.
  -- Positivo = Maria deve a Irwin.
  --
  -- NULL quando não há pagador definido — 19 linhas na base real estão assim, e
  -- ficam fora do acerto, exatamente como a fórmula devolvia texto vazio.
  pago_irwin - (valor_total * pct_irwin)         as saldo_irwin,

  extract(year  from data)::int                  as ano,
  extract(month from data)::int                  as mes
from base;


-- =====================================================================
-- Semântica preservada, inclusive a discutível.
--
-- `pct_irwin` do modo 'Renda' é lido do config ATUAL, não congelado no
-- lançamento: mudar a proporção reescreve retroativamente todo o histórico
-- dividido por renda. É o que a planilha faz hoje, e mudar agora quebraria a
-- reconciliação. Hoje o risco é teórico — não há nenhuma linha 'Renda'.
--
-- Decisão registrada para DEPOIS do cutover: congelar pct_irwin na gravação.
-- =====================================================================

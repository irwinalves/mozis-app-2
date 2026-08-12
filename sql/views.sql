-- =====================================================================
-- v_lancamentos — o que na planilha eram fórmulas de célula.
--
-- Na planilha, estas colunas viviam como fórmulas copiadas da linha 6 a cada
-- gravação (`garantirFormulas`). Isso gerou, em 12/08/2026, a classe de bug que
-- zerou o recurso de dois pagadores: as fórmulas vinham arrastadas muito além
-- da última linha preenchida, o atalho "já tem fórmula" dava sempre verdadeiro,
-- e a linha nova nascia com a fórmula ANTIGA do Saldo Irwin.
--
-- Aqui não há linha-molde, não há arrasto e não há mapa posicional de colunas.
-- A regra existe em um lugar só.
--
-- ⚠️ A SER CONFIRMADO NA RECONCILIAÇÃO: se a planilha arredonda `Parte Irwin`.
-- O texto das fórmulas não está no código — `moldeFormulas()` lê da célula M6
-- em tempo de execução. Se a planilha NÃO arredondar, a reconciliação vai
-- acusar divergências sistemáticas de 1 centavo, e a correção é tirar o round()
-- daqui. É exatamente para isso que o portão existe.
-- =====================================================================

drop view if exists v_lancamentos;

create view v_lancamentos as
select
  l.id,
  l.data,
  l.descricao,
  l.categoria,
  l.tipo,
  l.cat_original,
  l.fonte,
  l.valor_total,
  l.divisao,
  l.pct_irwin_custom,
  l.quem_pagou,
  l.obs,
  l.recorrente,
  l.linha_origem,

  -- % do Irwin conforme o modo de divisão. Mesma tabela de casos de
  -- `pctIrwinDe()` no backend antigo (Codigo.gs:52).
  case l.divisao
    when '50/50'       then 0.5::numeric
    when '100% Irwin'  then 1::numeric
    when '100% Maria'  then 0::numeric
    when 'Custom'      then coalesce(l.pct_irwin_custom, 0) / 100
    else c.pct_irwin_renda      -- 'Renda' e qualquer valor não reconhecido
  end as pct_irwin,

  round(
    l.valor_total *
    case l.divisao
      when '50/50'       then 0.5::numeric
      when '100% Irwin'  then 1::numeric
      when '100% Maria'  then 0::numeric
      when 'Custom'      then coalesce(l.pct_irwin_custom, 0) / 100
      else c.pct_irwin_renda
    end
  , 2) as parte_irwin,

  l.valor_total - round(
    l.valor_total *
    case l.divisao
      when '50/50'       then 0.5::numeric
      when '100% Irwin'  then 1::numeric
      when '100% Maria'  then 0::numeric
      when 'Custom'      then coalesce(l.pct_irwin_custom, 0) / 100
      else c.pct_irwin_renda
    end
  , 2) as parte_maria,

  l.pago_irwin,

  -- Espelha o par Parte Irwin / Parte Maria: um é entrada, o outro é o resto.
  l.valor_total - l.pago_irwin as pago_maria,

  -- O acerto inteiro sai daqui: quanto a pessoa desembolsou menos quanto lhe coube.
  -- Positivo = Maria deve a Irwin.
  --
  -- NULL quando não há pagador definido (pago_irwin NULL) — a linha fica fora do
  -- acerto, exatamente como a fórmula da planilha devolvia texto vazio.
  -- Esta é a forma NOVA, já vigente: antes era um SE aninhado que só existia
  -- para inferir o desembolso a partir de um pagador único.
  l.pago_irwin - round(
    l.valor_total *
    case l.divisao
      when '50/50'       then 0.5::numeric
      when '100% Irwin'  then 1::numeric
      when '100% Maria'  then 0::numeric
      when 'Custom'      then coalesce(l.pct_irwin_custom, 0) / 100
      else c.pct_irwin_renda
    end
  , 2) as saldo_irwin,

  extract(year  from l.data)::int as ano,
  extract(month from l.data)::int as mes

from lancamentos l
cross join (select pct_irwin_renda from config where id = 1) c;


-- =====================================================================
-- Nota de semântica preservada, inclusive a discutível.
--
-- `pct_irwin` para o modo 'Renda' é lido do config ATUAL, não congelado no
-- lançamento. Ou seja: mudar a proporção de renda reescreve retroativamente
-- todo o histórico dividido por renda. Provavelmente não é o desejado — mas é
-- o que a planilha faz hoje, e mudar agora quebraria a reconciliação.
--
-- Decisão registrada para DEPOIS do cutover: congelar pct_irwin no lançamento
-- no momento da gravação.
-- =====================================================================

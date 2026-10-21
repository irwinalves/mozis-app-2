# Pendências de tela — anotadas, ainda não feitas

Lista curta do que o Irwin apontou usando o app e que ainda não virou código.
Some daqui quando entrar; o histórico fica no git.

## 1. O "Editar" da série/recorrência é pequeno demais

**Onde:** tela de Recorrência e tela de Série (o cabeçalho com nome, valor,
nº de ocorrências e "Efeito acumulado no acerto").

**O que está:** um `Editar ›` verde, pequeno, no canto superior direito do card.

**O que ele quer:** um botão de verdade, **maior**, no lugar onde hoje está o
`Editar ›`, em **vermelho ou amarelo** — uma cor que sinalize "aqui você mexe
no que está vendo", em vez de se confundir com o resto do card.

> Cuidado de identidade visual: vermelho e amarelo já têm significado fixo no
> app — `Fixa #A63A2E` e `Variável #B8860B`. Um botão vermelho ao lado do selo
> `Fixa` vai competir. Levar duas opções para ele escolher antes de implementar,
> em vez de decidir por conta.

**Validação:** protótipo antes, celular depois. Como sempre.

## 2. Manual de uso da importação, para a Maria

**Por quê:** a importação de fatura já está em produção e o extrato vem a
seguir. Hoje só o Irwin sabe o caminho das pedras, e a conta é dos dois — a
parte dela precisa ser importável por ela.

**Formato:** passo a passo com **print de cada tela**, começando no Itaú:

1. Página inicial → `ver faturas` (card Cartões).
2. `consulta de fatura` → escolher o mês na régua (Paga / Aberta / Próxima).
3. `salvar planilha`, no canto do bloco `lançamentos`. É o `.xlsx` que o app lê.
4. Extrato: Home → `ver extrato` → aba `lançamentos` → `período personalizado`
   com data inicial e final → `filtrar`.
5. `salvar como` → **`salvar em OFX`** (o menu também oferece PDF, Excel, texto
   e OFX; o app lê OFX).

Depois segue nas telas do Mozis App: importar, revisar em abas, conferir os
estornos, salvar o lote, e como desfazer se errar.

**Os prints ficam em `docs/manual/prints/`.** Os do Itaú o Irwin já tirou —
faltam os das telas do app, que saem depois que o extrato estiver pronto.

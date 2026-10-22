# Pendências de tela — anotadas, ainda não feitas

O que o Irwin apontou usando o app e que ainda não virou código. Some daqui
quando entrar; o histórico fica no git.

---

## 1. Uma forma só de editar lançamento — hoje são três

**O que ele pediu (22/10):** a tela de **editar série** tem descrição, valor,
categoria, tipo, origem, quem paga e vigência — e só. Não dá para editar o
lançamento como ele realmente é. *"É praticamente a mesma tela de um lançamento.
Não sei por que a gente está fazendo uma outra tela."*

**Por que está assim, e isto é o ponto:** a tela de **Lançar continua no
`public/Form.html`**, em JS puro. As telas novas — `serie`, `importar`,
`importacao` — são React. Como não dá para reusar um formulário que vive em
HTML solto, cada tela nova **reconstruiu uma versão reduzida dele**. Não foi
escolha de produto; foi consequência da migração pela metade.

Hoje existem **três formulários do mesmo objeto**:

| Onde | Campos |
|---|---|
| `Form.html` · Lançar | data, descrição, valor, categoria, tipo, origem, pagador, divisão, % custom, pago por cada um, obs, gasto de, parcelar, repetir, fim da recorrência |
| `serie` · Editar série | descrição, valor, categoria, tipo, origem, divisão, quem paga, repete até, situação |
| `importar` · revisão | nome, categoria, quem pagou, divisão |

Isso é a **regra nº 3 do projeto** (uma implementação, nunca duas) violada em
três cópias. E o custo não é teórico: campo novo entra em uma e some nas outras.

**Consequência de planejamento:** migrar o Lançar para React deixa de ser a
Fase 6 "quando sobrar tempo" e vira **pré-requisito** do que ele quer. Feito
isso, série, importação e extrato passam a usar o mesmo componente.

---

## 2. Fragmentar uma linha da importação

**O que ele pediu:** poder lançar **parte** do valor de uma linha da fatura, ou
quebrá-la em pedaços com divisões diferentes. O caso que motivou: a **conta da
Vivo**, que ele paga e a mãe reembolsa — só um pedaço é gasto dele.

**Duas coisas diferentes estão embrulhadas aqui:**

- **2a · Quebrar a linha.** Uma linha da fatura vira N lançamentos, com valores,
  pagadores e divisões próprios. É trabalho de tela, e é direto.
- **2b · Adiantamento a terceiro.** "Paguei, mas não é meu gasto; fulano me
  devolve." **O app não tem esse conceito.** Já apareceu três vezes: a Vivo da
  mãe, as passagens Latam que a Maria reembolsou, e as transferências dela.
  Hoje a única saída é não lançar — que foi exatamente o que aconteceu com a
  Vivo. `gasto_de` classifica de quem é o custo, mas não cria o crédito a
  receber.

**Medo dele, e a boa notícia:** *"se eu não fizer essa observação na hora de
importar, eu vou perder esses lançamentos"*. **Não perde.** `importacoes.estado`
guarda a análise inteira — no lote 2 são **150 linhas e 5 descartadas**, com a
marcação de cada uma, contra 55 que viraram lançamento. As 95 que ficaram de
fora estão lá. O rascunho que ele pediu **já existe nos dados**; falta a tela
dizer "isto você deixou de fora" e deixar voltar nelas.

---

## 3. Aba de estornos, com o par compra ↔ estorno

**O que ele pediu (22/10):** hoje a importação **sinaliza** os estornos numa
seção recolhível, mas não deixa **tratar** nenhum. Ele quer uma aba própria
mostrando cada estorno **ao lado da compra a que se refere**, para poder decidir
na hora: *"não vou lançar isso, porque já está considerado o estorno"*.

**O que a fatura de setembro mostra**, que é a prova de que dá para fazer bem —
e de que não dá para fazer sozinho:

| Estorno | Compra correspondente | Caso |
|---|---|---|
| 13/08 `Shopee*…herbertelet` −19,99 | 13/08 `Shopee*…herbertelet` +62,98 | **mesma data, mesmo texto, uma só candidata** |
| 19/08 `Cancelamento Parcial De Compra - Brs*sheincom` −69,14 | 18/08 `Brs*sheincomsao Paulobr` +134,70 | **o lojista está no próprio texto do estorno** |
| 06/08 `Cancelamento Parcial De Compra - Apple.com/bill` −3,50 | **seis** compras Apple no mês (5,90 · 10,00 · 15,14 · 29,90 · 35,00 · 66,90) | **ambíguo** |
| 13/08 `Redução Mensalidade - Plano Do Cartão` −52,50 | nenhuma linha da fatura — casa com a **recorrência** | fora da fatura (A20) |
| `Pagamento Debito Automatico` −16.132,19 | — | não é estorno |

Cinco negativos, **cinco casos diferentes**. Daí o desenho:

- Onde o texto nomeia o lojista (`Cancelamento Parcial De Compra - X`) ou onde
  só existe uma candidata, a tela **mostra o par pronto**.
- Onde há várias candidatas do mesmo lojista, a tela **pergunta** em vez de
  adivinhar (C7). O Apple de R$ 3,50 não casa com valor nenhum das seis.
- O `Redução Mensalidade` não tem par na fatura: pertence à recorrência. É o
  mesmo buraco da A20 e da A22, visto de outro ângulo.

**Duas ações diferentes, e confundi-las erraria a conta:**

| | Compra | Estorno | O que fazer |
|---|---:|---:|---|
| Estorno **integral** | 62,98 | −62,98 | não lançar |
| Estorno **parcial** | 62,98 | −19,99 | lançar o líquido, 42,99 |

`src/lib/estornos.ts` já classifica em `integral · linha · parcial · solto` —
a lógica existe, falta a tela deixar agir sobre ela.

---

## 4. Buscar por data

Não existe filtro por data na busca. Ele quer **um dia** ou **um intervalo**,
com calendário — "entre o dia tal e o dia tal".

---

## 5. Filtro "dividido entre nós", e ele como padrão

**O que ele pediu:** ver só o que é dividido entre os dois; o que é de um só
fica oculto, com um botão para mostrar tudo. E que **esse seja o padrão**.

**O número que decide o desenho** — e ele contraria a intuição:

| | Linhas | |
|---|---:|---|
| Base inteira · dividido | 3.729 | **98,1%** |
| Base inteira · 100% de um | 73 | 1,9% |

No histórico o filtro esconderia quase nada. **Mas na importação a conta
inverte:** das 55 linhas do lote 2 da fatura de setembro, **47 são `100% de um`**
(43 Irwin, 4 Maria) e só 8 são 50/50.

Ou seja: o problema que ele sentiu é **real e é do futuro**, não do passado. A
lista era quase toda compartilhada porque vinha da planilha do casal; a partir
da importação de fatura ela passa a receber o extrato de compras pessoais. O
filtro precisa existir antes de a fatura de outubro entrar.

> Nome: "dividido entre nós" descreve o critério, mas o critério tem dois lados
> — divisão compartilhada **ou** pagamento dos dois. Decidir o rótulo junto com
> a regra, não depois.

---

## 6. O "Editar" da série/recorrência é pequeno demais

**O que está:** um `Editar ›` verde, pequeno, no canto do card.

**O que ele quer:** um botão maior, no mesmo lugar, em vermelho ou amarelo —
uma cor que sinalize "aqui você mexe no que está vendo".

> Cuidado de identidade visual: vermelho e amarelo já têm significado fixo —
> `Fixa #A63A2E` e `Variável #B8860B`. Um botão vermelho ao lado do selo `Fixa`
> vai competir. Levar duas opções para ele escolher.

---

## 7. Manual de uso da importação, para a Maria

A importação de fatura já está em produção e o extrato vem a seguir. Hoje só o
Irwin sabe o caminho das pedras, e a conta é dos dois.

Passo a passo com print de cada tela, começando no Itaú:

1. Página inicial → `ver faturas` (card Cartões).
2. `consulta de fatura` → escolher o mês na régua.
3. `salvar planilha`, no bloco `lançamentos`. É o `.xlsx` que o app lê.
4. Extrato: Home → `ver extrato` → `período personalizado` → `filtrar`.
5. `salvar como` → **`salvar em OFX`**.

Depois segue nas telas do app: importar, revisar em abas, conferir os estornos,
salvar o lote, e como desfazer se errar.

Os prints do Itaú estão em `docs/manual/prints/` (fora do git). Faltam os das
telas do app, que saem depois que o extrato estiver pronto.

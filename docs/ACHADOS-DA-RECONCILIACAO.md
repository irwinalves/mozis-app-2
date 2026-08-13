# Achados da reconciliação — 12/08/2026

Levantado ao traduzir a planilha `DRE - Casal - v2` para Postgres, comparando
**14.016 valores** (3.504 linhas × 4 colunas calculadas) contra o que a própria
planilha calculou, mais a conferência independente das células de resumo.

Resultado do portão: **0 divergências ao centavo**, maior delta bruto `2,27e-13`
— ruído de float64, como esperado numa planilha que não arredonda.

---

## 1. 🔴 Bug ativo na produção: a linha 5 é invisível para o app

**A linha 5 não é mais a linha-exemplo.** Hoje ela guarda um lançamento real:

| | |
|---|---|
| Descrição | `320k Milhas Azul 10/10` |
| Data | 2027-05-05 |
| Valor | R$ 485,10 · 50/50 · Irwin pagou |
| Saldo Irwin | **R$ 242,55** |

As linhas 6, 7 e 8 são as parcelas 9/10, 8/10 e 7/10 da mesma compra. A causa
provável é a reordenação da planilha por data — permitida desde a Versão 41 —,
que levou a parcela mais futura para o topo, na posição que era da linha-exemplo.

**Os dois lados discordam sobre essa linha:**

- `Acerto de Contas!C5` é `SUM('Lançamentos'!$M$5:$M$4997)` → a planilha **conta**.
- O backend usa `PRIMEIRA_LINHA = 6` → o app **não conta**.

**Impacto:** o app subestima em R$ 242,55 o que a Maria deve. E o efeito não é só
no acerto — `ultimosLancamentos`, `buscarLancamentos` e `getDashboard` também
começam na linha 6, então esse lançamento está invisível no app inteiro.

**Como o app novo trata:** lê a partir da linha 5, seguindo a planilha, que é a
fonte de verdade. Ver `PRIMEIRA_LINHA_DADOS` em `scripts/sync-from-sheets.ts`.

> Vale notar como isso apareceu: a reconciliação linha a linha passou com 0
> divergências **antes** de o problema ser encontrado — porque ela só compara as
> linhas que foram carregadas. Quem denunciou foi a conferência contra o resumo
> da própria planilha, que não fechou por exatos R$ 242,55.

---

## 2. As fórmulas reais (nenhuma arredonda)

Lidas da exportação XLSX, não do código: `moldeFormulas()` lê a linha 6 em tempo
de execução, então o texto delas só existe na planilha.

```
J Parte Irwin  =IF($G="","",IF($H="50/50",$G*0.5,IF($H="Renda",$G*Config!$C$6,
                 IF($H="100% Irwin",$G,IF($H="100% Maria",0,
                 IF($H="Custom",$G*$I,$G*0.5))))))
K Parte Maria  =IF($G="","",$G-$J)
M Saldo Irwin  =IF(OR($R="",$G=""),"",$R-$J)     -- R = Pago Irwin
S Pago Maria   =IF(OR($R="",$G=""),"",$G-$R)
```

**Não há `ARRED`/`ROUND` em nenhuma delas.** A primeira versão da view arredondava
para 2 casas por suposição; manter isso teria produzido divergência sistemática
de centavo contra a base real.

## 3. `% Irwin custom` é fração, e a unidade muda de camada

A coluna I guarda **fração** (`0.4`), não percentual (`40`) — a fórmula é `G*I`,
sem `/100`. Front e API falam percentual; `escreverLinha` converte com `/100`
antes de gravar. **As duas camadas estão certas**; o que não pode é dividir duas
vezes.

Consequência de schema: `pct_irwin_custom` é `numeric` **sem precisão declarada**.
O histórico do Splitwise traz valores como `0.39999999999999997` e
`0.06059005578102704`, vindos do rateio real de cada despesa. Um `numeric(5,2)`
truncaria isso e quebraria a reconciliação em silêncio.

## 4. Divergência real, hoje inofensiva: o fallback da divisão

Quando o modo de divisão não está na lista conhecida:

- a planilha cai em **`$G*0.5`** (metade);
- `pctIrwinDe()` no backend cai em **'Renda'** (`Config!C6`).

Hoje é teórico: das 3.504 linhas, só existem `50/50` (2.701), `Custom` (801) e
`100% Irwin` (1) — **nenhuma** fora da lista. A view segue a planilha.

## 5. Convenções medidas (não supostas)

| Coluna | Valores encontrados |
|---|---|
| Divisão | `50/50` 2.701 · `Custom` 801 · `100% Irwin` 1 |
| Quem pagou | `Irwin` 2.081 · `Maria` 1.402 · vazio 19 · `Ambos` 1 |
| Tipo | `Variável` 2.739 · `Fixa` 763 · `Investimento` 1 |

As 19 linhas sem pagador ficam corretamente fora do acerto (`pago_irwin` nulo →
`saldo_irwin` nulo). **Não existe nenhuma linha `Conjunta`** — confirma o
comentário do backend de que o rótulo antigo nunca chegou a ser usado.

## 6. O acerto difere da planilha em 1 centavo, por precisão

| | |
|---|---|
| Planilha (C9) | Maria deve ao Irwin **R$ 905,61** |
| App novo | **R$ 905,62** |

O valor exato é `905,615` — exatamente o ponto médio. O float64 da planilha
aterrissa em `905.61499999999796`, logo abaixo, e arredonda para baixo; o
`numeric` do Postgres é decimal exato e arredonda para cima. Nenhum dos dois está
errado, e o do Postgres é discutivelmente mais correto.

## 7. Bug meu, encontrado por resultado implausível

A primeira versão da reconciliação filtrava datas em JavaScript e os **três cortes
do acerto davam idênticos** — impossível, havendo 11 parcelas futuras somando
R$ 2.719,16.

Causa: o driver devolve `date` como `Date` em meia-noite **UTC**; interpolado numa
string virava `"Sun Apr 04 2027 21:00:00 GMT-0300…T00:00:00"` → `Invalid Date` →
a comparação era sempre falsa e nada era excluído. É a mesma armadilha de fuso que
`parseDataLocal` evita no outro sentido.

Corrigido movendo a comparação de datas para o Postgres. **A suíte de testes passou
o tempo todo** — quem pegou foi o número implausível.

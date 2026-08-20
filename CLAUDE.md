# Mozi's App 2.0

App de gestão financeira do casal. **Next.js + Postgres na Vercel.** Substituiu o
app em Google Apps Script + planilha, aposentado em 20/08/2026.

- **No ar:** https://mozis-app-2.vercel.app
- **Legado:** [mozis-app-legado](https://github.com/irwinalves/mozis-app-legado) — código preservado
- **As regras que atravessam a migração:** `PARA-O-APP-2.0.md`, no repositório do legado.
  **São 38, e valem mais que este arquivo.** Leia antes de mexer em regra de negócio.

## Regra número 1: o banco é a fonte de verdade

A planilha `DRE - Casal - v2` **não é mais fonte de nada** — é arquivo histórico
congelado no cutover.

> ⚠️ **`npm run sync` é DESTRUTIVO agora.** Ele faz `TRUNCATE` + carga completa a
> partir de uma exportação da planilha. Fazia sentido enquanto a planilha mandava;
> hoje apagaria tudo que foi lançado no app novo. Só contra banco descartável.

## Regra número 2: o `Form.html` não se edita

Ele é **byte a byte idêntico** ao do app antigo, e essa paridade é verificável por
hash. O que a tela precisa a mais — shim, ícones, manifest, foto no avatar de
"Ambos" — é **injetado em `src/app/route.ts`**.

Quando a reescrita em React começar, isso muda. Até lá, editar o arquivo quebra a
única propriedade que torna a migração auditável.

## Regra número 3: uma implementação, nunca duas

A regra que decide o percentual da divisão vive em `pctIrwinDe()`, em
`src/lib/lancamentos.ts`, e **só ali**. O resultado é gravado em
`lancamentos.pct_irwin`; a view `v_lancamentos` faz apenas aritmética.

Já esteve duplicada num `CASE` no SQL. Duas implementações da mesma regra divergem,
e quando divergem não há como saber qual está certa.

## Regra número 4: precisão de dinheiro não se supõe

`pago_irwin` e `pct_irwin_custom` são `numeric` **sem precisão declarada**. Metade
de um valor de centavo ímpar é meio centavo (`2193,63 / 2 = 1096,815`), e o
histórico do Splitwise tem percentuais com até 21 casas. `numeric(12,2)` truncava
os dois — e a reconciliação foi quem acusou, não o typecheck.

## Regra número 5: data se compara no Postgres

O driver devolve `date` como `Date` em **meia-noite UTC**. Interpolar numa string
e comparar em JavaScript dá `Invalid Date` em silêncio, e o filtro passa a não
excluir nada. Já escondeu 11 parcelas futuras fazendo os três cortes do acerto
darem idênticos — e **a suíte de testes passou o tempo todo**.

## Como testar (e por que isso mudou tudo)

Ao contrário do app antigo, este é uma **página normal**: a árvore de
acessibilidade funciona, o clique chega, e dá para exercitar a tela por automação.
Era impossível no iframe aninhado do Apps Script.

Mas a regra E1 continua valendo: **nada é pronto sem lançamento real conferido no
banco**, não na tela. Hash de código e teste de lógica pura não cruzam a junta
tela → API → banco, que é exatamente onde os bugs moram.

E a E5: **medir antes de corrigir, e dizer o número.** Toda correção de dado aqui
começou por uma varredura que respondia "quantas linhas estão assim".

## Onde está cada coisa

| Caminho | O que é |
|---|---|
| `src/lib/lancamentos.ts` | Lógica pura portada do Apps Script. 20 testes |
| `src/lib/api.ts` | Os métodos que o front chama |
| `src/lib/importacao.ts` | Parsers OFX/CSV/PDF |
| `src/lib/recorrencias.ts` | Gerador idempotente, com guarda anti-duplicata |
| `src/app/route.ts` | Serve o `Form.html` e injeta o que falta |
| `src/app/api/[metodo]/route.ts` | Rota única de RPC — a lista de métodos é a allowlist |
| `sql/views.sql` | `v_lancamentos` — só aritmética |
| `scripts/` | sync, reconcile, inspect |
| `docs/OPERACAO.md` | Operação, armadilhas e diagnóstico |
| `docs/ACHADOS-DA-RECONCILIACAO.md` | O que a migração descobriu, com números |

## Identidade visual (fixa)

Irwin `#1F4E79` · Maria `#6A1B9A` · Fixa `#A63A2E` · Variável `#B8860B` ·
Investimento `#2E6B2E` · Verde institucional `#2F5233`.

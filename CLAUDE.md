# Mozi's App 2.0

App de gestão financeira do casal. **Next.js + Postgres na Vercel.** Substituiu o
app em Google Apps Script + planilha, aposentado em 20/08/2026.

- **No ar:** https://mozis-app-2.vercel.app
- **Legado:** [mozis-app-legado](https://github.com/irwinalves/mozis-app-legado) — código preservado
- **As regras que este app pagou caro para descobrir:** `docs/INVARIANTES.md`.
  **São 42, e valem mais que este arquivo.** Leia antes de mexer em regra de negócio.
  `scripts/invariantes.ts` verifica 17 delas contra o banco — regra nova pede a
  pergunta: dá para checá-la por consulta?
- **Antes de mexer no front:** `docs/design/README.md` (tokens e a spec de cada tela)
  e `docs/design/BRIEFING-Claude-Design.md` (o *porquê* de cada regra). É a referência
  para migrar as telas que ainda vivem no `Form.html`. Os dois têm no topo o aviso do
  que ficou superado com a saída da planilha.

## Regra número 1: o banco é a fonte de verdade

A planilha `DRE - Casal - v2` **não é mais fonte de nada** — é arquivo histórico
congelado no cutover.

> ⚠️ **`npm run sync` é DESTRUTIVO agora.** Ele faz `TRUNCATE` + carga completa a
> partir de uma exportação da planilha. Fazia sentido enquanto a planilha mandava;
> hoje apagaria tudo que foi lançado no app novo. Só contra banco descartável.

## Regra número 2: o `Form.html` agora se edita — e o que isso custou para valer

**A paridade byte a byte terminou em 20/08/2026**, no commit que introduziu a tag do
André, a busca por valor, os filtros e a ordenação alfabética. Foi decisão explícita,
não descuido.

O último hash com paridade, para quem precisar comparar as duas telas algum dia:

```
1a47347dea94857156076097d9c2d4502b59de69fc4abe4870ae6d8876d4d913
```

Ele bate com `app-financeiro/Form.html` no repositório do legado, que segue preservado
inteiro. A auditabilidade não se perdeu: ela mora no git, não na igualdade dos arquivos
de trabalho.

**Por que a regra existiu.** Enquanto o arquivo fosse idêntico, qualquer diferença de
comportamento entre os dois apps vinha do backend e de nenhum outro lugar. Isso tornou
a migração verificável: 14.128 comparações linha a linha, 0 divergências.

**Por que acabou.** Essa propriedade já entregou o que tinha para entregar. Mantê-la
depois disso significaria empurrar toda feature nova para dentro de `src/app/route.ts`
como JavaScript injetado — e esse arquivo foi feito para acréscimos pequenos (shim,
ícones, manifest, a foto no avatar de "Ambos"), não para carregar lógica de produto.

**O que continua valendo.** As injeções que já existem em `route.ts` ficam onde estão;
não há motivo para trazê-las para dentro do HTML. E a regra 5 — **o front é o contrato**
— fica mais importante, não menos: agora que os dois lados podem mudar, `contrato.test.ts`
é o que impede que mudem em desacordo.

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

## Regra número 5: o front é o contrato

Enquanto o `Form.html` rodar sem alteração, **os nomes de campo que ele manda
mandam**. A API se adapta a eles — nunca o contrário.

Na prática isso inclui nomes que parecem errados fora de contexto: **`grupo`**
para categoria e **`quem`** para o dono do investimento, herdados do mapa `COL`
do backend Apps Script.

Ler `categoria` em vez de `grupo` fez gravar recusar com "Escolha a categoria"
mesmo com a categoria escolhida. E ler `deQuem` em vez de `quem` salvava
investimento **sem dono, em silêncio**.

`src/lib/contrato.test.ts` extrai os nomes do `Form.html` REAL e falha se o front
mudar. Os testes antigos chamavam a API com os nomes da própria API — eram
incapazes de detectar divergência de contrato, e passavam com o app quebrado.

> Quando duas partes precisam concordar sobre nomes, o teste tem que **derivar**
> de um dos lados, não repetir a suposição dos dois.

## Regra número 6: data se compara no Postgres

O driver devolve `date` como `Date` em **meia-noite UTC**. Interpolar numa string
e comparar em JavaScript dá `Invalid Date` em silêncio, e o filtro passa a não
excluir nada. Já escondeu 11 parcelas futuras fazendo os três cortes do acerto
darem idênticos — e **a suíte de testes passou o tempo todo**.

## Regra número 7: teste de tela clica nos controles reais

Setar o estado interno do formulário por código pula a validação do front — o
botão fica desabilitado e o clique cai no vazio, sem erro e sem sucesso. Já
custou um minuto de "a correção não funcionou" quando ela tinha funcionado.

**Clicar nos chips e digitar nos campos** é o que exercita o caminho completo.

## Como testar (e por que isso mudou tudo)

Ao contrário do app antigo, este é uma **página normal**: a árvore de
acessibilidade funciona, o clique chega, e dá para exercitar a tela por automação.
Era impossível no iframe aninhado do Apps Script.

Mas a regra E1 continua valendo: **nada é pronto sem lançamento real conferido no
banco**, não na tela. Hash de código e teste de lógica pura não cruzam a junta
tela → API → banco, que é exatamente onde os bugs moram.

E a E5: **medir antes de corrigir, e dizer o número.** Toda correção de dado aqui
começou por uma varredura que respondia "quantas linhas estão assim".

## Dois deploys, duas bases, uma trava só

O repositório é público e tem **dois** projetos na Vercel, do mesmo `main`:

| Projeto | URL | Banco | Login |
|---|---|---|---|
| `mozis-app-2` | mozis-app-2.vercel.app | ramo `main` do Neon | Google + lista de e-mails |
| `mozis-app-demo` | mozis-app-demo.vercel.app | ramo `demo` do Neon | **nenhum** |

A porta aberta do demo **não é uma variável de ambiente**. São duas chaves:
`MODO_DEMO=sim` e a tabela `demo_publico` no banco. Essa tabela não está em
migração nenhuma — quem a cria é `scripts/semear-demo.ts`. O banco do casal não
tem como responder "sim", então ligar a variável no projeto errado não abre nada.
Verificado por experimento: mesma build, mesma variável, ramo `demo` abre e `main`
devolve 307 para `/entrar` e 401 na API.

A mesma marca é a terceira trava do semeador: em host remoto com dados, ele só
apaga base já declarada de demonstração.

**Nunca aponte o semeador para o ramo `main`.** E ao mexer em `src/proxy.ts`
(era `middleware.ts` até o Next 16), refaça esse experimento nos dois lados antes
de publicar: é o arquivo que guarda o dinheiro de verdade.

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
| `docs/INVARIANTES.md` | As regras que o projeto pagou caro para descobrir |
| `docs/PENDENCIAS-DE-TELA.md` | O que o Irwin apontou usando o app e ainda não virou código |
| `docs/faturas/` | **Fora do git.** Faturas e extratos do banco, com índice no README |
| `docs/manual/` | Manual de uso da importação; os prints ficam fora do git |

## Identidade visual (fixa)

Irwin `#1F4E79` · Maria `#6A1B9A` · Fixa `#A63A2E` · Variável `#B8860B` ·
Investimento `#2E6B2E` · Verde institucional `#2F5233`.

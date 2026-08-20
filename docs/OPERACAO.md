# Operação — Mozi's App 2.0

O que fazer no dia a dia, e o que fazer quando algo parecer errado.

## Publicar

`git push` na `main` publica sozinho — o projeto está conectado ao repositório.
Para publicar sem commitar, `vercel deploy --prod`.

O build roda `next build`; se o typecheck falhar, o deploy falha e a versão
anterior continua no ar.

## Variáveis de ambiente

Vivem na Vercel (Project Settings → Environment Variables) e no `.env` local.
`.env.example` lista todas com explicação. Nenhuma vai para o Git.

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Postgres. **Sem precisão declarada nas colunas de dinheiro** — ver armadilhas |
| `AUTH_SECRET` | Assina a sessão |
| `AUTH_GOOGLE_ID` / `_SECRET` | OAuth. Origens e redirect ficam no console do Google |
| `EMAILS_PERMITIDOS` | Quem entra. **Lista vazia recusa todo mundo**, de propósito |
| `CRON_SECRET` | Protege `/api/cron/recorrencias` |

Ao mudar a URL do app, **os dois endereços precisam entrar no console do Google**:
origem JavaScript e URI de redirecionamento (`/api/auth/callback/google`).

## Recorrências

O cron chama `/api/cron/recorrencias` diariamente às 06:00 UTC (03:00 de Brasília).
Hobby limita a um disparo por dia; a função é **idempotente**, então rodar diário
é seguro e melhor que mensal.

Duas proteções, e as duas são necessárias:

1. `ultima_geracao` por regra, que impede voltar no tempo.
2. Uma **guarda anti-duplicata** que confere se já existe lançamento com mesma
   data, descrição e valor. Sem ela, regras ativas duplicadas ou uma
   `ultima_geracao` defasada geram lançamento em dobro — medido na base real.

Para forçar: `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/recorrencias`

## Carregar dados da planilha (fase de migração)

```bash
npm run sync -- "caminho/export.xlsx"        # TRUNCATE + carga completa
npm run reconcile -- "caminho/export.xlsx"   # confere linha a linha
```

O `sync` apaga tudo e recarrega. Era o certo **enquanto a planilha era a fonte de
verdade**. Depois do cutover isso deixa de valer: rodar `sync` agora **apagaria
tudo que foi lançado no app novo**.

> ⚠️ **Depois do cutover, `npm run sync` é destrutivo.** Só use contra um banco
> descartável.

## Armadilhas que custaram tempo

**Precisão de colunas de dinheiro.** `pago_irwin` e `pct_irwin_custom` são
`numeric` **sem precisão declarada**, e isso não é zelo excessivo:

- quando os dois pagam metade cada de um valor de centavo ímpar, o desembolso é
  **meio centavo** (`2193,63 / 2 = 1096,815`);
- o histórico do Splitwise traz percentuais com **até 21 casas decimais**.

Declarar `numeric(12,2)` truncava os dois e a reconciliação acusava. Ao adicionar
coluna de dinheiro, pense se ela pode carregar sub-centavo.

**Datas vêm do driver como `Date` em meia-noite UTC.** Interpolar numa string e
comparar em JavaScript produz `Invalid Date` silenciosamente — o filtro passa a
não excluir nada. **Compare datas no Postgres.** Foi assim que os três cortes do
acerto deram idênticos, escondendo 11 parcelas futuras.

**Região da função tem que casar com a do banco.** Com a função em `iad1` e o
banco em `sa-east-1`, cada consulta atravessava as Américas duas vezes: 907 ms no
dashboard contra 106 ms depois de fixar `gru1` no `vercel.json`. O sintoma é
latência alta e uniforme, sem nada de errado no SQL — e o `x-vercel-id` denuncia
(`gru1::iad1::` significa borda aqui, função lá).

**`next dev` força `NODE_ENV=development`.** Qualquer teste que dependa de
`NODE_ENV=production` precisa de build real (`npm run build && npm start`), senão
passa por engano.

## Quando algo parecer errado

| Sintoma | Onde olhar |
|---|---|
| Login falha em produção | Origens e redirect no console do Google; `AUTH_SECRET` definida |
| "Access Denied" ao entrar | O e-mail está em `EMAILS_PERMITIDOS`? E como usuário de teste no console? |
| Tudo lento e uniforme | `x-vercel-id` da resposta — a função pode estar fora de `gru1` |
| Primeira chamada do dia lenta | Banco suspenso (plano gratuito). ~1 s de cold start, depois normaliza |
| Recorrência não apareceu | Logs do cron na Vercel; `ultima_geracao` da regra |
| Número do acerto estranho | `npm run reconcile` contra uma exportação fresca — mas ver o aviso acima |

## O que ainda não foi provado

- **O cron nunca foi visto disparando sozinho.** Está registrado e habilitado, o
  endpoint responde e a lógica é idempotente — mas a invocação agendada pela
  Vercel não foi observada. Como todas as regras já geraram agosto, o primeiro
  efeito visível é **1º de setembro**.
- **A Maria nunca entrou.** Está na allowlist e como usuária de teste.
- **Uso real no celular.** Navegação e gravação foram testadas pelo navegador.

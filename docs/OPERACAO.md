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

## Recriar uma view não basta: as conexões abertas continuam com o schema antigo

**Sintoma:** você acrescenta uma coluna a `v_lancamentos`, confirma no banco que
ela existe, e mesmo assim a API devolve o campo **vazio** — não ausente, vazio.
Chamar a mesma função por um script novo funciona; pelo servidor, não.

**Causa:** o `postgres.js` usa *prepared statements*. Um `select * from
v_lancamentos` preparado ANTES do `drop view` / `create view` guarda o conjunto
de colunas de então. A conexão continua devolvendo aquelas colunas, e quem lê a
nova encontra `undefined`.

Foi exatamente o que aconteceu em 21/08/2026 com `gasto_de`: o servidor de
desenvolvimento estava no ar havia 26 horas, de antes da migração. O detalhe que
despistou é que o campo APARECIA na resposta — o `paraItem` tinha recarregado
por hot reload e criava a chave; só o valor vinha vazio.

**Como confirmar em um passo:** chame a função direto por um processo novo.

```bash
npx tsx --env-file=.env -e "import('./src/lib/api').then(async m => console.log(await m.ultimosLancamentos(5)))"
```

Se ali vier preenchido e pelo servidor não, é isto.

**Correção:** reinicie o servidor. Em produção o problema não se sustenta —
cada deploy sobe funções novas —, mas uma janela existe entre aplicar a view e
publicar o código: conexões vivas de antes seguem com o schema velho.

**Ordem segura:** aplicar a migração e a view, e só então publicar o código que
lê a coluna nova.

## Publicar não é chegar: o atalho da tela inicial guarda o HTML

**Sintoma:** uma correção sobe, o deploy fica `Ready`, e o defeito continua no
celular — exatamente igual. Você mede tudo no navegador, tudo está certo, e o
aparelho insiste em mostrar o comportamento antigo.

**Causa:** o app é usado como **atalho na tela inicial** (`display: standalone`
no manifest). Nesse modo o iOS guarda o HTML e **não oferece botão de
recarregar**. Se a resposta não disser o contrário, ele serve a versão que tem.

E a rota que serve o `Form.html` mandava só `Content-Type` — nenhuma instrução
de cache, então quem decidia era o cliente. Isso passou despercebido porque o
navegador de desenvolvimento revalida a cada carga.

Aconteceu em 22/08/2026 e custou uma investigação inteira no lugar errado: eu
procurava por que 16px "não bastavam" para impedir o zoom do iPhone, varri as
cinco telas com `getComputedStyle`, testei em 320px atrás de overflow — e a
correção já estava publicada havia um dia, sem nunca ter chegado ao aparelho.

**Correção, já aplicada:** `src/app/route.ts` envia
`Cache-Control: public, max-age=0, must-revalidate`. Não desliga o cache — mantém
o ETag e devolve 304 quando nada mudou, custando uma ida ao servidor em vez do
arquivo inteiro. É o mesmo cabeçalho que o Next manda nas páginas dele.

**Como forçar quando precisar**, em ordem de esforço: puxar a tela para baixo;
fechar o app no alternador (deslizar o cartão para cima) e reabrir; apagar o
atalho e recriar pelo Safari. Só o terceiro garante, porque descarta o cache do
web clip inteiro.

**A regra que fica:** ao verificar uma correção no aparelho, confirme primeiro
que o aparelho tem a versão nova. Um jeito barato é olhar algo inequívoco da
mudança antes de julgar o resto.

## A branch de teste (Neon + git)

Desde 22/08/2026 o trabalho de produto não sai direto para produção. São três
isolamentos, e os três precisam estar alinhados:

| Camada | Produção | Teste |
|---|---|---|
| git | `main` | `teste` |
| banco | Neon branch `main` | Neon branch `teste` |
| env | `.env` | `.env.teste` |

A branch do Neon é cópia-na-escrita: nasce com os lançamentos reais e só ocupa
espaço no que muda. Foi criada com **auto-delete `Never`** — o padrão de 1 dia é
curto demais para uma migração de semanas.

**A senha do papel `neondb_owner` é herdada da branch pai.** O `.env.teste` é o
`.env` com o host trocado, e nada mais:

```
ep-XXXXXXXX-pooler…   ← main (produção)
ep-YYYYYYYY-pooler…    ← teste
```

Os comandos com sufixo `:teste` apontam para lá:

```bash
npm run db:migrate:teste && npm run db:views:teste && npm run invariantes:teste
```

> ⚠️ Sem o sufixo, o comando fala com **produção**. `npm run invariantes` é só
> leitura e pode rodar em qualquer um; `backfill-series --aplicar` e
> `verificar-e2e` escrevem, e aí o sufixo é a diferença entre um ensaio e um
> incidente.

**Para jogar a branch fora e recomeçar:** apagar no console do Neon e criar de
novo a partir de `main`. É o jeito de voltar ao estado limpo depois de uma fase.

## O preview da branch `teste`

```
https://mozis-app-2-git-teste-mozi5.vercel.app
```

A URL é **estável por branch** — não muda a cada deploy, e é por isso que ela
pôde ser registrada uma vez no OAuth do Google. Deploys novos saem de qualquer
push para `teste`.

**Três camadas antes de o app abrir**, e as três são de propósito:

| Porta | O que é | Quem passa |
|---|---|---|
| SSO da Vercel | proteção de deployment | quem está logado na conta Vercel |
| `/entrar` | o Auth.js do próprio app | Irwin e Maria, pelo Google |
| `EMAILS_PERMITIDOS` | a allowlist de dois e-mails | os mesmos dois |

**O banco do preview é a branch `teste` do Neon**, não produção. Foi trocado
pela CLI, porque a variável é *sensitive* e não se lê de volta pela interface:

```bash
npx vercel env rm DATABASE_URL preview --yes
grep '^DATABASE_URL=' .env.teste | cut -d= -f2- | tr -d '\n' | npx vercel env add DATABASE_URL preview
```

> ⚠️ Variável de ambiente **não entra em build já feito**. Trocar a
> `DATABASE_URL` e não redeployar deixa o preview falando com produção — que é
> exatamente o que a branch existe para evitar. Depois de trocar, empurre um
> commit.

**Como saber, sem logar, em qual banco o preview está:** a tabela `series` só
existe na branch `teste`. Se a tela de série abre, é a `teste`. Se fosse
produção, a consulta falharia — e essa é também a rede de segurança: a
funcionalidade de séries não tem como tocar produção enquanto a migração não
for aplicada lá.

**OAuth do Google.** O redirect do preview foi acrescentado ao cliente
`Mozi's App` (projeto `formal-hybrid-443104-s3`):

```
https://mozis-app-2-git-teste-mozi5.vercel.app/api/auth/callback/google
```

São três agora — localhost, produção e o preview. O Google avisa que a
propagação leva de cinco minutos a algumas horas.

# Mozi's App 2.0

Gestão financeira do casal Irwin & Maria. Substitui o app em Google Apps Script +
planilha, que rodou de julho a agosto de 2026 e vive preservado em
[mozis-app-legado](https://github.com/irwinalves/mozis-app-legado).

**No ar:** https://mozis-app-2.vercel.app

## O que é

| Peça | Escolha |
|---|---|
| Hospedagem | Vercel, função fixada em `gru1` (São Paulo) |
| Banco | Neon Postgres, `sa-east-1` (São Paulo) |
| Backend | Next.js App Router — rota única de RPC em `/api/[metodo]` |
| Front | `public/Form.html`, servido sem alteração sobre um shim |
| Auth | Auth.js + Google, allowlist de dois e-mails |
| Recorrências | Vercel Cron diário, idempotente |

**Latência medida em produção** (mediana de 5 chamadas), contra o log de Execuções
do Apps Script:

| Chamada | Antes | Agora |
|---|---|---|
| `getOpcoes` | 1.400–3.300 ms | 238 ms |
| `ultimosLancamentos` | 4.100–4.500 ms | 113 ms |
| `getAcertoContas` | 5.100–5.800 ms | 117 ms |
| `getDashboard` | 4.800–5.200 ms | 106 ms |

## A decisão que explica o resto: o front não foi reescrito

O `Form.html` do app antigo entra aqui **byte a byte idêntico**, e roda sobre
`public/gs-shim.js` — ~60 linhas que reimplementam `google.script.run` com `fetch`.
O front chamava o backend em 15 pontos, todos no mesmo formato, então o shim
substitui a camada inteira sem tocar nas 1.557 linhas de tela.

Isso permitiu que a migração fosse verificável: a paridade do front é conferível
por hash, e qualquer divergência de comportamento só podia vir do backend.

O que a tela precisa a mais — o shim, os ícones, o manifest e a foto no avatar de
"Ambos" — é **injetado em `src/app/route.ts`**, não editado no arquivo.

## Como rodar

```bash
npm install
cp .env.example .env && cp .env .env.local   # preencher
npm run db:migrate && npm run db:views
npm run sync -- "baseline/DRE-Casal-v2-2026-08-20.xlsx"
npm run dev
```

Para exercitar sem credencial OAuth, `AUTH_BYPASS_DEV=sim` no `.env`. Tem trava
dupla e é inerte em produção — conferido contra build real.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor local |
| `npm test` | 20 testes da lógica pura |
| `npm run db:generate` | Gera migração a partir de `src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrações |
| `npm run db:views` | Recria `v_lancamentos` |
| `npm run sync -- <xlsx>` | Carga total a partir de uma exportação da planilha |
| `npm run reconcile -- <xlsx>` | Compara banco × planilha, linha a linha |
| `npm run inspect -- <xlsx>` | Inspeciona uma exportação (fórmulas, convenções) |

## Onde as regras moram

- **Cálculo da divisão:** `pctIrwinDe()` em `src/lib/lancamentos.ts`, e **só ali**.
  O resultado é gravado em `lancamentos.pct_irwin`; a view faz apenas aritmética.
- **Regras de negócio:** as 38 regras herdadas estão em
  [`PARA-O-APP-2.0.md`](https://github.com/irwinalves/mozis-app-legado/blob/main/PARA-O-APP-2.0.md)
  no repositório do legado.
- **O que a migração descobriu:** [`docs/ACHADOS-DA-RECONCILIACAO.md`](docs/ACHADOS-DA-RECONCILIACAO.md)
- **Como operar:** [`docs/OPERACAO.md`](docs/OPERACAO.md)

## O que este app NÃO herdou, de propósito

Três coisas do app antigo eram **contorno**, não regra, e foram removidas depois
de terem sido portadas por engano:

- **Assinatura de conteúdo** para identificar um lançamento — existia porque não
  havia id. Aqui `id` é chave primária.
- **Quitação reconhecida pelo texto da categoria** — virou a coluna `eh_quitacao`;
  a string é interpretada em um ponto só, na entrada.
- **A regra de divisão duplicada** em código e em fórmula — agora existe uma vez.

## Estado

Reconciliação sobre o retrato de 20/08/2026: **3.532 lançamentos, 14.128
comparações, 0 divergências ao centavo**, com o acerto fechando exato em
R$ 5.130,59 contra o resumo da própria planilha.

# Briefing — Sistema de gestão financeira do casal

> ⚠️ **O que aqui já não vale.** Este handoff foi escrito em 07/2026, quando o app
> rodava em Google Apps Script sobre uma planilha. O produto é o mesmo; a tecnologia
> não. Ao ler:
>
> - **Vale integralmente:** os design tokens (§4 do README), a especificação de cada
>   tela (§5), as interações (§6), e todo o *porquê* das regras de negócio no BRIEFING.
>   É a referência para migrar as telas que ainda vivem no `Form.html`.
> - **Superado:** tudo que descreve a planilha como base de dados, o backend em
>   Apps Script e os passos de publicação. A base é Postgres, o deploy é a Vercel a
>   cada `git push`, e as regras que sobreviveram estão em `docs/INVARIANTES.md`.
> - **Os números do BRIEFING §6** são de julho de 2026 e serviam para dimensionar o
>   design. Não são a base atual.
>
> Mudou do repositório do legado para cá em 28/08/2026: o design é do produto, e o
> produto vive aqui.


**Para:** Claude Design
**De:** Irwin (e Maria)
**Objetivo:** desenhar a aplicação de gestão financeira descrita abaixo.

Este documento reúne todo o contexto de um trabalho anterior em que a base de
dados, o modelo de categorias e um app funcional de lançamento foram
construídos. O que falta é **design**: a camada visual e de experiência do
sistema completo.

---

## 1. Contexto

Irwin e Maria são um casal em Belo Horizonte. Dividem despesas há anos usando
uma combinação de Splitwise + planilhas de Excel que foram crescendo sem
estrutura — a última tinha três esquemas de categoria concorrendo entre si e
dezenas de erros `#REF!`.

O histórico consolidado tem **3.625 transações entre dez/2017 e nov/2026**,
somando **R$ [redigido]** em gastos. Hoje gastam cerca de **R$ [redigido]/ano**.

### A visão descrita pelo Irwin

> "Um sistema de gestão unificado dos nossos gastos do casal, onde monitorasse
> nossos e-mails para identificar compras, invoices e notas fiscais, cadastrasse
> num repositório único, que a gente conseguisse também cadastrar os gastos em
> dinheiro e no cartão, e ver o que temos de investimento e de gasto no banco.
> Para conseguir fazer projeções e identificar onde está o gasto maior, de uma
> maneira visual."

### Restrições reais (importantes para o escopo do design)

Três coisas dessa visão **não** são tecnicamente possíveis como imaginadas, e o
design não deve prometê-las:

| Desejo | Realidade |
|---|---|
| Monitoramento contínuo de e-mail | Só funciona sob demanda, quando o usuário pede. Nada roda em segundo plano 24/7. |
| Conexão direta com o banco | Exige Open Finance via Pluggy/Belvo ou app tipo Mobills. O que dá pra fazer é importar extrato exportado (OFX/CSV). |
| Categorização automática perfeita | Depende da qualidade da descrição. No histórico real, 51% caiu em "Outros" por falta de informação. |

O design deve, portanto, tratar **entrada manual como caminho principal** e
importação/e-mail como caminhos auxiliares e assistidos.

---

## 2. O que já existe

### 2.1 Planilha (Google Sheets) — a base de dados

Sete abas, todas ligadas por fórmulas. Nenhum número é digitado duas vezes.

| Aba | Função |
|---|---|
| **Config** | Painel único: % de divisão por renda, rendas anuais |
| **Plano de Contas** | 8 categorias, tipo padrão e cor de cada uma |
| **Lançamentos** | Base de dados. 3.430 gastos, 16 colunas, fórmulas até a linha 5000 |
| **Visão Mensal** | 108 meses × fixo/variável + 8 colunas por categoria |
| **Visão Anual** | Blocos de fixas/variáveis/investimentos com subtotais e % |
| **Visão por Pessoa** | Três recortes: por ano, por categoria, por mês |
| **Acerto de Contas** | Saldo corrente entre os dois + registro de quitações |
| **Investimentos** | Cadastro de contas, movimentos (aportes/resgates) e dívidas |
| **Patrimônio** | Posição mensal por conta, rendimento e patrimônio líquido |

### 2.2 App de lançamento (Google Apps Script)

Web app mobile já funcional, que grava direto na planilha. Tem:
formulário de lançamento, seleção de divisão, parcelamento com prévia,
e lista dos últimos lançamentos.

**É justamente este app que precisa de design.** O atual é funcional, mas
visualmente básico — CSS escrito à mão, sem sistema de design.

---

## 3. Modelo de dados

### 3.1 Plano de contas

São **8 categorias**, consolidadas a partir de 11 porque a entrada no celular
estava lenta demais. O critério foi tema, não tipo de custo.

| Cód | Categoria | Tipo padrão | O que absorveu |
|---|---|---|---|
| 1 | Casa | **Fixa** | Moradia + Serviços domésticos + Casa |
| 2 | Carro | Variável | Carro + Transporte |
| 3 | Comida | Variável | — |
| 4 | Saúde | Variável | — |
| 5 | Lazer & Pessoal | Variável | Lazer + compras, beleza, streaming, presentes |
| 6 | Viagem | Variável | — |
| 7 | Outros | Variável | resíduo a reclassificar |
| 8 | Investimentos | Isolado | — |

**Decisão estrutural importante:** o Tipo (Fixa/Variável) deixou de ser derivado
da categoria e virou **campo próprio de cada lançamento**, com padrão sugerido
pela categoria mas editável. Sem isso não seria possível juntar Carro (fixa) com
Transporte (variável) sem quebrar o relatório de fixo vs variável. Na prática:
dentro de "Casa", o aluguel é Fixa e a decoração é Variável.

Investimentos fica fora do resultado operacional — não é gasto, é patrimônio
mudando de lugar.

### 3.2 Estrutura de um lançamento

| Campo | Origem | Observação |
|---|---|---|
| Data | usuário | |
| Descrição | usuário | |
| Categoria | usuário (menu) | vem do Plano de Contas (8 opções) |
| **Tipo** | usuário (menu) | Fixa/Variável/Investimento — padrão pela categoria |
| Categoria original | importação | preservada do Splitwise |
| Fonte | usuário (menu) | Cartão, Dinheiro, Extrato, Email, Mozi, Família |
| Valor total | usuário | |
| **Divisão** | usuário (menu) | 50/50 · Renda · 100% Irwin · 100% Maria · Custom |
| % Irwin custom | usuário | só quando Divisão = Custom |
| **Parte Irwin** | calculado | sempre visível |
| **Parte Maria** | calculado | sempre visível |
| Quem pagou | usuário (menu) | Irwin, Maria, Conjunta — alimenta o acerto |
| **Saldo Irwin** | calculado | pagou − consumiu. Positivo = tem a receber |
| Obs | usuário | |
| Ano / Mês | calculado | auxiliares dos relatórios |

---

## 4. Regras de negócio

### 4.1 Divisão de despesas

Requisito textual do Irwin:

> "Gostei de deixar que ajustemos a divisão e isso reflita nos lançamentos
> seguintes. Mas preciso que fique claro na planilha como foi a divisão em cada
> transação e dar a opção de colocarmos um gasto 100% meu ou 100% dela."

Como funciona:

- Existe um **default configurável**: proporção por renda, hoje
  **49,47% Irwin / 50,53% Maria** (derivada de R$ [redigido] e R$ [redigido]/ano).
  Fica numa célula única; ao mudar, tudo recalcula.
- Cada transação pode ter divisão própria, escolhida entre cinco modos.
- As colunas **Parte Irwin** e **Parte Maria** são sempre visíveis — a divisão
  nunca fica implícita.

### 4.2 Parcelamento

Foi a principal dor operacional relatada:

> "Uma dificuldade que temos é o retrabalho de cadastrar parcelas de um mesmo
> gasto. Seria legal escolher em quantas vezes foi pago e o valor total ou da
> parcela, e ele já cadastrar cada parcela em uma linha."

Regras implementadas:

- Usuário informa **nº de parcelas** e diz se o valor digitado é **o total** ou
  **o valor da parcela**.
- Gera uma linha por parcela, descrição numerada (`Sofá 1/6`, `Sofá 2/6`…).
- **Arredondamento:** a última parcela absorve a diferença.
  R$ 1.000 em 3x → 333,33 + 333,33 + **333,34**. Soma fecha exata.
- **Fim de mês:** 31/01 → 28/02 → **31/03** (volta pro dia 31, não trava no 28).
- **Virada de ano:** novembro em 4x atravessa para fevereiro seguinte.
- Prévia das parcelas aparece **antes** de salvar.

### 4.3 Acerto de contas — o sistema substitui o Splitwise

Transferências entre eles **não são despesa**: ficam fora de qualquer relatório
de gasto, senão inflam o DRE com dinheiro que só trocou de mão.

O saldo corrente é calculado assim:

```
Saldo por lançamento = quanto a pessoa pagou − quanto coube a ela
Saldo final = Σ lançamentos − acertos pagos pela Maria + acertos pagos pelo Irwin
```

Positivo significa que a Maria deve ao Irwin. A aba mostra a frase pronta
("Maria deve ao Irwin R$ X" / "Estão quites").

Detalhe importante: os 3.430 lançamentos históricos **não entram no saldo**,
porque vieram do Splitwise sem a informação de quem adiantou o dinheiro. O saldo
nasce zerado e passa a valer a partir do primeiro lançamento feito pelo app. Por
isso o campo "Quem pagou" é obrigatório na entrada.

### 4.4 Investimentos — modelo diferente do de despesas

Gasto é **fluxo** (o dinheiro sai e acabou). Investimento é **estoque** (muda de
bolso e depois rende sozinho, sem gerar transação). Por isso não cabe na mesma
tabela.

O modelo tem duas partes:

1. **Movimentos** — aportes e resgates, que são eventos datados
2. **Posição mensal** — o saldo de cada conta, anotado uma vez por mês
   lendo do app do banco (ritual de 5 minutos)

E a conta que quase todo controle caseiro erra:

```
Rendimento do mês = saldo final − saldo inicial − aportes + resgates
```

É ela que separa "cresceu porque aportamos" de "cresceu porque rendeu".

Há também um registro de **dívidas** (saldo devedor dos financiamentos), para
calcular **patrimônio líquido = investimentos − dívidas**.

---

## 5. Identidade visual (já definida — manter)

O princípio é que **o dado nasce colorido e chega colorido no relatório**. A
mesma cor identifica a mesma coisa em toda parte.

### 5.1 Pessoas

| Pessoa | Cor forte | Cor clara |
|---|---|---|
| **Irwin** | `#1F4E79` (azul-marinho) | `#D9E7F5` |
| **Maria** | `#6A1B9A` (roxo) | `#EADCF5` |

### 5.2 Tipo de custo

| Tipo | Cor forte | Cor clara |
|---|---|---|
| **Fixa** | `#A63A2E` (vermelho-tijolo) | `#F6DCD8` |
| **Variável** | `#B8860B` (dourado) | `#FBEED0` |
| **Investimento** | `#2E6B2E` (verde) | `#D8EBD8` |
| **Entrada** | `#0F6E56` (verde-água) | `#D6EFE6` |

### 5.3 Categorias

| Categoria | Cor forte | Cor clara |
|---|---|---|
| 1 Casa | `#2F5597` | `#D9E2F3` |
| 2 Carro | `#1F7A6B` | `#D5EFEA` |
| 3 Comida | `#4E8C2A` | `#DFF0D2` |
| 4 Saúde | `#B23A3A` | `#F7D9D9` |
| 5 Lazer & Pessoal | `#B5407A` | `#F7D9EA` |
| 6 Viagem | `#1B7FA8` | `#D4EBF5` |
| 7 Outros | `#6E6E6E` | `#E8E8E8` |
| 8 Investimentos | `#2E6B2E` | `#D8EBD8` |

Verde institucional do sistema: `#2F5233`.

---

## 6. Dados reais para dimensionar o design

Números verdadeiros — úteis para popular mockups com realismo.

### Volume
- 3.430 lançamentos de gasto · 192 acertos · 108 meses de histórico
- R$ [redigido] em gastos acumulados
- Gasto anual estabilizado: ~R$ [redigido] (2022 em diante)
- Gasto mensal típico: R$ [redigido]

### Evolução do peso das despesas fixas
2022: 30,2% · 2023: 35,3% · 2024: 36,3% · **2025: 40,6%**

Tendência de alta consistente. Quanto maior a fatia fixa, menor a folga para
ajustar o orçamento num mês apertado. **Este é provavelmente o indicador mais
importante a destacar no design.**

### Divisão acumulada entre os dois
Irwin R$ [redigido] (51%) · Maria R$ [redigido] (49%) — bem equilibrado no total.

Mas com assimetrias claras por categoria:

| Categoria | Irwin | Maria | Maior |
|---|---|---|---|
| Casa | [redigido] | [redigido] | Maria |
| Carro | [redigido] | [redigido] | Maria |
| Comida | [redigido] | [redigido] | empate |
| Saúde | [redigido] | [redigido] | Irwin |
| Viagem | [redigido] | [redigido] | Maria |
| Outros | [redigido] | [redigido] | Irwin |

### Ressalva honesta
"10 Outros" concentra R$ [redigido] dos dois somados — quase metade do total. Isso
porque 72% do histórico do Splitwise estava na categoria genérica "Geral" com
descrições curtas demais para reclassificar. **O design deveria incluir uma
forma fácil de reclassificar lançamentos em lote**, porque essa é a maior
alavanca de clareza disponível hoje.

---

## 7. O que precisa ser desenhado

### 7.1 App mobile de lançamento (prioridade 1)

Já funciona, precisa de design. Deve continuar cobrindo:

**Fluxo principal — lançamento rápido**
Valor → descrição → categoria → tipo (já vem preenchido) → data → origem →
quem pagou → como dividir → salvar.
Otimizar para velocidade: é usado em pé, no mercado, com uma mão.

O campo **Tipo** aparece já preenchido pela categoria; o usuário só toca nele
quando a exceção acontece (ex.: um móvel dentro de "Casa" é Variável, não Fixa).
O desafio de design é deixá-lo visível sem parecer mais um campo a preencher.

**Fluxo de parcelamento**
Toggle → nº de parcelas → "o valor é o total ou a parcela?" → prévia → salvar.
A prévia precisa deixar óbvio quantas linhas serão criadas e em que meses.

**Estados a considerar:** carregando, salvando, sucesso (com nº de parcelas e
total), erro de validação, offline.

**Detalhe de identidade:** os seletores de "quem pagou" e "como dividir" devem
usar as cores de Irwin e Maria — é o que torna a divisão legível num relance.

### 7.2 Dashboard visual (prioridade 2 — nunca foi desenhado)

Nunca saiu do papel. É o pedido original do Irwin: *"identificar o que temos de
gasto maior, de uma maneira visual"*. Deveria mostrar:

- Fixo vs variável no mês, com comparação contra a média
- Evolução do % de despesas fixas ao longo do tempo (o indicador crítico)
- Gasto por categoria, com as cores do sistema
- Quem é o "maior ofensor" em cada categoria
- Projeção de gastos futuros (as parcelas já lançadas permitem isso)
- Patrimônio: investimentos e saldo em banco

### 7.3 Telas auxiliares (prioridade 3)

- **Reclassificação em lote** — resolver o problema dos 51% em "Outros"
- **Importação de extrato** (OFX/CSV) com categorização assistida
- **Revisão de e-mails** — Claude extrai compras e o usuário confirma numa fila
- **Acerto de contas** — saldo corrente, com botão de quitar
- **Investimentos** — aportes, posição mensal por conta e evolução do patrimônio

---

## 8. Restrições técnicas

- O backend é **Google Apps Script** ligado a uma planilha Google. O front é HTML
  servido por `HtmlService` — não há build, não há npm, não há framework.
  Bibliotecas externas precisam vir por CDN.
- A comunicação front↔back é `google.script.run` (assíncrona, sem REST).
- Roda dentro de um iframe do Google. Isso limita algumas APIs de navegador.
- Precisa funcionar bem como **PWA adicionada à tela de início** (iOS Safari e
  Android Chrome), inclusive respeitando `safe-area-inset`.
- Dois usuários simultâneos possíveis — há lock no backend para evitar colisão.
- A planilha precisa ser **Google Sheets nativa**, não `.xlsx`.

---

## 9. Princípios que guiaram o trabalho até aqui

Vale manter no design:

1. **Nada de número digitado duas vezes.** Tudo que pode ser calculado, é.
2. **A divisão nunca fica implícita.** Sempre visível quanto coube a cada um.
3. **Uma fonte de verdade por configuração.** A proporção de renda mora numa
   célula só — foi a proliferação de valores repetidos que gerou os `#REF!`
   na planilha antiga.
4. **Cor carrega significado, não decoração.** Mesma cor = mesma coisa, em
   qualquer tela.
5. **Honestidade sobre a qualidade do dado.** Onde a classificação é um palpite,
   isso deve ficar visível — e não maquiado como precisão.

---

## 10. Arquivos de referência

Disponíveis junto deste briefing:

- `DRE - Casal - v2.xlsx` — a planilha completa com dados e relatórios
- `Codigo.gs` — backend do app (Apps Script)
- `Form.html` — front-end atual, o que precisa ser redesenhado
- `COMO-INSTALAR.md` — guia de deploy do app

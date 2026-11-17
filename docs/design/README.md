# Handoff: App de Gestão Financeira do Casal (Irwin & Maria)

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


> Pacote de handoff para implementação via **Claude Code**. O objetivo final é
> colocar o app no ar: substituir o `Form.html` atual (feio, CSS à mão) por esta
> nova interface, mantendo o backend Apps Script que já funciona.

---

## 1. Overview

App PWA mobile de gestão financeira de um casal. Registra despesas, divide os
gastos entre as duas pessoas, controla o acerto de contas (substitui o
Splitwise), importa extratos, registra investimentos e mostra um dashboard
visual. O protótipo desta pasta cobre 5 telas navegáveis:

1. **Início** — saldo do acerto de contas, resumo fixo/variável do mês, atalho de importação e lista de lançamentos recentes.
2. **Lançar** — formulário de novo gasto, com divisão entre as pessoas e parcelamento com prévia.
3. **Investir** — formulário próprio para aportes/resgates (modelo diferente de despesa).
4. **Dashboard** — gráficos de fixo vs. variável, evolução do % de fixas, gasto por categoria, maior "ofensor", ritmo de gasto e patrimônio.
5. **Importar extrato** — upload de OFX/CSV e lançamento em lote atribuído a uma pessoa.

---

## 2. Sobre os arquivos de design

Os arquivos desta pasta são **referências de design feitas em HTML** — um
protótipo que mostra o visual e o comportamento pretendidos, **não** código de
produção para copiar e colar.

- `Sistema Financeiro do Casal.dc.html` — o protótipo. É um "Design Component"
  (React + runtime próprio, `support.js`). **Não** rode isso em produção. Use-o
  só como referência visual e de comportamento.
- `ios-frame.jsx` — moldura de iPhone usada só para apresentar o protótipo.
  **Ignore** na implementação: o app real ocupa a tela inteira do navegador.
- `BRIEFING-Claude-Design.md` — briefing original com modelo de dados, regras de
  negócio e números reais. **Leia antes de começar.**

### Alvo da implementação (importante)

O ambiente de produção **já está definido no briefing** e não deve ser trocado:

- Backend: **Google Apps Script** (`Codigo.gs`) ligado a uma planilha Google.
- Front: **HTML servido por `HtmlService`** — sem build, sem npm, sem framework.
  Bibliotecas externas só via CDN.
- Comunicação front↔back: **`google.script.run`** (assíncrona, sem REST).
- Roda dentro de um **iframe do Google**; algumas APIs de navegador são limitadas.
- Precisa funcionar como **PWA na tela de início** (iOS Safari e Android Chrome),
  respeitando `safe-area-inset`.
- Lock no backend para dois usuários simultâneos.

**A tarefa é recriar este design como um novo `Form.html`** (HTML/CSS/JS puro,
ou uma lib leve via CDN como Preact/Alpine se ajudar), servido por `HtmlService`,
e ligá-lo às funções `google.script.run` já existentes. Não introduza um bundler.

---

## 3. Fidelidade

**Alta fidelidade (hifi).** Cores, tipografia, espaçamentos e interações são
finais. Recrie a UI fielmente. A estética-alvo é de **ferramenta Google** (limpa,
funcional, Roboto, fundo branco, bordas finas cinza, sombras discretas).

---

## 4. Design tokens

### Tipografia
- Família: **Roboto** (Google Fonts), fallback `Arial, sans-serif`.
- Pesos: 400 (texto), 500 (títulos/valores/labels ativos), 700 (raro).
- Tamanhos usados: 20px (título da tela), 15px (valor grande / itens), 14px (corpo/inputs), 13px (títulos de card / chips), 12px (labels de campo), 11px (legendas), 10px (metadados discretos).

### Cores base (tom neutro / Google)
| Uso | Hex |
|---|---|
| Fundo do app | `#FFFFFF` |
| Fundo fora do device (palco) | `#EDEEF0` |
| Texto principal | `#202124` |
| Texto secundário | `#5f6368` |
| Texto terciário / metadados | `#9aa0a6` |
| Borda de input | `#DADCE0` |
| Borda de card / divisória | `#EBEBEB` / `#F1F1F1` |
| Chip neutro (fundo) | `#EDEEF0` |
| Cinza de fundo suave (cards de nota) | `#F8F9FA` |
| **Verde institucional (primário: botões, tab ativa)** | `#2F5233` |

### Pessoas (cor forte / cor clara)
| Pessoa | Forte | Clara |
|---|---|---|
| Irwin | `#1F4E79` | `#D9E7F5` |
| Maria | `#6A1B9A` | `#EADCF5` |
| Conjunta (neutro) | `#5f6368` | `#F1F3F4` |

### Tipo de custo
| Tipo | Forte | Clara |
|---|---|---|
| Fixa | `#A63A2E` | `#F6DCD8` |
| Variável | `#B8860B` | `#FBEED0` |
| Investimento | `#2E6B2E` | `#D8EBD8` |
| Entrada | `#0F6E56` | `#D6EFE6` |

### Categorias (8) — código, forte, clara, tipo padrão
| Cód | Categoria | Forte | Clara | Tipo padrão |
|---|---|---|---|---|
| 1 | Casa | `#2F5597` | `#D9E2F3` | Fixa |
| 2 | Carro | `#1F7A6B` | `#D5EFEA` | Variável |
| 3 | Comida | `#4E8C2A` | `#DFF0D2` | Variável |
| 4 | Saúde | `#B23A3A` | `#F7D9D9` | Variável |
| 5 | Lazer & Pessoal | `#B5407A` | `#F7D9EA` | Variável |
| 6 | Viagem | `#1B7FA8` | `#D4EBF5` | Variável |
| 7 | Outros | `#6E6E6E` | `#E8E8E8` | Variável |
| 8 | Investimentos | `#2E6B2E` | `#D8EBD8` | Investimento |

> Princípio de identidade: **cor carrega significado, não decoração**. A mesma
> cor identifica a mesma coisa em toda tela (pessoa, tipo, categoria).

### Espaçamento, raio e formas
- Raio: 8px (inputs, chips, botões, tiles), 10-12px (cards), 999px (pílulas / dots / avatares).
- Padding de card: 14px. Padding de input: 10-12px. Gap entre chips: 8px.
- Divisórias: `1px solid #F1F1F1` entre itens de lista.
- Sombra: praticamente ausente — usar bordas em vez de sombra.
- Barra inferior de navegação: `border-top: 1px solid #EBEBEB`, `padding: 8px 0 22px` (o 22px extra é a área do `safe-area-inset-bottom`).
- Topo: reservar ~54px para a status bar/notch (no device real, usar `env(safe-area-inset-top)`).

---

## 5. Telas / Views

Layout geral (todas as telas): coluna flex de altura total →
**header fixo** (título + avatares I/M) · **conteúdo rolável** (`flex:1; overflow:auto; padding:16px`) · **tab bar inferior** (4 abas).

### 5.1 Header
- Altura de conteúdo, `padding: 8px 20px 14px`, borda inferior `#EBEBEB`.
- Esquerda: título da tela (20px/500 `#202124`). Nas telas secundárias (Importar) aparece um "‹" (22px, `#5f6368`) antes do título que volta ao Início.
- Direita: dois avatares circulares 26px — Irwin `#1F4E79` "I" branco; Maria `#6A1B9A` "M" branco.

### 5.2 Tab bar (4 abas)
- Abas: **Início · Lançar · Investir · Dashboard**.
- Cada aba: dot 6px acima do label 11px. Ativa: dot `#2F5233` + label `#2F5233`/500. Inativa: dot transparente + label `#5f6368`/400.
- "Importar extrato" **não** é aba: é alcançada por um botão no Início; ao entrar, a aba Início continua marcada como ativa.

### 5.3 Início
Ordem vertical:
1. **Card de acerto de contas**: fundo `#F8F9FA` (ou `#F1F3F4` se quites), borda `#E0E0E0`, raio 10. Label "Acerto de contas" (12px `#5f6368`) + frase (15px/500). Frase gerada: `"Maria deve a Irwin R$ X"`, `"Irwin deve a Maria R$ X"` ou `"Estão quites."`.
2. **Dois tiles fixo/variável do mês** lado a lado (gap 10). Fixo: fundo `#F6DCD8`, valor `#A63A2E`. Variável: fundo `#FBEED0`, valor `#B8860B`.
3. **Botão "↥ Importar extrato do cartão"**: borda `#DADCE0`, raio 8, texto `#2F5233`/500 centralizado. Vai para a tela Importar.
4. **Lista "Lançamentos recentes"**: cada linha = coluna de data (dia 15px/500 + mês abreviado 10px maiúsc. `#9aa0a6`, largura 40px, centralizada) · dot 6px na cor da categoria · descrição (14px, truncada) + "Categoria · Tipo" (10px `#9aa0a6`) · valor (14px/500) + "I R$… · M R$…" (10px `#9aa0a6`) à direita.

> **Hierarquia pedida pelo usuário**: a **data** é o elemento mais destacado do
> item; categoria e tipo ficam pequenos e discretos.

### 5.4 Lançar (novo gasto)
Ordem dos campos (a **data é o primeiro campo**):
1. **Data** — `<input type="date">`.
2. **Valor** — input numérico grande (20px) com prefixo "R$".
3. **Descrição** — texto.
4. **Categoria** — chips (7 categorias; **sem "Investimentos"**, que tem tela própria). Chip selecionado: fundo cor forte + texto branco; não selecionado: fundo cor clara + texto `#333`. Selecionar categoria **preenche o Tipo** com o padrão dela.
5. **Tipo** — chips **Fixa / Variável** (padrão pela categoria, editável). Cores do tipo (forte quando ativo, clara quando não).
6. **Origem** — chips **Cartão / Pix** (segmentado, flex:1). Ativo: `#2F5233`/branco.
7. **Quem pagou** — chips **Irwin / Maria / Conjunta** nas cores das pessoas (forte quando ativo).
8. **Como dividir** — chips **50/50 · Por renda · 100% Irwin · 100% Maria · Custom**. Ativo: `#2F5233`/branco. Em "Custom", aparece um slider 0-100 (`accent-color:#2F5233`) com label "Irwin N%".
9. **Parte Irwin / Parte Maria** — dois tiles sempre visíveis, calculados ao vivo. Irwin: fundo `#D9E7F5`, texto `#1F4E79`. Maria: fundo `#EADCF5`, texto `#6A1B9A`.
10. **Card de parcelamento** — borda `#EBEBEB`. Toggle "Parcelar esse gasto" (switch: trilho `#2F5233` ligado / `#DADCE0` desligado; thumb branco 18px). Quando ligado: stepper de nº de parcelas (2-24, botões − / + circulares `#F1F3F4`) · segmento "É o total / É a parcela" · **prévia** com uma linha por parcela (descrição numerada, mês/ano, valor), scroll até 150px.
11. **Botão Salvar** — `#2F5233`/branco quando válido (valor > 0 e descrição preenchida); `#DADCE0`/`#8a8a8a` quando inválido.

Ao salvar: mostra overlay de sucesso (ver 5.7), reseta valor/descrição/parcelamento.

### 5.5 Investir
1. **Banner** (fundo `#D8EBD8`, texto `#2E6B2E`): "Investimento não é gasto — é patrimônio mudando de lugar. Fica fora do resultado de despesas."
2. **Data** — `<input type="date">` (**primeiro campo**).
3. **Movimento** — chips **Aporte / Resgate** (verde: ativo `#2E6B2E`/branco, inativo `#D8EBD8`/`#2E6B2E`).
4. **Valor** — input "R$" grande.
5. **Instituição / conta** — texto (ex.: XP, Nubank, Tesouro Direto).
6. **Classe do ativo** — select: Renda fixa · Renda variável · Fundos · Previdência · Cripto.
7. **De quem é o aporte** — chips Irwin / Maria / Conjunta (cores das pessoas).
8. **Botão "Registrar movimento"** — verde `#2E6B2E` quando válido (valor > 0 e conta preenchida).
9. **Nota** (fundo `#F8F9FA`): "A posição de cada conta é anotada 1x por mês… O rendimento é calculado: saldo final − inicial − aportes + resgates."

### 5.6 Importar extrato
- Estado 1 (nada carregado): **dropzone** tracejado (`1.5px dashed #DADCE0`, raio 12) com "↥ / Toque para selecionar / Extrato exportado em OFX ou CSV" + nota de que conexão direta com o banco não existe.
- Estado 2 (carregado): 
  - "Lançar todas as N transações como" → chips **Irwin / Maria / Conjunta** (cores das pessoas). **Default: Conjunta.**
  - Quando **Conjunta** está selecionado, aparece um seletor "Como dividir entre os dois": **Por renda** (padrão) / **50/50**.
  - Nota de honestidade: categoria é sugerida pela descrição; o não identificado cai em "Outros".
  - **Lista de transações** do extrato: coluna de data · descrição (estilo fatura, ex. "IFOOD *RESTAURANTE") + tag de categoria (pílula na cor clara/forte da categoria) · valor.
  - **Botão** "Lançar N transações · R$ total" (`#2F5233`).
- Mapa de atribuição no confirm:
  - Irwin → divisão `100% Irwin`, quem pagou = Irwin.
  - Maria → divisão `100% Maria`, quem pagou = Maria.
  - Conjunta → divisão = a escolhida (`Por renda` padrão, ou `50/50`), quem pagou = Conjunta.

### 5.7 Overlay de sucesso
Cobre a área de conteúdo (fundo branco), centralizado: círculo 56px `#D6EFE6` com check `#0F6E56` · título (17px/500) · mensagem (13px `#5f6368`) · botão "Ver lançamentos" (`#2F5233`) que volta ao Início.
Títulos por origem: "Lançamento salvo", "Movimento registrado", "Extrato importado".

### 5.8 Dashboard (rolável)
Cards, de cima pra baixo:
1. **Fixo vs. variável do mês** — duas barras horizontais empilhadas (Fixa `#A63A2E`, Variável `#B8860B`): "Este mês" (opaca) e "Média do ano" (opacidade 0.6). Legenda embaixo.
2. **Evolução do % de despesas fixas** — mini gráfico de barras por ano (2022: 30,2% · 2023: 35,3% · 2024: 36,3% · 2025: 40,6%), barras `#A63A2E`, com o valor em cima e o ano embaixo. Legenda: "O indicador mais importante do sistema". **Barras com altura em px** (não %), senão colapsam num container de altura indefinida.
3. **Gasto por categoria (histórico)** — barras horizontais na cor forte de cada categoria, largura proporcional ao maior. A ordem das categorias por volume: Outros, Casa, Comida, Carro, Viagem, Saúde. Os valores saem do banco; a ordem de grandeza está na seção 6 do briefing.
4. **Maior "ofensor" por categoria** — linhas com dot da categoria + badge na cor da pessoa vencedora (ou "Empate" neutro): Casa→Maria, Carro→Maria, Comida→Empate, Saúde→Irwin, Viagem→Maria, Outros→Irwin.
5. **Ritmo de gasto** — total do ano (`#2F5233`, 20px) + a faixa mensal logo abaixo. Dimensionar para seis dígitos.
6. **Patrimônio** — Investimentos / Dívidas / Patrimônio líquido (valores "—" até integrar a posição mensal). Nota do ritual de 5 min.
7. **Nota de honestidade** sobre "Outros" concentrar quase metade do total.

---

## 6. Interações & comportamento

- Navegação por abas troca a tela sem recarregar; "Importar" e o overlay de sucesso são estados dentro da mesma SPA.
- Chips e toggles são de seleção imediata (sem confirmar).
- **Cálculo de partes** (ao vivo): `% Irwin` por modo → 50/50 = 50; Por renda = **49,47%** (default configurável); 100% Irwin = 100; 100% Maria = 0; Custom = valor do slider. `parteIrwin = valor × %/100`; `parteMaria = valor − parteIrwin`.
- **Parcelamento**:
  - "É o total": `parcelaBase = floor(valor/n, 2 casas)`; **última parcela absorve a diferença** (`valor − parcelaBase×(n−1)`). Ex.: R$ 1.000 em 3x → 333,33 + 333,33 + **333,34**.
  - "É a parcela": cada parcela = valor; total = valor×n.
  - **Datas**: a parcela `i` cai em `dataBase + i meses`, com o dia **clampado** aos dias do mês (31/01 → 28/02 → **31/03**; volta pro dia original quando o mês comporta). Atravessa a virada de ano.
  - Descrição numerada: `"Sofá 1/6"`, `"Sofá 2/6"`…
  - **Prévia antes de salvar**, deixando claro quantas linhas e em quais meses.
- **Acerto de contas**: `saldo por lançamento = quanto a pessoa pagou − quanto coube a ela`. "Conjunta" **não** entra no saldo (não houve adiantamento individual). Positivo para Irwin ⇒ "Maria deve a Irwin". Os lançamentos históricos importados do Splitwise **não entram** no saldo (sem "quem pagou").
- **Estados**: este protótipo cobre só o fluxo feliz. Em produção, implementar loading/salvando, sucesso (já há), erro de validação e offline (PWA).
- **Validação**: Salvar (gasto) exige valor > 0 e descrição; Registrar (investimento) exige valor > 0 e conta.

---

## 7. Estado (mapa para produção)

Variáveis de estado do protótipo (nomes livres na implementação):
- `tab`: `home | new | invest | dashboard | import`; `showSuccess`.
- `entries[]`: lançamentos { data, descrição, categoria(1-8), tipo, origem, valor, divisão, %custom, quemPagou }.
- `form{}`: campos do gasto em edição + `parcelado`, `parcelas`, `valorTipo(total|parcela)`.
- `invest{}`: movimento(Aporte|Resgate), conta, classe, valor, data, quem.
- `import{}`: `loaded`, `quemPagou(default Conjunta)`, `divisao(default renda)`, `rows[]`.

Em produção, o estado vive no front (SPA leve); a **fonte de verdade é a
planilha**. Toda gravação vai por `google.script.run`.

---

## 8. Backend / dados (do briefing)

- 8 categorias (tabela acima). **Tipo é campo próprio do lançamento**, com padrão sugerido pela categoria, mas editável.
- Estrutura do lançamento: Data, Descrição, Categoria, Tipo, Categoria original (importação), Fonte, Valor total, Divisão, %Irwin custom, **Parte Irwin** (calc.), **Parte Maria** (calc.), Quem pagou, **Saldo Irwin** (calc.), Obs, Ano/Mês (calc.).
- Default de divisão por renda: **49,47% Irwin / 50,53% Maria**, mora numa célula única (fonte de verdade); ao mudar, tudo recalcula.
- Investimentos = modelo separado (Movimentos + Posição mensal + Dívidas), fora do resultado operacional.
- Ligar aos métodos `google.script.run` já existentes no `Codigo.gs` (formulário de lançamento, parcelamento, últimos lançamentos). Onde faltar endpoint (investimentos, importação, dashboard), criar no Apps Script seguindo o padrão existente (com o lock de concorrência).

### Restrição a respeitar no design
Não prometer o que não é viável: monitoramento de e-mail é **sob demanda**;
banco é **importação de extrato** (OFX/CSV), não conexão direta; categorização é
**assistida**, não perfeita — deixar a incerteza visível.

---

## 9. Passos sugeridos para colocar no ar (Claude Code)

1. Ler `BRIEFING-Claude-Design.md` e este README por completo.
2. Abrir o projeto Apps Script existente (`Codigo.gs` + `Form.html`). Confirmar os nomes das funções `google.script.run` disponíveis.
3. Recriar as telas deste protótipo como um **novo `Form.html`** em HTML/CSS/JS puro (Roboto via CDN Google Fonts; opcional Preact/Alpine via CDN se ajudar). Sem bundler.
4. Aplicar os design tokens da seção 4 e os layouts da seção 5 fielmente.
5. Ligar as ações (salvar gasto, parcelar, registrar investimento, importar, dashboard) às funções do backend; criar as que faltarem no `Codigo.gs`.
6. Garantir PWA: `<meta name="viewport">` com `viewport-fit=cover`, `env(safe-area-inset-*)`, manifest/ícone, `apple-mobile-web-app-capable`.
7. Testar dentro do iframe do Google e como app na tela de início (iOS/Android).
8. Deploy: **Implantar → Nova implantação → App da Web** e atualizar a versão.

---

## 10. Arquivos nesta pasta

- `README.md` — este documento (auto-suficiente).
- `Sistema Financeiro do Casal.dc.html` — protótipo de referência (não é produção).
- `ios-frame.jsx` — moldura de apresentação (ignorar na implementação).
- `BRIEFING-Claude-Design.md` — briefing original com modelo de dados e regras.
- `screenshots/` — capturas de cada tela para referência visual:
  - `01-inicio.png` — Início (acerto de contas, resumo do mês, recentes)
  - `02-lancar.png` — Novo lançamento (data em primeiro, categorias)
  - `03-investir.png` — Novo investimento
  - `04-dashboard.png` — Dashboard (fixo vs. variável, evolução do % de fixas)
  - `05-importar-dropzone.png` — Importar extrato (estado inicial)
  - `06-importar-lote.png` — Importar extrato (lote com atribuição e divisão)

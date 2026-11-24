# Invariantes — as regras que este app pagou caro para descobrir

Cada regra aqui **custou um defeito real**, quase sempre um que levou dias para ser
entendido. O arquivo existe para que nenhuma delas seja redescoberta pelo mesmo caminho.

Não é documentação do app — para isso existe o `README.md` e o `docs/OPERACAO.md`. Aqui
está o que precisa **continuar valendo** enquanto o app existir, independentemente da
tecnologia embaixo.

## Como ler

Cada item tem três partes, e é isso que o torna acionável:

> **A regra**, dita como comportamento — não como trecho de código de um backend.
> **O que quebra sem ela** — o defeito real que aconteceu, com número medido quando há.
> **Como provar que está valendo** — o teste que pega aquela classe de erro.

Um item só entra depois de ter causado um defeito de verdade ou de ter sido uma decisão
tomada contra uma alternativa que parecia melhor. **Não é lista de boas intenções.**

**Regra de manutenção:** todo defeito novo corrigido entra aqui, não só nas Decisões do
Notion. Os dois têm papéis diferentes — o Notion guarda o *porquê* e a narrativa; este
arquivo guarda o que precisa **sobreviver à troca de tecnologia**.

## Quantas estão verificadas por máquina

61 regras escritas. **`scripts/invariantes.ts` verifica 17 delas contra o banco real**,
e `npm test` verifica mais nove contra a forma do front (`src/lib/tela.test.ts`),
e é por isso que os dois têm o mesmo nome: a distância entre os dois números é a medida
de quanto ainda depende de alguém lembrar.

Quando uma regra nova entrar aqui, a pergunta seguinte é sempre a mesma — **dá para
checá-la por consulta?** Se der, ela vira invariante executável. Foi assim que a
duplicação das doze parcelas da Adaptaorg (A16) apareceu: nenhum teste de tela a pegou,
o ciclo ponta a ponta passou verde, e o invariante `duplicatas` a mostrou.

## De onde este arquivo veio

Escrito em 20/08/2026, no repositório do app em Apps Script, como carta de despedida na
migração — *"o que o próximo app tem que herdar"*. O próximo app é este, e as regras
deixaram de ser herança para virar o que são hoje: as regras da casa. Mudou de
repositório e de nome em 28/08/2026, quando ficou claro que **as correções novas nasciam
aqui e eram commitadas lá**.

O que era remendo do modelo antigo e **não** foi herdado, de propósito:

- A **assinatura de conteúdo para identificar um lançamento** (B2) — contorno para um
  modelo sem id. Aqui cada lançamento tem `id` de verdade.
- **Reconhecer quitação pelo texto da categoria** (A11) — virou a coluna `eh_quitacao`.
- **Toda a Parte D.** São restrições do Google Sheets, e sumiram com a planilha. Ficam
  registradas para o caso de o problema equivalente reaparecer de outra forma.
- **Fórmulas na planilha como motor de cálculo** (A2, B5). Foi a decisão certa *lá*,
  porque a planilha era a fonte de verdade. Aqui o cálculo voltou para o código —
  mantendo o princípio: **uma implementação só, nunca duas que podem divergir**.

---

## Parte A — Modelo de dados e regras de negócio

É o que o app **é**. Se o 2.0 não reproduzir isto, é outro produto.

### A1. A divisão nunca é implícita

**Regra:** quanto cabe a cada pessoa está **sempre visível** — na tela de lançamento, na
lista e na base. Nunca é um cálculo que só o sistema conhece.

**Se violada:** o casal perde a confiança no número. O app inteiro existe para responder
"quanto é meu e quanto é seu"; esconder isso atrás de uma conta invisível derrota o
propósito.

### A2. Um número, um lugar

**Regra:** cada parâmetro mora em **um** lugar só. A proporção de divisão por renda é uma
célula de configuração; tudo que pode ser derivado é derivado, não digitado de novo.

**Se violada:** foi exatamente a proliferação de valores repetidos que encheu a planilha
anterior de `#REF!` e motivou a reconstrução. Valor copiado é valor que vai divergir.

### A3. Quem paga e quem deve são duas coisas diferentes

**Regra:** o modelo guarda **quanto cada pessoa desembolsou** como dado próprio, separado
de **quanto coube a cada pessoa**. Uma transação admite **dois pagadores com valores
diferentes**.

**Se violada:** não dá para registrar "o aluguel: eu pus uma parte e ela pôs outra" sem
inventar uma transação falsa. E o cálculo do saldo vira um `SE` aninhado tentando
adivinhar o desembolso a partir de um campo de pagador único — foi o que este app teve,
e a fórmula colapsou numa subtração simples assim que o dado passou a existir de verdade.

**Como provar:** os três casos antigos (pagou tudo A, pagou tudo B, cada um a própria
parte) continuam dando o mesmo número, e o caso assimétrico novo passa a existir.

### A4. Todo lançamento precisa de um pagador

**Regra:** gravação sem pagador definido é **recusada** — na tela **e** no servidor.

**Se violada:** a linha nasce sem "quem pagou", fica fora do acerto de contas e **o gasto
aparece no resultado mas não na dívida entre os dois**. Sem erro, sem aviso: o saldo
simplesmente não fecha e ninguém sabe por quê.

Medido em 18/08/2026: **19 lançamentos** nesse estado, de 2020 a 2026. Nenhum tinha sido
percebido. Foram corrigidos à mão; a base está hoje com zero, então o 2.0 herda o
histórico limpo e só precisa **manter** a regra.

**Como provar:** tentar gravar sem pagador por todas as portas — tela, API e importação em
lote. Todas recusam. E varrer a base: nenhuma linha com valor e sem pagador.

> A checagem tem que morar no **servidor**. A tela é uma das portas; importação, gatilhos
> e funções futuras entram por outras.

> **Ao corrigir dado assim:** preencher só o **rótulo** do pagador não basta se o valor
> que entra no acerto for um campo de entrada separado. Tem que preencher os dois.

### A5. Tipo (Fixa/Variável) é campo do lançamento, não da categoria

**Regra:** cada lançamento carrega o próprio tipo. A categoria dá um **padrão**, e o
padrão é editável.

**Se violada:** não dá para ter "Casa" contendo aluguel (fixa) e decoração (variável) sem
quebrar o relatório de fixo vs. variável — que é um dos poucos números que o casal
realmente acompanha.

### A6. Parcelar e repetir são modelos diferentes e não se combinam

**Regra:** **parcela fraciona um valor**; **recorrência repete o valor cheio**. São
mutuamente exclusivos na tela, e todo gasto recorrente é **Fixa**.

**Se violada:** "parcelar em 12 e repetir todo mês" não tem significado único — e
qualquer interpretação que o sistema escolher vai estar errada para metade dos casos.

### A7. A última parcela absorve o arredondamento

**Regra:** a soma das parcelas fecha **exatamente** com o valor total. A diferença de
centavos vai toda na última.

**Se violada:** 100 em 3× vira 33,33 × 3 = 99,99, e o acerto passa a ter um centavo de
erro por parcelamento — que ninguém rastreia e todos percebem.

**Como provar:** somar as parcelas de vários valores quebrados e conferir que fecham.

### A8. Datas somam com clamp de fim de mês, nos dois sentidos

**Regra:** somar meses **preserva o dia com clamp**: 31/01 → 28/02 → **31/03**. Volta ao
dia original quando o mês comporta.

**Se violada:** ou o parcelamento anda para 03/03 (transbordo), ou trava no dia 28 para
sempre depois de passar por fevereiro.

**Como provar:** parcelamento de 12× começando em 31/01 e em 31/03, e atravessando a
virada de ano.

### A9. Rateio digitado uma vez se distribui, não se repete

**Regra:** o rateio entre dois pagadores é informado sobre o **total**. Num
**parcelamento** vira uma **proporção** aplicada a cada parcela, com a última absorvendo o
arredondamento (A7). Numa **recorrência** cada ocorrência é o valor cheio, então o
**mesmo** rateio se repete.

**Se violada:** ou cada parcela recebe o rateio inteiro (multiplica a dívida), ou a
recorrência divide o rateio entre as ocorrências (dilui a dívida).

**Como provar:** a soma do desembolso das parcelas fecha com o valor digitado; numa
recorrência de N ocorrências, cada uma tem o rateio original.

> **O padrão quando o rateio não é informado** — importação em lote, gatilho de
> recorrência, qualquer entrada que não passa por tela — é **"cada um pôs a própria
> parte"**, ou seja, efeito zero no acerto. É o comportamento certo: sem informação sobre
> quem desembolsou, presumir dívida seria inventar dado. Presumir zero é conservador e
> visível.

### A10. Recorrência indefinida é regra + geração incremental idempotente

**Regra:** recorrência **sem data fim** não vira linhas de uma vez. Vira uma **regra**
guardada, mais um gatilho que gera as ocorrências pendentes e **anota até onde já gerou**.

**Se violada:** ou o sistema tenta gravar infinitas linhas, ou o gatilho duplica tudo toda
vez que roda.

**Como provar:** rodar o gatilho duas vezes seguidas e confirmar que a segunda não cria
nada. É a propriedade que importa: **rodar de novo é seguro**.

> **Quinzenal é "a cada 14 dias", não "2× por mês em dias fixos".** Mantém a mesma lógica
> do semanal (soma dias) e não exige campo novo na tela. As duas leituras existem no
> mundo real; esta foi escolhida de propósito, então o 2.0 não precisa reabrir a
> discussão — só saber que foi decidida.

### A11. Quitação não é despesa

**Regra:** o pagamento de uma dívida entre os dois **não é um gasto**. Fica fora dos
relatórios de despesa, e na lista aparece **visualmente diferente** de um gasto.

**Se violada:** ou entra no resultado do mês como se fosse consumo, ou se confunde
visualmente com um gasto comum — a pessoa lê o valor e não sabe se gastou ou se quitou.

**Como provar:** o total de despesas do mês não muda ao registrar uma quitação; e na lista
ela se distingue à primeira vista, dizendo a direção (quem pagou a quem).

> **No 2.0: modele quitação como um tipo próprio de registro**, não como despesa numa
> categoria especial. Hoje ela é reconhecida casando o texto da categoria em quatro
> lugares — funciona, e é string mágica.

### A12. Investimento não é despesa

**Regra:** investimento tem **modelo separado** — movimentos, posição mensal e dívidas —
e fica fora do resultado de despesas e do acerto.

**Se violada:** um aporte vira "gasto do mês" e o relatório de consumo do casal fica sem
sentido.

**O porquê, que vale carregar:** **gasto é fluxo; investimento é estoque.** Não cabem na
mesma tabela.

### A13. A importação de extrato descarta valores negativos

**Regra:** valor negativo em extrato ou fatura **não é gasto novo** — é estorno ou
pagamento da própria fatura. Descartar na importação.

**Se violada:** o pagamento da fatura entra como despesa e **dobra** o mês inteiro do
cartão.

### A14. Poucas categorias, porque a entrada é no celular

**Regra:** o conjunto de categorias é curto de propósito — foi consolidado de 11 para 8
mais a de acerto.

**Se violada:** lançar um gasto de pé no mercado fica lento demais, e o app deixa de ser
usado. **A velocidade de entrada é requisito, não conforto.**

### A15. Rótulo legado continua sendo aceito na leitura

**Regra:** quando um rótulo muda de nome, o antigo **continua válido na gravação e na
leitura** enquanto existir dado histórico com ele. O que muda é só o que a tela oferece.

**Se violada:** aconteceu com `Conjunta` → `Ambos`. Sem tratar o antigo, reeditar uma
linha histórica gravaria o desembolso vazio e **a linha sumiria do acerto sem aviso**.

> Numa migração de dados, converta e aposente o termo. Enquanto não converter, aceite.

### A16. A fatura tem que ser cruzada consigo mesma, não só com o app

**Regra:** ao importar, uma parcela `N de M` cuja irmã `1 de M` está **na mesma fatura**
(mesmo valor, mesma data de compra) já está coberta pela série que aquela linha vai
criar. Não pode virar lançamento próprio.

**Se violada:** medido em 26/08/2026 na fatura de agosto. `Adaptaorg` vinha com as doze
parcelas de uma vez. A primeira criou a série de 12; as outras onze, sem série no app
para casar, caíram em "gasto novo" e entraram soltas. **R$ 1.188 viraram R$ 2.277** — o
mesmo gasto contado duas vezes, e nada na tela dizia.

> O erro de raciocínio é o interessante: o cruzamento foi desenhado para comparar a
> fatura com o **app**, e a duplicata nasceu dentro do próprio arquivo. Sempre que uma
> regra diz "compare A com B", pergunte se A também precisa ser comparado consigo mesmo.

**Como provar:** monte 12 linhas `1..12 de 12`, mesmo valor e mesma data; só a primeira
pode sair como série, e nenhuma outra como gasto novo. Duas compras de mesmo valor e
mesmo total em **datas diferentes** têm que continuar sendo duas séries.

### A17. Corrigir um lote em bloco não pode desfazer trabalho feito à mão

**Regra:** reabrir uma importação para corrigir em lote lê o **estado atual dos
lançamentos**, não o arquivo importado, e grava só as linhas que a pessoa alterou
naquela tela. O que não foi tocado não é reescrito.

**Se violada:** a primeira versão apagava o lote e o regravava a partir da fatura.
Quem tivesse renomeado ou recategorizado uma linha na tela normal perdia o trabalho
ao corrigir **outra** linha do mesmo lote.

> Isso exige um elo explícito entre a linha do arquivo e o lançamento que ela gerou
> (`importacao_linha`). Sem ele, só existe o caminho destrutivo — e o custo aparece
> tarde, quando alguém já investiu horas arrumando o que a importação trouxe torto.

**Como provar:** importe, edite uma linha à mão pelo caminho normal, corrija **outra**
linha pela edição em lote, e confira que a primeira continua exatamente como estava.

### A18. Recorrência não adianta o futuro, tenha ou não data fim

**Regra:** ao gravar, uma recorrência produz ocorrências **só até o fim do mês corrente**.
A data fim é *vigência da regra* — o cron a respeita e para na hora certa —, não
autorização para lançar os meses seguintes.

**Por que é diferente de parcelamento:** uma parcelada é dívida **já contraída** — a
compra aconteceu e as N parcelas são devidas, então gravar todas é o certo (A7). Uma
recorrência é escolha que **se repete**: a faxina, a assinatura, a viagem podem ser
canceladas no mês que vem. Pôr uma data fim planeja o término; não transforma o futuro
em dívida.

**Se violada:** medido em 09/10/2026, e foi o Irwin quem viu na tela do app. Quatro
regras com data fim tinham gravado **23 ocorrências até março de 2027** no ato da
criação — R$ 22.859,05 — e, com `ultima_geracao` já no fim, o cron nunca mais as tocava.
O corte **"total"** do acerto estava **R$ 11.429,53 errado**: cinco meses de uma despesa
que ainda não aconteceu. Os cortes do mês e do mês seguinte estavam certos, e é por isso
que passou despercebido por seis semanas.

> O defeito nasceu de uma assimetria sem motivo: `montarRecorrencias` tinha dois ramos,
> um para `semFimRec` e outro para data fim, e só o primeiro parava no mês corrente. A
> conta certa já existia **no cron**. Era a regra nº 3 violada — duas implementações da
> mesma coisa, e a cópia errada era a que gravava.

**Como provar:** `scripts/invariantes.ts`, invariante `recorrencia-adiantada` — nenhuma
linha com `recorrente = true` pode ter data além do fim do mês corrente. Parcela futura
não entra no filtro, de propósito.

### A19. Um parcelamento nasce com série, sempre

**Regra:** gravar uma compra parcelada cria a linha em `series` e liga **todas** as
parcelas a ela, com `seq`. Não existe parcelamento órfão.

**Se violada:** medido em 09/10/2026 junto com a A18 — **17 parcelas criadas em
setembro** pela tela de Lançar, todas sem `serie_id`. O custo é duplo e nenhum dá erro:

- A tela de editar série não as alcança — exatamente a função que a Fase 3 entregou.
- O cruzamento da fatura usa `series` como **chave forte**. Uma `Leiturinha 6/12`
  chegando na fatura do mês seguinte não casaria com nada e entraria **duplicada**.

> Mesma classe de falha da A10, do outro lado da moeda: em agosto a recorrência
> indefinida nascia sem regra, foi corrigida, e **ninguém olhou o parcelamento**.
> Quando um defeito é "o registro-pai não foi criado", procure os outros tipos de
> registro-pai no mesmo caminho de gravação.

**Como provar:** `scripts/invariantes.ts`, invariante `serie-identidade` — toda linha
cuja descrição termina em ` N/M` tem `serie_id`.

---

### A20. Cobrança e desconto podem ser lançamentos separados — o app registra o líquido

**Regra:** quando a fatura cobra um valor e devolve parte dele em **outra linha**,
negativa, em **outro mês**, o que vale para o app é o **líquido**. Descartar o negativo
(A13) e lançar só o bruto registra uma despesa que não existiu.

**Se violada:** medido em 21/10/2026 nas 10 faturas de fev a nov/2026 do final 8607. A
anuidade é cobrada em R$ 105,00 e devolvida como `Redução Mensalidade - Plano Do Cartão`.
O app tinha R$ 100,00 fixos de recorrência enquanto o pago real era 0, 52,50 ou 105,00
conforme o mês — **e o desconto não é constante**: dois meses tiveram estorno integral, um
não teve desconto nenhum e um teve desconto dobrado. Total pago no período: R$ 420,00
contra R$ 1.050,00 de cobrança bruta. A Maria estava devendo R$ 263,25 a mais.

> O que generaliza: **a A13 descarta negativo porque negativo costuma ser pagamento de
> fatura — mas estorno também é negativo.** Descartar os dois pelo sinal joga fora o
> estorno junto. O cruzamento de estornos da Fase 4 (`src/lib/estornos.ts`) já trata isso
> dentro da MESMA fatura; o que a A20 cobra é o caso de **meses diferentes**, que nenhuma
> tela cruza hoje.

**Como provar:** não é checável por consulta — depende do arquivo da fatura. O que dá para
checar é o sintoma: uma recorrência cujo valor **nunca varia** enquanto as faturas variam.
Por ora, `scripts/corrigir-anuidade.mts` carrega a tabela mês a mês, conferida à mão.

---

### A21. Uma base, uma porta de importação

**Regra:** só pode existir **um** caminho que grava lançamentos em lote. Se existirem
dois, o que não cria `importacoes` não pode continuar de pé.

**Se violada:** medido em 21/10/2026, em produção. A tela antiga de importação OFX/CSV
(`lancarImportacaoLote`) gravou **150 linhas, R$ 18.796,35**, da fatura de setembro:
todas `Ambos` 50/50, descrição crua, categoria por palpite, `fonte = 'Extrato banco'` — e
**sem `importacao_id`, logo sem desfazer**. Seis minutos depois a tela nova importou a
mesma fatura, cruzou, viu as 150 já lá e criou só as 11 parcelas que faltavam. O
cruzamento funcionou perfeitamente **contra uma base já suja**.

O efeito no acerto foi quase nulo (R$ 0,21, porque `Ambos` sem rateio não gera dívida) —
e é justamente isso que torna a falha difícil de perceber: **o saldo não denuncia.** O
que inflou foi a despesa do mês.

> Duas portas para a mesma coisa não é redundância, é divergência com data marcada. E a
> porta sem desfazer é sempre a que vai ser usada por engano.

**Como provar:** `select count(*) from lancamentos where importacao_id is null and
cat_original = 'Importação OFX/CSV'` tem que dar **zero** depois da limpeza — e a tela
antiga tem que deixar de existir, não ficar escondida.

---

### A22. O cruzamento da fatura também olha recorrência, não só parcelamento

**Regra:** antes de propor uma linha como nova, o cruzamento pergunta se já existe
**recorrência** cobrindo aquele gasto naquele mês — não só se existe parcela de série.

**Se violada:** medido em 22/10/2026. A regra da `Netflix` foi criada às 00:56 com as
ocorrências de 01 a 10/2026. Às 01:02 a fatura de setembro foi importada e trouxe
`Netflix.comsao Paulobr`, 07/08, R$ 44,90 — **mesma data, mesmo valor, mesmo pagador** da
ocorrência que já estava lá. Entrou duplicada, e nenhum invariante acusou: `duplicatas`
compara linhas idênticas, e as descrições diferem.

O mesmo caso já tinha aparecido com a anuidade, e só não duplicou porque foi avisado à
mão: `Mensalidade - Plano Do Cartão` contra a recorrência `Anuidade Cartão`.

> O padrão: o cruzamento foi desenhado contra **parcelamento**, onde a série é chave
> forte e o nome é estável. Recorrência não tem nada disso — o nome na fatura é o do
> lojista e o do app é o que a pessoa escolheu. A chave aqui tem que ser
> **(valor, mês, pagador)**, com o nome do lojista como pista, não como requisito.

**Como provar:** importar uma fatura com um gasto já coberto por regra ativa no mesmo
mês. A linha tem que chegar na aba "Já no app", não em "Novos".

### A23. `De fora` sem dono desaparece de tudo

**Regra:** um lançamento marcado `de_fora` **exige** o nome de quem é o gasto
(`gasto_de`), recusado nas três portas — salvar, editar e importar em lote.

**Se violada:** `de_fora` zera o `saldo_irwin` da linha, então ela não entra no acerto do
casal. A dívida de terceiro é agrupada por `gasto_de`, então sem o nome ela também não
entra ali. A linha fica registrada e **invisível nas duas contas** — o pior caso
possível, porque a tela não acusa nada.

É a A4 aplicada à outra conta, e tem a mesma origem: o lançamento sem pagador também
sumia do acerto em silêncio, e foram 19 linhas até alguém notar.

> Consequência de desenho: `Outra pessoa` deixou de ser rótulo gravável. Como valor em
> `gasto_de` ela virava uma pessoa só no saldo, somando o que a mãe do Irwin deve ao que
> um amigo deve — um saldo de duas pessoas não serve para cobrar nenhuma das duas. Hoje
> ela é a opção que **pede o nome**.

**Como provar:** `scripts/invariantes.ts`, check `de-fora-tem-dono`. Plantar uma linha
`de_fora` com `gasto_de` nulo: o check tem que falhar nomeando a linha. Verificado em
16/11/2026 plantando `SEMENTE orfã`, R$ 99,00 — acusou.

### A24. `De fora` nunca mexe no acerto do casal, e a dívida dele é derivada

**Regra:** duas coisas que andam juntas.

1. A soma do efeito no acerto dos lançamentos `de_fora` é **exatamente zero**. É conta
   com outra pessoa, não dívida entre os dois.
2. Quanto um terceiro deve **não é gravado em lugar nenhum**: sai de `v_terceiros`, que
   soma os `de_fora` dele e desconta as devoluções da tabela `reembolsos`.

**Se violada:** (1) gastos de terceiro passariam a criar dívida entre Irwin e Maria —
medido com três linhas semeadas, R$ 299,00 de dívida que a regra evita. (2) um saldo
gravado precisa concordar com as linhas que o formam, e quando discorda não há como
saber qual dos dois está certo. É a mesma razão pela qual `Saldo Irwin` era fórmula na
planilha, não número digitado.

> Por que `reembolsos` é tabela própria e não uma linha em `acerto_contas`: encaixar a
> devolução de um terceiro lá funcionaria na aritmética de hoje e explodiria no primeiro
> `quem_pagou = 'Irwin'` com `para_quem` fora do casal — o `case` do acerto somaria a
> dívida da mãe dele ao que a Maria deve. Tabela separada não tem como errar isso.

**O caso que mandou fazer:** a conta da Vivo da mãe do Irwin. Ele paga, ela devolve.
Antes disto a única saída era **não lançar**: R$ 3.499,00 em dez meses fora do app,
porque marcar `de_fora` tirava o gasto das contas sem criar o crédito.

**Como provar:** `scripts/invariantes.ts`, checks `de-fora-nao-mexe-no-acerto` e
`terceiros-derivado` — o segundo recalcula o saldo de cada pessoa por fora da view.
Verificado ponta a ponta em 16/11/2026: lançar R$ 200 `De fora` não moveu o acerto
(R$ 5.015,99 antes e depois), a dívida apareceu, duas devoluções zeraram.

> **Armadilha que isto já cobrou:** o check `acerto-dois-caminhos` falhou no dia em que
> `de_fora` ganhou o primeiro dado. Não era defeito do app — o segundo caminho tinha
> sido escrito antes da coluna existir e parou de encodar a mesma regra. **O que precisa
> ser independente num check de dois caminhos é a implementação, não a regra:** um
> segundo caminho que ignora uma regra do primeiro não verifica, só discorda.

### A27. `Mozi` e `Família` são procedência, não meio de pagamento

**Regra:** a coluna `fonte` guarda duas coisas diferentes. `Cartão` e `Banco` dizem **de
onde saiu o dinheiro**. `Mozi` e `Família` dizem **de qual grupo do Splitwise a linha foi
importada** — e nesse histórico o meio de pagamento nunca foi registrado. Os dois
primeiros entram em comparação por meio de pagamento; os dois últimos **ficam de fora**.

**Se violada:** medido no ciclo da fatura de março, 27/02 a 29/03: dos 73 lançamentos do
app, 64 têm fonte `Mozi` ou `Família`. Qualquer lista do tipo "o que já está lançado neste
cartão" que os inclua vira ruído com um punhado de sinal dentro — e pior, afirma que um
jantar rachado no Splitwise foi pago no cartão, o que ninguém sabe.

**Por que não converter:** não há como. A informação não existe em lugar nenhum. Apagar o
rótulo para "limpar" jogaria fora a única coisa que esses lançamentos ainda dizem sobre si
— de onde vieram. Decisão do Irwin, reafirmada em 19/11/2026: ficam, e a comparação é que
tem que saber desviar.

> **Isto não é A15.** Lá o rótulo antigo é o MESMO conceito com outro nome — `Conjunta` é
> `Ambos`. Aqui são conceitos diferentes dividindo uma coluna, e o tratamento é oposto:
> não se converte, se exclui da conta.

### A26. Lista de domínio existe uma vez só

**Regra:** a lista de opções de um campo de domínio — divisões, origens, pagadores — tem
**um** dono no código. Quem precisa dela importa; ninguém redigita.

**Se violada:** as divisões existiam duas vezes: a canônica em
`components/DivisaoEPagador`, com `De fora`, e uma segunda servida por `getOpcoes` ao
front, sem. Elas divergiram, e as telas que liam do servidor — revisar importação e editar
série — **ficaram sem como marcar gasto de terceiro**. O defeito era invisível de dentro
de cada arquivo: os dois estavam certos, cada um por si.

**O que isso custou na prática:** para marcar uma linha de fatura como gasto da mãe do
Irwin era preciso **dividir em pedaços** uma linha que tem um dono só — e quem não sabia
desse caminho simplesmente lançava errado.

**Como provar:** `src/lib/tela.test.ts` confere que `getOpcoes` não declara a lista e que
a revisão de fatura importa `DIVISOES`.

> O mesmo vale para `De fora` no nível da LINHA, e não só do pedaço: dividir uma linha é
> para a compra que tem dois donos (a Vivo), não para dizer de quem ela é.

---

## Parte B — Leitura, ordem e identidade

Invariantes de arquitetura. Independem de qual é o banco.

### B1. A ordem vem da data, nunca da posição do registro

**Regra:** a ordem de exibição é apurada por um índice sobre a **data**. Nunca por "os
últimos N registros" da fonte.

**Se violada:** basta alguém reordenar a fonte e o app mostra o histórico ao contrário.
Aconteceu: a planilha foi ordenada por data decrescente e o app ficou preso em **2020**,
com o histórico indo até 2027.

**Como provar:** a mesma base em ordem **crescente, decrescente e embaralhada** tem que
produzir **o mesmo resultado lógico**. É o teste que pega esta classe inteira.

> Vale também para a **busca**: ela varria de trás para frente e parava nos primeiros 60
> achados — devolvia os 60 mais antigos. Ordenar e só então cortar.

### B2. Posição não é identidade

**Regra:** um registro é identificado por um **id estável**. Se a implementação não tiver
id, toda gravação carrega uma **assinatura** do conteúdo que o app leu, e o servidor
confere antes de escrever.

**Se violada:** a lista na tela envelhece, a fonte é reordenada, e editar ou excluir
acerta **outro registro** — em silêncio.

**Como provar:** abrir a lista, reordenar a fonte por fora, tocar para editar. Tem que
recusar com mensagem acionável, não gravar no lugar errado.

> **No 2.0, resolva na raiz: dê um id de verdade a cada lançamento.**

### B3. Toda coluna calculada existe em toda linha nova

**Regra:** ao criar um registro, garantir que **todos** os campos derivados sejam
inicializados a partir do molde corrente. Nunca supor que "se um deles já existe, os
outros também existem".

**Se violada:** um campo criado depois nunca é preenchido nas linhas novas, e um campo
antigo pode ficar com a **fórmula velha**. Aqui isso fez o recurso de dois pagadores
nascer **sem efeito nenhum no acerto**, mesmo com todo o resto correto.

**Como provar:** criar um registro e comparar **campo a campo** com o molde.

> Generalização: qualquer verificação do tipo "se já existe, não faço" é falso positivo
> esperando acontecer — e **o campo novo é sempre a primeira vítima**, porque é o único
> que ninguém propagou para trás.

### B4. A leitura cresce sob demanda, sem buffer fixo

**Regra:** a paginação não pode ter uma borda além da qual o histórico desaparece.

**Se violada:** um buffer fixo cobra o custo do pior caso em toda carga **e** esconde o
que está além da borda — o "Ver mais" morre no meio do histórico sem avisar.

### B5. O saldo tem uma implementação só

**Regra:** a regra que define quanto um deve ao outro existe em **um** lugar. Quem calcula
não é quem exibe.

**Se violada:** duas implementações da mesma regra divergem, e aí não há como saber qual
está certa — só que os números não batem.

---

## Parte C — Tela

Decisões de interface que foram **ganhas**, não escolhidas por gosto.

### C1. A lista mostra o efeito no acerto, não a fatia do gasto

**Regra:** o detalhe de cada transação responde **"quanto isso mexeu no que um deve ao
outro"** — um número com sinal por pessoa, verde a receber e vermelho a pagar.

**Se violada:** mostrar "parte de cada um" parece informativo e não é. As duas partes são
sempre positivas e somam o total, então **duas transações idênticas aparecem idênticas
mesmo quando o efeito no saldo é exatamente oposto**. Um gasto de R$ 200 meio a meio
mostra "100 e 100" tenha pago um ou tenha pago o outro — e quem pagou é a única coisa que
muda o saldo.

**Como provar:** o mesmo valor e a mesma divisão, pagos por pessoas diferentes, têm que
aparecer **diferentes**, com os sinais trocados.

> Detalhes que valem copiar: os dois lados são **espelho exato** (não traga os dois do
> servidor, um é o negativo do outro); e quando o efeito é **zero** — quem pagou é dono de
> 100% do gasto, ou cada um pôs a própria parte — escrever "+0 · −0" é ruído, melhor
> dizer que não mexeu no acerto.

### C2. Quem pagou se lê pela foto, inclusive quando foram os dois

**Regra:** quem pagou é identificado por **imagem**, não por texto. Pagamento dos dois tem
representação própria — um círculo dividido ao meio, uma pessoa de cada lado.

**Se violada:** o caso "os dois" caía num círculo cinza vazio, **idêntico ao de um
lançamento sem pagador** — que é coisa completamente diferente.

> **Cuidado de payload:** a implementação atual embute a foto (~6 KB) no HTML de **cada
> linha**; com 50 linhas isso é ~300 KB de duplicação. O avatar duplo não repetiu o erro —
> as metades recebem a imagem por CSS, uma vez. **No 2.0, sirva avatar por URL ou classe,
> nunca embutido por item de lista.**

### C3. Data escolhida pelo usuário não se redefine sozinha

**Regra:** o campo de data só volta para "hoje" quando o formulário **recomeça** — nunca
num re-render.

**Se violada:** a função que monta o formulário roda a cada toque em chip (categoria,
tipo, origem, pagador, divisão) e reescreve a data. A pessoa escolhe a data, toca em
qualquer outra coisa, e o lançamento vai para a base com a data de hoje. Só percebe depois.

**Como provar:** escolher data anterior, **depois** tocar em vários chips, salvar, e
conferir a data **na base** — não na tela.

### C4. Meses futuros ficam ocultos por padrão

**Regra:** lançamentos com data além do mês corrente ficam **ocultos por padrão**, atrás
de um botão que diz **quantos** são.

**Se violada:** as parcelas já lançadas para os meses seguintes enchem o topo e o app
abre mostrando "MAIO DE 2027" — escondendo o que acabou de acontecer.

### C5. A profundidade da lista se preserva ao gravar

**Regra:** salvar um lançamento **não** joga a lista de volta ao topo. O que foi aberto
com "Ver mais" continua aberto.

**Se violada:** quem está lançando vários gastos seguidos perde a posição a cada
gravação, e reabre a lista do zero toda vez.

### C6. Cor carrega significado

**Regra:** a mesma cor identifica a mesma coisa em **qualquer** tela. Pessoa, tipo e
categoria têm paletas próprias e fixas.

**Se violada:** a cor vira decoração e o usuário perde o atalho visual que fazia a leitura
ser instantânea.

### C7. Honestidade sobre a qualidade do dado

**Regra:** onde a classificação é **palpite** do sistema — categorização automática na
importação, série incompleta, dado legado — isso **aparece na tela**.

**Se violada:** o usuário confia num palpite como se fosse fato. Este projeto já errou por
isso do lado de dentro (ver E3); do lado do usuário o custo é maior.

### C8. A marca de quem é o gasto identifica a pessoa, não a categoria "terceiro"

**Regra:** a marca de dono na lista mostra **aquele** dono. Quem tem foto aparece com a
foto; quem não tem vira iniciais, no mesmo lugar e com o mesmo anel.

**Se violada:** a lista mostrava a foto do André em **qualquer** gasto com dono, com o
nome do outro no `title`. São três donos na base — André (131 linhas), Avô da Maria (4) e
Mãe do Irwin (3) — então o caso errado nunca foi hipotético: gasto do avô da Maria
aparecia como gasto do filho. **O olho acredita na foto, não no tooltip**, e um tooltip
não existe no celular.

**Como provar:** `src/lib/tela.test.ts`. Verificado que discrimina: trocando a comparação
por "tem dono?", reprova.

> As iniciais tiram as preposições — `Avô da Maria` vira `AM` e `Mãe do Irwin` vira `MI`.
> Sem isso dariam `AD` e `MD`, que é o mesmo defeito com outra roupa: duas marcas que não
> distinguem ninguém.

### C9. Paginar não é refazer a pergunta

**Regra:** "Ver mais" pede a página seguinte **da mesma consulta** — mesmo filtro, mesma
busca, mesma ordem. O que muda entre a primeira página e a segunda é só o offset.

**Se violada:** a primeira página vinha filtrada e o "Ver mais" trazia a lista inteira a
partir do offset **da lista filtrada**. O resultado para quem olha é o pior possível:
linhas de fora do filtro, numa ordem que não continua a de cima. Medido num caso real —
janela de janeiro a março, offset 50: com o filtro, 0 linhas fora da janela; sem ele,
**50 de 50**.

**Como provar:** `src/lib/tela.test.ts` confere que toda chamada de página termina em
`FILTROS`.

### C10. Filtro é estado do usuário, e sobrevive à navegação

**Regra:** o filtro da lista volta como estava depois de abrir um lançamento, editar,
salvar e voltar.

**Se violada:** abrir um lançamento sai do `Form.html` para uma página React, e voltar
recarrega a página do zero. Enquanto o filtro vivia só numa variável, **ele morria em
toda edição** — e quem filtrava um mês para conferir refiltrava à mão a cada linha.

**A escolha:** `sessionStorage`, não `localStorage`. Vale para esta aba, não para sempre:
um filtro esquecido de semana passada esconderia linha sem ninguém ter pedido. E só as
chaves que o backend conhece voltam do armazenamento — estado que volta de fora do código
não precisa chegar ao servidor como veio.

**Como provar:** `src/lib/tela.test.ts`.

---

### C11. Revisar uma fatura é lançar, com menos perguntas — não um formulário pobre

**Regra:** a tela que edita uma linha de fatura é o **mesmo** formulário do Lançar, com
os mesmos chips, as mesmas cores e as mesmas duas perguntas na mesma ordem. O que ela tem
a menos é o que não se aplica (parcelar, repetir), nunca o que custou trabalho a fazer
direito.

**Se violada:** era uma pilha de `select` cinzas. A diferença não é estética: quem revisa
167 linhas de uma fatura estava lendo texto onde o resto do app dá cor, e **faltavam
campos** — não dava para dizer se era Fixa, de onde saiu o dinheiro, nem corrigir a data.
A tela que recebe o maior volume de lançamentos do app era a mais pobre dele.

**Como isso se mantém:** o estilo é um só, `:is(.form-lanc, .campos-lanc)`, e a paleta de
categorias vive em `src/lib/cores.ts`. Duas folhas de estilo para o mesmo formulário
divergiriam no primeiro ajuste — e foi assim que ele ficou para trás da primeira vez.

**Como provar:** `src/lib/tela.test.ts` reprova se uma regra de formulário ficar só no
Lançar ou se a paleta for copiada para fora do módulo de cores.

> **Uma diferença de propósito:** no Lançar, trocar a categoria **não** mexe no tipo,
> porque a pessoa escolheu a categoria. Na fatura a categoria foi **adivinhada** por
> palavra-chave, então corrigir o palpite corrige o que saiu dele — até alguém tocar no
> tipo, e aí ele para de seguir. Regra diferente porque a pergunta é diferente.

> **E uma pegadinha de conta:** com `De fora`, a parte do Irwin é zero e a da Maria
> **também** — não é "o total menos a do Irwin". Calculando por subtração, a tela
> afirmava que um gasto de terceiro era todo da Maria. A conta mora em `partesDe`.

### C12. Campo ao lado de campo fecha a mesma moldura

**Regra:** todo campo em moldura — texto, número, data, `select` — e todo botão que se
alinhe a um têm **uma** altura, `var(--alt-campo)`. Quem precisar parecer menor muda
padding ou largura, nunca a altura nem a fonte.

**Se violada:** `line-height: normal` faz cada tipo de campo calcular a própria altura de
conteúdo. Medido na tela de editar uma linha de fatura: texto 41px, data 43px, `select`
43px, botão do André 42px — **quatro alturas na mesma tela**, com os campos de um par
começando e terminando em pontos diferentes. Nenhum teste pega isso: o app renderiza, o
typecheck passa, os invariantes do banco passam. Quem pegou foi o Irwin, olhando.

**Como isso se mantém:** a altura é um `line-height` explícito de 20px mais o padding e a
borda, somando o token. O botão e a bolinha da cor da categoria derivam do **mesmo**
token em vez de repetir o número — repetido, ele diverge no primeiro ajuste.

**Como provar:** `src/lib/tela.test.ts` reprova se o token sumir ou se o botão voltar a
trazer a altura em pixel. A prova de verdade é medir no navegador: `getBoundingClientRect`
de cada campo do par, que é como estas quatro alturas apareceram.

> **A fonte do campo não entra nessa conta.** 16px não é escolha estética: abaixo disso o
> Safari do iPhone dá zoom sozinho e não volta. Campo menor se faz por padding.

---

### C13. Gráfico de histórico para no mês corrente

**Regra:** toda série temporal do Dashboard (a evolução do % de fixas, hoje) é cortada no
fim do mês corrente. O futuro que existe no banco não entra em gráfico de histórico.

**Se violada:** o banco tem futuro de verdade, e ele é torto de propósito. Um
parcelamento nasce com a série inteira (A19), então uma compra em 12x deixa linhas até o
ano que vem; as fixas, ao contrário, só são geradas até hoje (A18). O futuro portanto tem
parcela e não tem fixa, e o gráfico desenhava uma fileira de meses em **0,0%** logo depois
do mês atual. Lido de boa fé, aquilo dizia "o casal parou de ter aluguel em dezembro".
Pegou numa base de demonstração; na base real o mesmo buraco estava lá, escondido porque
a visão padrão era anual e o ano seguinte ficava fora das oito colunas.

### C14. Dois campos lado a lado não vazam para fora do cartão

**Regra:** item de `flex` que divide a largura com outro leva `min-width: 0`.

**Se violada:** item de flex nasce com `min-width: auto`, que é o tamanho mínimo do
**conteúdo** e não o espaço disponível. Dois `input[type=date]` lado a lado pedem mais que
a metade de 375px cada um, e o segundo simplesmente sai pela borda direita do cartão. A
janela de datas do Dashboard ficou assim por meses sem ninguém ver, porque num navegador
de mesa a largura sobra e o defeito não aparece — ele só existe no aparelho em que o app
de fato é usado.

---

### C15. Marcado quer dizer coisas diferentes em cada tela

**Regra:** numa importação NOVA, marcado quer dizer "vai ser criado" — e nasce marcado só
o cartão de quem está importando. Ao REABRIR um lote, marcado quer dizer "está lançado no
banco", e desmarcar **apaga**. Por isso o seletor que remarca em bloco existe só na
primeira, nunca na segunda.

**Se violada:** a fatura do casal vem com os dois cartões — medido na de março, 44 linhas
no cartão do Irwin e 42 no da Maria. Tirar as do outro custava 42 toques, um por linha, e
era isso que fazia a importação doer. Mas o mesmo atalho na tela de reabrir trocaria 44
lançamentos existentes por 44 exclusões, em um toque, sem ninguém pedir.

**A escolha:** quem não é o dono do cartão nasce **desmarcado**, e quem quiser lançar uma
linha pelo outro **marca aquela linha**. Marcar uma é barato; desmarcar 42 não é.

**O filtro é outra coisa:** `Mostrar` muda só o que está na tela, nunca o que vai ser
gravado. O rodapé continua somando as marcadas, não as visíveis — um filtro que mexesse no
que entra fecharia a fatura com metade dos gastos faltando. E "todas/nenhuma" vale para o
que está **na tela**, porque o sentido do botão é "isto aqui que eu estou olhando".

**Como provar:** `src/lib/tela.test.ts` reprova se o seletor de marcar aparecer na tela de
reabrir. A prova de verdade é importar duas vezes e conferir a contagem no banco.

---

### C17. A sugestão de categoria aprende do que já foi categorizado — e `7 Outros` não vota

**Regra:** a categoria sugerida na importação sai primeiro do **histórico** do casal, e só
cai na palavra-chave do Plano de Contas quando o histórico não sabe. `7 Outros` fica fora
da votação, e por isso fora do índice inteiro.

**Se violada:** as "palavras-chave" do Plano de Contas são a FRASE que descreve a categoria
para um humano ler — *"Financiamento, IPVA, seguro, combustível, manutenção, estacionamento,
multas, Uber/99"*. O termo gravado é `uber/99`, e nenhuma fatura escreve isso. Medido nos 409
lançamentos de set a nov/2026: a regra sozinha acerta **19,1%**. Com o histórico, **47,2%**.

**Por que `7 Outros` não vota:** `araujo` aparecia 63 vezes na base — 49 em Outros, 7 em
Comida, 7 em Saúde. Aprendendo cru, o índice devolveria `7 Outros` com 78% de confiança:
ele aprenderia a **não categorizar**, para sempre, e com cara de certeza. `7 Outros` é a
ausência de uma decisão, não uma decisão.

**Ganha confiança, não frequência.** `ifood` com 12 de 12 vale mais que `sao` com 400 de
900: um nome de loja decide a categoria, uma preposição não decide nada. Abaixo de 3
ocorrências ou de 60% de maioria, não sugere — na revisão, palpite errado custa mais caro
que palpite nenhum, porque ele parece resposta.

**Sem cache, de propósito:** o índice é montado a cada importação. É uma consulta de duas
colunas, e importação é coisa rara. Em troca, **toda correção feita na revisão vale já na
fatura seguinte** — é esse ciclo que faz os 41% sem palpite encolherem sozinhos. Um índice
materializado precisaria ser atualizado, e desatualizado ele ensina o passado.

**Como provar:** `src/lib/aprendizado.test.ts`, com os casos que a base real produziu.

> **Treinar numa base errada ensina o erro.** Antes de ligar isto, 53 mil reais saíram de
> `7 Outros` para as categorias certas, em lote. Fazer na ordem inversa teria gravado o
> Araújo como "Outros" no índice.

---

### C18. O que sobrou do ciclo se mede no ciclo, e sem o próprio lote

**Regra:** a revisão mostra, embaixo dos cruzamentos, o que está lançado **como cartão** no
ciclo da fatura e nenhuma linha dela explicou. O ciclo é a janela das linhas **à vista**;
os do Splitwise entram só como contagem (A27); e os lançamentos **do próprio lote** ficam
de fora.

**Se violada — a janela:** as parceladas carregam a data da COMPRA original. Na fatura de
março, contando as 28 parceladas, a janela ia a agosto do ano anterior e o app tinha 485
lançamentos nela. Com as 58 à vista, 73.

**Se violada — o lote:** ao reabrir uma importação, as linhas que ela mesma lançou estão no
ciclo, e o cruzamento não as reclama — ele só casa com o que já existia antes. Sem tirá-las,
aparecem como "não explicadas" sendo as mais explicadas de todas. Foi o erro da primeira
medição: *"Lavatudovip 1/6"* parecia exatamente um gasto esquecido, e era uma parcela que a
própria importação tinha criado.

**Medido em produção**, na fatura #5 (ciclo 29/10 a 15/11, 99 linhas): 18 lançamentos de
cartão não explicados. Boa parte tem explicação conhecida — o 99Food cobra em bloco e a
fatura não vê pedido a pedido —, e é isso que a lista serve para mostrar: o que o app tem
no período e o documento não tem.

**Como provar:** `src/lib/tela.test.ts` reprova se o lote ou a janela à vista sumirem.

---

### C16. A fatura manda na data e no pagador

**Regra:** data e quem pagou vêm da fatura e **não são editáveis** na revisão. O dono do
cartão é quem pagou. A exceção é uma só: quando o nome no cartão não bateu com ninguém do
elenco, os botões de pagador voltam.

**Se violada:** editar a data inventa uma data de compra que a fatura já afirma — e a data
é o que liga a parcela 2 à série que o app conhece. Trocar o pagador cria divergência com o
documento que originou a linha.

**A exceção não é detalhe:** sem pagador a gravação é recusada (A4). Um campo travado em
branco deixaria a fatura impossível de fechar, e o erro só apareceria na gravação, depois
de revisar 86 linhas.

> **O cartão adicional é da pessoa, não de quem paga a fatura.** No adicional da Maria
> quem paga é ela, e ela transfere depois — decisão do Irwin em 19/11, para ela enxergar
> o cartão dela como gasto dela. Lançar tudo como pago pelo titular daria mais confusão
> do que acerto.

---

## Parte D — Só enquanto a base for a planilha Google

Se o 2.0 usar um banco, estes itens somem. **Se sumirem, ótimo** — mas confira se o
problema equivalente não reapareceu de outra forma.

### D1. A base precisa ser Google Sheets nativa

Apps Script não opera sobre `.xlsx` hospedado no Drive. Um arquivo Excel no Drive **não
serve** como base.

### D2. Colunas são posicionais — coluna nova vai no fim

O mapa de colunas do backend é por posição, e a linha-molde das fórmulas depende disso.
Mover coluna quebra tudo **em silêncio**.

### D3. Nada de `copyTo`

Com filtro ativo na aba, o Sheets recusa: *"A operação não é aceita em um intervalo com
uma linha filtrada"*. Medido operação a operação: `setValue`, `setFormula`,
`clearContent` e `deleteRow` funcionam com filtro; **só `copyTo` quebra**. Para propagar
fórmula da linha-molde, use `setFormulaR1C1` — em R1C1 o molde é relativo à linha.

Custou uma edição falhando em produção **sem ninguém reportar**.

### D4. As operações do Sheets são enfileiradas

Sem `flush()` dentro do `try`, uma operação que vai falhar **passa** pelo `catch` e o erro
só estoura no flush final, longe da causa. Isso escondeu qual operação era a culpada num
diagnóstico: o primeiro teste deu "tudo OK" e estava errado.

### D5. Reordenar e filtrar a planilha é uso legítimo

A planilha é de quem a usa. O app é que não pode depender da ordem nem do filtro.
Ver B1 e D3.

### D6. O código no servidor é a fonte de verdade, não a pasta local

Não há sincronização automática. Já houve mudança de arquitetura feita direto no editor
que **nunca desceu** para a pasta local, e uma cópia local desatualizada levou a um
diagnóstico errado do app.

> Se o 2.0 tiver repositório de verdade, este item morre — e é um bom motivo para ter.

---

## Parte E — Como testar, que é onde mais se errou

### E1. Nada é dado como pronto sem um lançamento real, ponta a ponta

Na entrega de dois pagadores o recurso foi declarado pronto apoiado em duas verificações
que **passaram**:

| Verificação | O que prova | O que **não** prova |
|---|---|---|
| Hash do código nos dois lados | que o código certo subiu | que o código está certo |
| Lógica pura extraída num motor JS | que a tela calcula certo | que o valor chega **gravado** |

O primeiro lançamento de verdade quebrou em menos de um minuto, e eram **dois** bugs.
Ambos moravam na junta **tela → backend → base**, que nenhuma das duas verificações
cruzava.

**A regra:** antes de dizer "pronto", lançar de verdade pelo app publicado e conferir **o
que foi gravado na base** — não o que a tela mostra.

### A25. Toda rota tem porta de entrada

**Regra:** toda tela com `page.tsx` tem pelo menos um link vindo de **fora dela mesma**.
Um "voltar" para a tela de cima não conta como porta da tela de cima: ela pode estar tão
inalcançável quanto esta.

**Se violada:** a tela existe, responde 200, renderiza, funciona — e ninguém chega nela.
No celular não há barra de endereço: sem link, a tela não existe.

**O defeito que mandou fazer:** em 22/10/2026 o Lançar saiu do `Form.html` para React
(9e55922). A navegação de baixo passou a redirecionar a aba `new` para `/lancar`, e o
único botão que apontava para `/importar` ficou na tela antiga `screen-new`. Por 26 dias,
**quem tocasse em "Lançar" não tinha como importar fatura** — e foi achado por relato,
não por verificação.

> **Correção de 17/11/2026, e ela importa:** eu afirmei aqui que a tela estava morta e
> que o app ficara sem importação. As duas coisas estavam erradas. O botão `Quitar`, do
> card de acerto, ainda abria a `screen-new` — então a importação era alcançável, por um
> botão escrito "Quitar" que só aparece quando há saldo. A falha real é mais sutil e mais
> comum que "a tela sumiu": **o caminho restante não era o caminho que alguém procuraria.**
> A conclusão errada veio de ler o código — a navegação redireciona, logo a tela é morta —
> em vez de abrir o app e tocar no botão, que é o que mostrou a verdade.

**Por que nenhuma outra camada pega:** todas as outras provam que o destino existe, e o
que sumiu foi o caminho. O `build` listou `/importar` nos dois lados do commit. O
typecheck não tem o que reclamar — ninguém escreveu errado, apenas pararam de escrever.
Os invariantes olham o banco, e o banco estava perfeito. Um teste de tela que navegasse
direto para `/importar` passaria, e é exatamente o que um humano não consegue fazer.
**Falha por ausência não aparece em verificação que parte do que existe.** Só aparece
quando alguém enumera o que deveria existir.

**Como provar:** `npm run checar-rotas`. Verificado que discrimina: desfazendo o conserto,
reprova nomeando `/importar`; com ele, passa.

> **Armadilha que custou duas versões do script:** a primeira versão passava com o app
> quebrado. Ela aceitava o `$('btnImportar').onclick` do `Form.html` como porta — e esse
> handler era o link órfão, pendurado num botão que ninguém encontrava. A segunda versão
> descartava a `screen-new` e toda linha de JS que só mexia em id de lá, com uma exclusão
> feita para se autodestruir quando a tela saísse do arquivo.
>
> **E ela se autodestruiu, no mesmo dia.** A `screen-new` foi aposentada em 17/11/2026, o
> script falhou pedindo a remoção da exclusão, e a exclusão saiu. Vale registrar que a
> parte que funcionou foi a que previa o próprio fim: um recorte que sobrevive ao motivo
> vira buraco permanente, e ninguém revisita exclusão que não reclama.

---

### E2. Escolher o caso de teste que consegue falhar

No rateio, testar com "metade cada" teria escondido os dois bugs de uma vez. **Use caso
assimétrico.** Vale em geral: o caso simétrico costuma ser o que passa por acidente.

### E3. Desconfiar de verificação que passa fácil

Uma função de teste dava "0 divergências" e provava quase nada — usava dados **velhos
embutidos no próprio código**. A prova real exigiu reexportar a base e cruzar com os dados
atualizados.

### E4. Olhar o log de execuções de vez em quando

O bug do `copyTo` com filtro (D3) estava parado no log de produção, sem ninguém ter
reportado. **Erro que aparece na tela e some não vira relato — vira log.**

### E5. Medir antes de corrigir, e dizer o número

Toda correção de dado aqui começou por uma varredura que respondia "quantas linhas estão
assim, e desde quando". Isso decidiu o escopo em todos os casos: 19 sem pagador (todas
antigas), 7 com fórmula velha (só 1 com dano real), 6 fora do acerto. **Sem o número, a
correção vira adivinhação sobre o próprio tamanho.**

---

## O que ficou em aberto — e o que já foi resolvido

Quando este arquivo foi escrito, cinco pontas ficaram abertas para o app novo decidir.
O placar em 28/08/2026:

| Ponta | Situação |
| --- | --- |
| Id de verdade por lançamento, aposentando a assinatura de conteúdo (B2) | ✅ `lancamentos.id` |
| Quitação como tipo próprio, não categoria especial (A11) | ✅ coluna `eh_quitacao` |
| Desempate de lançamentos da mesma data | ✅ `criado_em`, e desempate alfabético na lista |
| Editar parcelamentos e recorrências como série | ✅ tabela `series`, com prévia obrigatória e escopo |
| O rótulo `Conjunta`, legado de antes de `Ambos` (A15) | ⏳ ainda aceito na leitura; converter e aposentar |

A última é a única que sobrou, e continua no Backlog. Enquanto houver dado histórico com
o rótulo antigo, **A15 vale**: aceitar na leitura não é dívida, é a regra.

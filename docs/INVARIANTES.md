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

40 regras escritas. **`scripts/invariantes.ts` verifica 16 delas contra o banco real**,
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

---
name: qualidade
description: Roda a verificação completa de qualidade do Mozi's App 2.0 — testes, tipos, lint, paridade do Form.html, invariantes do banco e, quando pedido, a tela via Playwright. Use sempre que o usuário pedir para "testar o app", "checar se está tudo certo", "rodar os testes", "ver se quebrou alguma coisa", antes de um deploy, depois de mexer em regra de negócio ou no schema, e quando ele perguntar se pode confiar em algum número do acerto. Use também quando o pedido for só "testa aí" — neste projeto isso significa a bateria inteira, não apenas npm test.
---

# Verificação de qualidade do Mozi's App 2.0

Este app já esteve quebrado duas vezes **com a suíte inteira verde**. Entender
por quê é o que dá sentido a tudo aqui:

- O filtro de datas era comparado em JavaScript, onde o driver entrega
  `Date` em meia-noite UTC. Interpolado numa string virava `Invalid Date`, o
  filtro deixava de excluir qualquer coisa, e os três cortes do acerto passaram
  a dar idênticos — escondendo 11 parcelas futuras, R$ 2.719,16.
- A API lia `categoria` onde o front manda `grupo`. Gravar era recusado com
  "Escolha a categoria" **com a categoria escolhida**. Os testes chamavam a API
  com os nomes da própria API, então eram estruturalmente incapazes de notar.

Os dois têm a mesma forma: **o teste repetia a suposição do código em vez de
derivar a resposta de outra fonte.** É por isso que esta verificação insiste em
segundos caminhos — recalcular o saldo por duas rotas independentes, extrair os
nomes de campo do `Form.html` real, conferir o desembolso contra quem pagou.

Um resultado verde só vale alguma coisa se o teste era capaz de ficar vermelho.

## Antes de qualquer coisa: o que nunca se roda

**`npm run sync` faz `TRUNCATE` e apaga a base inteira.** Ele carrega a planilha
`DRE - Casal - v2`, que era a fonte de verdade antes do cutover de 20/08/2026 e
hoje é arquivo histórico congelado. Rodar isso destruiria tudo que foi lançado
no app novo.

Nunca inclua `sync` numa verificação. Se algum dia for genuinamente necessário,
é contra banco descartável e com o usuário sabendo — nunca como efeito colateral
de "rodar os testes".

`npm run reconcile` é inofensivo (só lê), mas compara contra a planilha
congelada. Depois do cutover ele responde uma pergunta histórica, não o estado
atual. Não faz parte desta bateria.

## As camadas, do barato ao caro

Rode nesta ordem e **pare de subir quando algo falhar** — uma falha embaixo
costuma explicar o barulho em cima, e investigar de cima para baixo desperdiça o
tempo do usuário. Todos os comandos rodam a partir de `Mozi's App 2.0/`.

### 1. Lógica e contrato — segundos

```bash
npm test
```

23 casos. Os de `lancamentos.test.ts` cobrem a lógica pura portada do Apps
Script: arredondamento, clamp de fim de mês, a tabela inteira de `pctIrwinDe`,
parcelas onde a última absorve a diferença, quinzenal como +14 dias.

Os de `contrato.test.ts` são de outra natureza e merecem atenção especial: eles
**leem o `Form.html` real** e extraem os nomes de campo que ele envia. Se
falharem, o front e a API discordam sobre como se chamam as coisas — e a regra
do projeto é clara sobre quem cede: o front é o contrato, a API se adapta.

### 2. Tipos e lint — segundos

```bash
npm run typecheck && npm run lint
```

### 3. Sanidade do `Form.html` — instantâneo

```bash
npm run checar-form
```

**A paridade byte a byte com o app antigo terminou em 20/08/2026** — decisão
registrada na regra 2 do `CLAUDE.md`, junto com o último hash que batia. Não
compare mais os dois arquivos: eles divergem de propósito, e um "conserto" aqui
desfaria trabalho.

O que resta verificar é que o arquivo continua íntegro. Ele não passa por build
nenhum — é servido como está, então um erro de sintaxe **não aparece em lugar
nenhum do terminal**: a tela fica em branco no celular e só o console do navegador
conta o que houve. `scripts/checar-form.mjs` analisa cada bloco `<script>` inline e
é o compilador que este arquivo não tem. Verificado que ele falha de verdade,
quebrando o arquivo de propósito — aponta o bloco e a linha.

A contagem de `google.script.run` no fim da saída é o segundo sinal: toda chamada
ao backend passa por ali, sobre o shim. Se o número cair sem que uma feature tenha
sido removida, alguma virou `fetch` solto e escapou da rota única de RPC — que é
onde vive a allowlist de métodos.

E o `contrato.test.ts` da camada 1 cobre a parte que mais importa — que os nomes de
campo do front e da API continuem os mesmos. Agora que os dois lados podem mudar,
ele deixou de ser rede de segurança e virou a checagem principal.

### 4. Invariantes do banco — poucos segundos

```bash
npm run invariantes
```

**É a camada que mais encontra coisa**, porque é a única que olha o dado real.
Dez invariantes, todos só leitura, cada um ligado à regra que protege. O detalhe
que faz diferença: cada um imprime **a medida** mesmo quando passa — "3535
linhas recalculadas, 0 divergem" — para que um número estranho apareça antes de
virar defeito.

Dois deles calculam a mesma grandeza por caminhos independentes:

- `acerto-dois-caminhos` soma o saldo pela view (como a API faz) e outra vez
  em TypeScript, a partir das colunas cruas. Concordância é evidência; a
  divergência vem com o delta medido.
- `pct-congelado` recalcula todas as linhas com `pctIrwinDe()` e compara com o
  que está gravado — pega tanto uma regra que mudou sem migração quanto uma
  gravação que escapou da função.

### 5. Ponta a ponta — meio minuto, quando mexeu em API ou schema

```bash
npm run verificar-e2e
```

Grava um lançamento de verdade pela API, confere **no banco** o que foi gravado,
exercita busca, filtros e ordenação sobre o histórico real, e apaga no fim —
verificando que a contagem voltou ao número original.

⚠️ **Escreve na base.** Não é destrutivo, mas o lançamento `ZZTESTE` existe por
alguns segundos e aparece para quem estiver com o app aberto. Não é problema na
prática; só não vale a pena rodar por hábito quando nada mudou no backend.

É a única camada que cruza API → banco → API, que é onde a regra E1 aponta. Duas
coisas que ele já pegou e que nenhuma outra camada pegaria: uma asserção de
ordenação que passava com **um** item no dia (lista de um item está sempre
ordenada — um teste incapaz de falhar), e a confirmação de que a tag do André não
mexe na divisão do valor.

### 6. Tela — minutos, quando o pedido envolve o front

Só vale a pena quando algo mudou no `Form.html`, no `route.ts` ou num método que
a tela chama. Use a skill **`webapp-testing`** (Playwright).

O ponto que custou tempo antes: **clique nos controles reais.** Setar o estado
interno do formulário por código pula a validação do front, o botão continua
desabilitado, e o clique cai no vazio — sem erro e sem sucesso. Já produziu um
minuto inteiro de "a correção não funcionou" quando ela tinha funcionado.

Clicar nos chips e digitar nos campos é o que exercita o caminho completo.
`elemento.click()` serve: passa pelo mesmo handler que o toque. O que não serve
é atribuir ao estado interno direto.

**Duas armadilhas de leitura, as duas já custaram diagnóstico errado:**

`getComputedStyle` logo depois de mexer no DOM, na MESMA chamada de
`javascript_tool`, devolve valores do frame anterior. Chega a reportar
`blur(2px)` depois de o estilo ter sido limpo. Para conferir CSS, monte os dois
estados numa chamada e leia na chamada seguinte — ou melhor, crie um elemento de
cada estado lado a lado e compare os dois na mesma leitura.

E ao testar um controle que ALTERNA, clique até chegar ao estado desejado em vez
de assumir o inicial: `if (!btn.classList.contains('on')) btn.click()`. Um teste
que supõe o ponto de partida falha quando outra verificação deixou o botão no
outro estado, e o sintoma parece defeito do app.

## Como ler o resultado

O verificador separa **defeito** de **aviso**, e a distinção é deliberada:

- **defeito** — o estado é impossível segundo uma regra. Derruba o comando.
- **aviso** — é suspeito mas pode ser legítimo. Duas compras iguais no mesmo dia
  existem. Não derruba, porque avisos que travam a saída são silenciados na
  primeira vez que incomodam, e aí param de servir para qualquer coisa.

Há também a distinção entre **defeito novo** e **herança**. Lançamentos sem
pagador existem no histórico importado e não são corrigíveis sem saber quem
pagou; o invariante separa esses dos criados no app novo (`linha_origem` nula),
e só os novos são falha. Um check que grita para sempre por algo insolúvel
ensina a ignorar o relatório.

**Ao investigar uma falha, meça antes de concluir.** Quantas linhas? Qual o
efeito em reais? Vieram da planilha ou nasceram aqui? Toda correção de dado
neste projeto começou por uma varredura que respondia "quantas linhas estão
assim" — e mais de uma vez a resposta mudou o diagnóstico.

E desconfie do invariante antes de acusar o app. A primeira versão desta
verificação apontou duas recorrências "com geração no futuro"; uma delas era
perfeitamente normal, porque `ultima_geracao` guarda a data da última
**ocorrência**, e o gerador produz até o fim do mês corrente. O limiar certo é o
fim do mês, não hoje. O check estava errado, não o app — metade de um relatório
falso é pior que nenhum, porque consome confiança.

## O relatório

Termine dizendo, em poucas linhas: o que rodou, o que passou, e para cada
achado — a medida, o efeito em reais quando houver, e se é defeito novo ou
herança. Números concretos, não adjetivos. "0,44 em 11 parcelas de uma série
histórica" informa; "algumas inconsistências menores" não.

Se algo falhar, ofereça a correção mas **não corrija dado sem confirmar** — são
finanças reais de duas pessoas, e o app não tem desfazer.

## Quando um defeito novo aparecer

O ciclo do projeto é: corrigir, e então transformar o defeito em regra portátil.

1. A regra vai para `PARA-O-APP-2.0.md`, no repositório do legado, no formato
   *regra · o que quebra sem ela · **como provar***.
2. Se for verificável automaticamente, a terceira coluna vira um invariante novo
   em `scripts/invariantes.ts`. É assim que o documento deixa de depender de
   alguém lembrar dele.
3. O caso entra na base **Testes** do Notion, com build e dispositivo.

Nenhum valor financeiro vai para o Notion — valores vivem só no banco, para não
existirem duas verdades.

## Referência

- `PARA-O-APP-2.0.md` (repositório do legado) — as 38 regras, com o defeito
  medido que originou cada uma. Vale mais que o `CLAUDE.md`.
- `docs/OPERACAO.md` — diagnóstico por sintoma.
- `docs/ACHADOS-DA-RECONCILIACAO.md` — o que a migração descobriu, com números.

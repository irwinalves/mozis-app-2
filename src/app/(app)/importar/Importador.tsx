'use client';

/**
 * A importação da fatura: escolher o arquivo, revisar linha a linha, lançar.
 *
 * POR QUE UMA ROTA SÓ PARA AS DUAS ETAPAS
 *
 * A análise de 154 linhas nasce de um arquivo do aparelho e não existe no
 * banco até o botão do fim. Passá-la para uma segunda rota exigiria serializar
 * tudo em `sessionStorage` — mais uma cópia da verdade, que é exatamente o que
 * a regra nº 3 proíbe. Duas etapas, um estado.
 *
 * O CRUZAMENTO INFORMA, NUNCA DECIDE
 *
 * Nenhuma linha é lançada nem descartada por ter casado. O que o casamento faz
 * é ORDENAR o trabalho em três abas e escolher o padrão de cada uma — e todas
 * as três aparecem, com o que casou visível, para a validação acontecer sobre
 * o conjunto inteiro. Qualquer linha pode sair da aba onde caiu.
 *
 * O MESMO COMPONENTE EDITA UM LOTE JÁ IMPORTADO
 *
 * Com `edicao`, ele abre direto na revisão, com as decisões que foram tomadas
 * no dia — inclusive as linhas que ficaram DE FORA. Uma segunda tela de
 * revisão "só para editar" seria a mesma tela escrita duas vezes, e a que fica
 * para trás é sempre a que grava errado.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/rpc';
import type {
  analisarFatura,
  previewConciliacao,
  sobrasDoCiclo,
  LinhaParaLancar,
} from '@/lib/api';
import { brl, comSinal, dataBR, diaMes, lerMoeda, mascaraMoeda, numero } from '@/lib/formato';
// `DE_FORA` vem do componente compartilhado: a lista de quem pode ser dono de
// um gasto que não é do casal é UMA, e repeti-la aqui faria a importação e o
// formulário discordarem no dia em que alguém entrar na lista.
/* `DIVISOES` também vem de lá, e isso é a correção de um defeito, não
   arrumação: a lista existia DUAS vezes — aqui, servida por `getOpcoes` sem
   `De fora`, e no componente do rateio, com. Marcar uma linha da fatura como
   gasto de terceiro era impossível justamente por isso. */
import {
  DE_FORA,
  DIVISOES,
  OUTRA,
  ROTULO_DIVISAO,
  partesDe,
  type Divisao,
} from '@/components/DivisaoEPagador';
import { corDaCategoria } from '@/lib/cores';
import { Avatar } from '@/components/Avatar';
import type { Pessoa } from '@/lib/pessoas';

type Analise = Awaited<ReturnType<typeof analisarFatura>>;
type Linha = Analise['linhas'][number];
type Preview = Awaited<ReturnType<typeof previewConciliacao>>;
type Sobras = Awaited<ReturnType<typeof sobrasDoCiclo>>;

interface Opcoes {
  gruposLancar: { nome: string; tipo: string }[];
  pagadores: string[];
  /** Para mostrar a parte de cada um quando a divisão é `Renda`. */
  pctIrwinRenda: number;
}

/** O que o app já tem para uma linha que casou. */
interface LadoApp {
  id: number;
  data: string;
  descricao: string;
  categoria: string;
  tipo: string;
  valor: number;
  divisao: string;
  quemPagou: string | null;
  serieId: number | null;
}
const ladoApp = (a: Linha['app']): LadoApp | null => (a as unknown as LadoApp) ?? null;

const ABAS = [
  { id: 'app', rotulo: 'Já no app' },
  { id: 'parc', rotulo: 'Parcelados' },
  { id: 'novos', rotulo: 'Novos' },
  /* Estornos é aba e não seção recolhível porque ali se DECIDE, não se lê.
     Enquanto era só aviso, a fatura dizia "houve uma devolução" e não havia
     o que fazer a respeito na mesma tela. */
  { id: 'est', rotulo: 'Estornos' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

/**
 * A divisão com que cada linha nasce.
 *
 * O padrão é `100% de quem pagou`: a fatura é de cartão individual e a maioria
 * esmagadora é compra de um só. Dividir tudo meio a meio por omissão criaria
 * dívida entre os dois em 111 linhas de uma vez — e o erro seria silencioso,
 * porque cada linha isolada parece plausível.
 */
const PADRAO_PAGADOR = 'pagador';

/** Um pedaço de uma linha da fatura. Vira um lançamento próprio. */
interface Pedaco {
  valor: number;
  descricao: string;
  grupo: string;
  divisao: string;
  quemPagou: string;
  /** `De fora` — registrado, fora das duas contas. */
  deFora: boolean;
  /** De quem é, quando `deFora`. */
  gastoDe: string;
}

interface Estado {
  marcada: boolean;
  /**
   * `De fora` na LINHA INTEIRA — registrado, fora das duas contas.
   *
   * Existia só no pedaco, e por isso marcar "este gasto é da mãe do Irwin"
   * obrigava a dividir uma linha que tinha um dono só. Três linhas da base
   * foram lançadas assim.
   */
  deFora: boolean;
  /** De quem é, quando `deFora`. Sem ele a dívida não tem dono (A4). */
  gastoDe: string;
  /**
   * Fixa ou Variável — campo do lançamento, não da categoria (A5).
   *
   * Não existia: toda linha de fatura herdava o padrão da categoria e nin-
   * guém tinha como discordar sem reabrir o lançamento depois, um a um.
   */
  tipo: string;
  /**
   * Alguém tocou no tipo. Enquanto ninguém tocou, trocar a categoria arrasta
   * o tipo junto — aqui a categoria foi ADIVINHADA, e corrigir o palpite tem
   * que corrigir o que saiu dele. No Lançar é diferente de propósito: lá a
   * pessoa escolheu a categoria, então nada é arrastado.
   */
  tipoManual: boolean;
  /** De onde saiu o dinheiro. Nasce `Cartão`, que é de onde a fatura vem. */
  origem: string;
  /** Data escolhida nesta revisão. `null` = a da fatura. */
  dataEditada: string | null;
  /** Vazio = o nome da fatura vale. A tela mostra o original apagado atrás. */
  descricao: string;
  grupo: string;
  divisao: string;
  /**
   * Quanto por cento do custo é do Irwin, de 0 a 100 — só quando a divisão é
   * `Custom`, que a tela chama de Valor exato.
   *
   * A fatura não oferecia essa divisão: quem precisasse de um valor exato por
   * pessoa tinha que DIVIDIR a linha em pedacos, o que é outra coisa — pedaco
   * é a mesma compra com dois donos, não a mesma compra repartida em
   * proporção diferente. O backend já aceitava (`pctIrwinCustom` em
   * `gravarLote`); era só a tela que não perguntava.
   */
  pctCustom: number | null;
  quemPagou: string;
  aberta: boolean;
  /** Tirada da aba onde o cruzamento a pôs: passa a valer como gasto novo. */
  forcadaNova: boolean;
  /**
   * A aba em que a linha está SENDO editada.
   *
   * Sem isto, marcar "não é o mesmo gasto" tiraria a linha de baixo do dedo:
   * ela pularia para outra aba no mesmo toque, antes de o nome e a categoria
   * serem ajustados. Fica presa até ser fechada.
   */
  abaTravada: Aba | null;
  /** O valor que o app tem agora — muda quando se adota o da fatura. */
  valorApp: number | null;
  /**
   * O valor DEPOIS do estorno parcial, quando alguém mandou lançar o líquido.
   *
   * Separado de `valorAtual` de propósito: aquele é "o que o lançamento tem
   * hoje no banco" e serve para não desfazer correção alheia ao regravar o
   * lote. Este é uma decisão tomada NESTA revisão. Misturar os dois faria o
   * líquido sobreviver a um reabrir como se fosse o valor original da fatura,
   * e ninguém mais saberia que houve um estorno no meio.
   */
  valorLiquido: number | null;
  /**
   * Os pedaços, quando esta linha da fatura foi dividida. `null` = inteira.
   *
   * O caso que motivou: a conta da Vivo, R$ 359,90, em que uma parte é da mãe
   * do Irwin e volta como reembolso. Lançar o total como gasto do casal erra;
   * não lançar foi o que já aconteceu, e sumiu da conta por meses.
   *
   * A soma dos pedaços TEM que fechar com o valor da linha. Não é preciosismo:
   * dois pedaços que não somam o total criam ou destroem dinheiro, e ninguém
   * percebe olhando uma linha isolada.
   */
  pedacos: Pedaco[] | null;
  /**
   * Ao reabrir um lote: o valor que o LANÇAMENTO tem hoje, que pode não ser
   * mais o da fatura — alguém pode tê-lo corrigido à mão. É ele que é
   * regravado, senão corrigir a categoria de uma linha desfaria a correção de
   * valor de outra pessoa.
   */
  valorAtual?: number | null;
  /** Ao reabrir: este lançamento foi mexido à mão depois da importação. */
  mexidaDepois?: boolean;
}

/** O que fica guardado no lote para a edição poder reabrir a revisão. */
export interface EstadoSalvo {
  analise: Analise;
  est: Record<number, Estado>;
  padraoDivisao: string;
}

/** Como cada linha da fatura está no banco AGORA. */
export type AtualDoLote = Record<
  number,
  {
    parcelas: number;
    descricao: string;
    categoria: string;
    tipo: string;
    divisao: string;
    /** 0 a 100, só quando a divisão é `Custom`. */
    pctCustom: number | null;
    quemPagou: string | null;
    deFora: boolean;
    gastoDe: string | null;
    origem: string | null;
    data: string;
    valor: number;
    total: number;
  }
>;

export function Importador({
  opcoes,
  eu,
  edicao,
}: {
  opcoes: Opcoes;
  eu: Pessoa | null;
  /** Presente quando se está reabrindo um lote já importado. */
  edicao?: { id: number; titulo: string; salvo: EstadoSalvo; atual: AtualDoLote };
}) {
  const router = useRouter();

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [padraoDivisao, setPadraoDivisao] = useState<string>(
    edicao?.salvo.padraoDivisao ?? PADRAO_PAGADOR,
  );
  const [analise, setAnalise] = useState<Analise | null>(edicao?.salvo.analise ?? null);
  /**
   * Ao reabrir, o ponto de partida é o BANCO, não o que a fatura dizia.
   *
   * É o que faz a correção em lote preservar trabalho: quem renomeou uma linha
   * na tela normal encontra aqui o nome que escreveu, e só as linhas que ele
   * mexer nesta tela são regravadas.
   */
  const base = useMemo(
    () => (edicao ? aoReabrir(edicao.salvo, edicao.atual) : {}),
    [edicao],
  );
  const [est, setEst] = useState<Record<number, Estado>>(base);
  const [aba, setAba] = useState<Aba>('app');
  /**
   * De quem são as linhas que nascem MARCADAS, e quais a lista MOSTRA.
   *
   * São duas perguntas separadas de propósito. A fatura do casal vem com os
   * dois cartões — medido na de março: 44 linhas no cartão do Irwin e 42 no da
   * Maria. Antes todas nasciam marcadas, e tirar as do outro custava 42 toques,
   * um por linha. Agora nasce marcado só o cartão de quem está importando, e
   * quem quiser lançar uma linha pelo outro MARCA aquela linha — o contrário
   * de desmarcar 42.
   *
   * O filtro é outra coisa: ele só muda o que está na tela, nunca o que vai
   * ser gravado. Um filtro que mexesse no que entra seria a armadilha que
   * fecha a fatura com metade dos gastos faltando.
   */
  const [donoMarcar, setDonoMarcar] = useState<string>(eu ?? '');
  const [filtroDono, setFiltroDono] = useState<string>('');
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const [confirmando, setConfirmando] = useState(false);

  /** O que mudou desde que a tela abriu — não desde a importação. */
  const original = useMemo(() => assinaturaDe(base), [base]);
  const mudou = !!edicao && assinaturaDe(est) !== original;
  const mexidasDepois = Object.values(base).filter((e) => e.mexidaDepois).length;

  const tipoDoGrupo = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of opcoes.gruposLancar) m.set(g.nome, g.tipo);
    return m;
  }, [opcoes.gruposLancar]);

  // -------------------------------------------------------------------------
  // Etapa 1 — o arquivo
  // -------------------------------------------------------------------------

  async function analisar() {
    if (!arquivo) return;
    setErro('');
    setOcupado('Lendo a fatura…');
    try {
      const b64 = await paraBase64(arquivo);
      const a = await rpc('analisarFatura', b64, arquivo.name);
      const inicial: Record<number, Estado> = {};
      for (const l of a.linhas) {
        const quemPagou = l.quemPagou ?? '';
        inicial[l.i] = {
          // Só nasce marcado o que o cruzamento não achou no app. O que casou
          // entra desmarcado — inclusive a suspeita, que é palpite (C7) e
          // marcar por palpite é como se duplica um gasto.
          // `naSerieNova` fica de fora: a série da linha irmã já a cobre, e
          // marcá-la lançaria o mesmo gasto duas vezes. E `estornada` também:
          // a compra foi cancelada na própria fatura.
          // E só o cartão de quem está importando: ver `donoMarcar`.
          marcada:
            !l.estornada &&
            (l.situacao.tipo === 'nova' || l.situacao.tipo === 'novaSerie') &&
            doDono(quemPagou, donoMarcar),
          descricao: '',
          grupo: l.categoriaSugerida,
          divisao: divisaoInicial(padraoDivisao, quemPagou),
          pctCustom: null,
          quemPagou,
          deFora: false,
          gastoDe: '',
          tipo: tipoDoGrupo.get(l.categoriaSugerida) ?? 'Variável',
          tipoManual: false,
          origem: 'Cartão',
          dataEditada: null,
          aberta: false,
          forcadaNova: false,
          abaTravada: null,
          valorApp: ladoApp(l.app)?.valor ?? null,
          valorLiquido: null,
          pedacos: null,
        };
      }
      setEst(inicial);
      setAnalise(a);
      setAba('app');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler o arquivo.');
    } finally {
      setOcupado('');
    }
  }

  // -------------------------------------------------------------------------
  // Etapa 2 — a revisão
  // -------------------------------------------------------------------------

  // `est` entra na dependência porque `forcadaNova` e `abaTravada` mudam a aba
  // de uma linha.
  const porAba = useMemo(() => {
    const m: Record<Aba, Linha[]> = { app: [], parc: [], novos: [], est: [] };
    for (const l of analise?.linhas ?? []) m[abaDe(l, est[l.i])].push(l);
    return m;
  }, [analise, est]);

  const marcadas = (analise?.linhas ?? []).filter((l) => est[l.i]?.marcada);

  /** Quantos LANÇAMENTOS saem: uma parcelada vira N, e uma dividida vira N × pedaços. */
  const quantosLancamentos = marcadas.reduce(
    (n, l) => n + (parcelasDe(l, est[l.i]) ?? 1) * (est[l.i]?.pedacos?.length || 1),
    0,
  );
  /* A soma usa `valorEfetivo`, a MESMA função que monta o payload.
     Usava `l.valor`, o da fatura, e o rodapé passou a mentir no instante em
     que "lançar o líquido" existiu: a tela dizia R$ 12.037,50 e ia gravar
     R$ 69,14 a menos. Um número que resume o que vai acontecer não pode ser
     calculado por um caminho diferente do que faz acontecer. */
  const somaMarcadas = marcadas.reduce(
    (s, l) => s + somaDaLinha(l, est[l.i]) * (parcelasDe(l, est[l.i]) ?? 1),
    0,
  );
  const semPagador = marcadas.filter((l) => !est[l.i]?.quemPagou || !est[l.i]?.divisao);
  /* Linha dividida cujos pedaços não somam o valor da fatura. A gravação fica
     travada: gravar assim criaria ou destruiria dinheiro, e a diferença não
     aparece olhando uma linha isolada depois. */
  const naoFecham = marcadas.filter((l) => Math.abs(restaDividir(l, est[l.i])) >= 0.005);
  /* `De fora` sem nome. O servidor recusa (`exigirDonoSeDeFora`), e descobrir
     isso só no erro da gravação depois de revisar 167 linhas é caro demais —
     a trava tem que estar do lado de cá também. Vale para a linha inteira e
     para cada pedaco: quem deve devolver o dinheiro tem que ter nome. */
  const semDono = marcadas.filter((l) => {
    const e = est[l.i];
    if (!e) return false;
    if (e.pedacos?.length) return e.pedacos.some((p) => p.deFora && !p.gastoDe.trim());
    return e.deFora && !e.gastoDe.trim();
  });

  const trocar = (i: number, mud: Partial<Estado>) =>
    setEst((s) => ({ ...s, [i]: { ...s[i], ...mud } }));

  /**
   * "Todas" e "nenhuma" valem para o que está NA TELA, não para a aba inteira.
   *
   * Recebe as linhas em vez da aba por isso: com um filtro de dono ativo,
   * marcar a aba inteira marcaria linhas que a pessoa não está vendo — e o
   * sentido do botão é "isto aqui que eu estou olhando".
   */
  function marcarLinhas(linhas: Linha[], valor: boolean) {
    setEst((s) => {
      const novo = { ...s };
      for (const l of linhas) novo[l.i] = { ...novo[l.i], marcada: valor };
      return novo;
    });
  }

  /** Quantas linhas por dono do cartão — é o que os dois seletores mostram. */
  const porDono = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of analise?.linhas ?? []) {
      const q = l.quemPagou ?? '';
      m.set(q, (m.get(q) ?? 0) + 1);
    }
    return m;
  }, [analise]);

  /**
   * Trocar o dono reaplica a marcação de origem, em vez de só filtrar.
   *
   * É uma ação explícita de quem escolheu na lista, então ela pode desfazer
   * marcação feita à mão — e precisa poder: o sentido de "marcar as da Maria"
   * é justamente trocar o conjunto inteiro.
   */
  function remarcarPorDono(dono: string) {
    setDonoMarcar(dono);
    setEst((s) => {
      const novo = { ...s };
      for (const l of analise?.linhas ?? []) {
        const e = novo[l.i];
        if (!e) continue;
        const elegivel =
          !l.estornada &&
          (l.situacao.tipo === 'nova' || l.situacao.tipo === 'novaSerie' || e.forcadaNova);
        novo[l.i] = { ...e, marcada: elegivel && doDono(e.quemPagou, dono) };
      }
      return novo;
    });
  }

  /**
   * O que esta linha da fatura vira: um lançamento, ou N se foi dividida.
   *
   * Devolve sempre uma LISTA. Era uma função que devolvia um objeto, e
   * transformar em lista aqui — em vez de espalhar `if (pedacos)` por cada
   * lugar que usa — é o que mantém a soma do rodapé, a contagem e o payload
   * concordando: todos percorrem a mesma lista.
   */
  const comoLancamentos = (l: Linha, e: Estado): LinhaParaLancar[] => {
    const base = {
      // A data e a origem são da TRANSAÇÃO, então valem também para os
      // pedacos: dividir uma compra em dois donos não a move no tempo nem
      // troca a conta de onde o dinheiro saiu.
      data: e.dataEditada || l.data,
      origem: e.origem,
      tipo: undefined as string | undefined,
      parcelas: parcelasDe(l, e),
      ref: l.i,
    };
    if (e.pedacos?.length) {
      return e.pedacos.map((p, k) => ({
        ...base,
        descricao: (p.descricao.trim() || e.descricao.trim() || l.descricao).trim(),
        valor: p.valor,
        grupo: p.grupo,
        tipo: tipoDoGrupo.get(p.grupo),
        quemPagou: p.quemPagou,
        divisao: p.divisao,
        deFora: p.deFora,
        gastoDe: p.deFora ? p.gastoDe : null,
        // 1-based, como `seq`: o pedaço 1 é o primeiro, não o zero.
        pedaco: k + 1,
      }));
    }
    return [
      {
        ...base,
        descricao: (e.descricao.trim() || l.descricao).trim(),
        valor: valorEfetivo(l, e),
        grupo: e.grupo,
        tipo: e.tipo,
        quemPagou: e.quemPagou,
        divisao: e.divisao,
        /* Só `Custom` carrega porcentagem. Mandar um número junto de `50/50`
           seria guardar no banco uma segunda resposta para a mesma pergunta,
           e as duas divergiriam na primeira edição. */
        pctIrwinCustom: e.divisao === 'Custom' ? (e.pctCustom ?? 50) : null,
        deFora: e.deFora,
        /* `e.gastoDe` e não `e.deFora ? ... : null`: a mesma coluna guarda as
           duas coisas, e são diferentes. `De fora` tira o gasto das contas de
           vocês; marcar como do André só diz de quem ele é e não mexe em nada.
           Zerar aqui quando não é `De fora` jogaria fora o botão do André. */
        gastoDe: e.gastoDe || null,
        pedaco: 1,
      },
    ];
  };

  function paraLancar(): LinhaParaLancar[] {
    return marcadas.flatMap((l) => comoLancamentos(l, est[l.i]));
  }

  /**
   * O diferencial de uma correção em lote.
   *
   * Só entra o que MUDOU nesta tela. Uma linha que ninguém tocou não vai nem
   * para `linhas` nem para `apagar`, e por isso o lançamento dela não é
   * reescrito — é assim que o trabalho feito à mão sobrevive.
   */
  function diferencial(): { linhas: LinhaParaLancar[]; apagar: number[] } {
    const linhas: LinhaParaLancar[] = [];
    const apagar: number[] = [];
    for (const l of analise?.linhas ?? []) {
      const agora = est[l.i];
      const antes = base[l.i];
      if (!agora || assinaturaLinha(agora) === assinaturaLinha(antes)) continue;
      if (agora.marcada) linhas.push(...comoLancamentos(l, agora));
      else apagar.push(l.i);
    }
    return { linhas, apagar };
  }

  async function lancar() {
    if (!analise || !marcadas.length) return;
    setErro('');
    setOcupado(edicao ? 'Regravando…' : 'Lançando…');
    try {
      const salvo: EstadoSalvo = { analise, est: aoSalvar(est), padraoDivisao };
      if (edicao) {
        await rpc('ajustarImportacao', edicao.id, diferencial(), { estado: salvo });
        router.push(`/importacao/${edicao.id}`);
      } else {
        const r = await rpc('lancarFatura', paraLancar(), {
          titulo: tituloDa(analise),
          arquivo: analise.arquivo,
          criadaPor: eu,
          estado: salvo,
        });
        router.push(`/importacao/${r.importacaoId}`);
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gravar.');
      setOcupado('');
      setConfirmando(false);
    }
  }

  // -------------------------------------------------------------------------

  if (!analise) {
    return (
      <>
        <div className="conteudo">
          <div className="pad">
            {erro && <div className="msg-erro">{erro}</div>}

            <div className="card">
              <div className="campo">
                <label>O que é este arquivo</label>
                <div className="seg">
                  <button type="button" className="on">
                    Cartão de crédito
                  </button>
                  <button type="button" disabled title="Ainda não">
                    Conta corrente
                  </button>
                </div>
                {/* C7 — a tela pergunta em vez de adivinhar. No cartão o gasto
                    é POSITIVO; no extrato de conta é negativo. Aplicar a regra
                    errada não dá erro: descarta tudo que interessa, calado. */}
                <div className="dica">
                  O extrato de conta ainda não entra — ele vem em <code>.xls</code> antigo, que
                  precisa de outra biblioteca.
                </div>
              </div>

              <div className="campo">
                <label>Arquivo da fatura</label>
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={(ev) => setArquivo(ev.target.files?.[0] ?? null)}
                />
                {arquivo && <div className="dica">{arquivo.name}</div>}
              </div>

              <div className="campo">
                <label>Divisão padrão das linhas</label>
                <div className="seg seg-quebra">
                  {[
                    { v: PADRAO_PAGADOR, r: 'De quem pagou' },
                    { v: '50/50', r: '50/50' },
                    { v: '100% Irwin', r: '100% Irwin' },
                    { v: '100% Maria', r: '100% Maria' },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      className={padraoDivisao === o.v ? 'on' : ''}
                      onClick={() => setPadraoDivisao(o.v)}
                    >
                      {o.r}
                    </button>
                  ))}
                </div>
                <div className="dica">
                  Cada linha pode ser mudada depois. O padrão é <b>de quem pagou</b> porque o
                  cartão é individual e a maioria é compra de um só.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="barra-acao">
          <button
            className={`btn-full ${arquivo && !ocupado ? 'valido' : ''}`}
            disabled={!arquivo || !!ocupado}
            onClick={analisar}
          >
            {ocupado || 'Analisar fatura'}
          </button>
        </div>
      </>
    );
  }

  /* O filtro é LENTE: muda o que está na tela, nunca o que vai ser gravado.
     O rodapé continua somando `marcadas`, que não passa por aqui. */
  const lista = filtroDono
    ? porAba[aba].filter((l) => (est[l.i]?.quemPagou ?? '') === filtroDono)
    : porAba[aba];

  return (
    <>
      <div className="conteudo">
        <div className="pad">
          {erro && <div className="msg-erro">{erro}</div>}

          <div className="card suave resumo-fat">
            <div className="nome">{edicao ? edicao.titulo : analise.arquivo}</div>
            <div className="l2">
              <b>{brl(analise.total)}</b> · {analise.linhas.length} linhas
            </div>
            {analise.descartadas.length > 0 && (
              <div className="l3">
                {analise.descartadas.length} descartadas: pagamento da fatura, estorno e crédito
                não são gasto novo.
              </div>
            )}
          </div>

          {edicao && (
            <div className="campos-lanc" style={{ marginBottom: 10 }}>
              {/* Dobrada como as outras: a frase que muda o que você faz é a
                  primeira; o resto é o contrato da gravação, que interessa uma
                  vez e não em toda abertura da tela. */}
              <Nota
                detalhe={
                  <>
                    Só as linhas que você mexer aqui são regravadas — o resto fica
                    exatamente como está.
                  </>
                }
              >
                Correção em lote: as linhas abrem <b>como estão no app hoje</b>.
              </Nota>
              {mexidasDepois > 0 && (
                <div className="dica" style={{ marginTop: 5 }}>
                  {mexidasDepois === 1
                    ? '1 linha foi editada à mão'
                    : `${mexidasDepois} linhas foram editadas à mão`}{' '}
                  depois da importação, e aparecem com o selo <b>mudou no app</b>.
                </div>
              )}
            </div>
          )}

          {/* Os dois seletores só aparecem quando a fatura TEM dois cartões.
              Numa fatura de um dono só eles não decidem nada, e campo que não
              decide nada é ruído em cima do que decide. */}
          {porDono.size > 1 && (
            <div className="card filtro-dono">
              {/* "Marcar as de" NÃO existe ao reabrir um lote. Ali marcado quer
                  dizer "está lançado no banco", e desmarcar APAGA o lançamento
                  — trocar o dono apagaria de uma vez as 44 linhas do outro
                  cartão. Numa importação nova, marcado quer dizer "vai ser
                  criado", e aí o seletor é justamente o atalho. */}
              {!edicao && (
                <label>
                  <span>Marcar as de</span>
                  <select value={donoMarcar} onChange={(ev) => remarcarPorDono(ev.target.value)}>
                    {[...porDono.entries()].map(([q, n]) => (
                      <option key={q || '(sem)'} value={q}>
                        {q || 'Sem dono no cartão'} — {n} {n === 1 ? 'linha' : 'linhas'}
                      </option>
                    ))}
                    <option value="">Todas — {analise.linhas.length} linhas</option>
                  </select>
                </label>
              )}
              <label>
                <span>Mostrar</span>
                <select value={filtroDono} onChange={(ev) => setFiltroDono(ev.target.value)}>
                  <option value="">Todas — {analise.linhas.length} linhas</option>
                  {[...porDono.entries()].map(([q, n]) => (
                    <option key={q || '(sem)'} value={q}>
                      {q || 'Sem dono no cartão'} — {n} {n === 1 ? 'linha' : 'linhas'}
                    </option>
                  ))}
                </select>
              </label>
              {!edicao && donoMarcar && (
                <Nota
                  detalhe={
                    <>
                      Continuam na lista, para você ver que existem — mas não sobem. Para
                      lançar uma por quem não é você, basta <b>marcar aquela linha</b>.
                    </>
                  }
                >
                  As linhas dos outros cartões chegam <b>desmarcadas</b>.
                </Nota>
              )}
            </div>
          )}

          <div className="abas">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={aba === a.id ? 'on' : ''}
                onClick={() => setAba(a.id)}
              >
                {a.rotulo}
                <b>{a.id === 'est' ? (analise.estornos ?? []).length : porAba[a.id].length}</b>
              </button>
            ))}
          </div>

          {aba === 'app' && (
            <div className="dica dica-aba">
              Nada aqui será lançado de novo. Confira, e onde o valor divergir você pode adotar o
              da fatura — isso muda o acerto do mês.
            </div>
          )}
          {aba === 'parc' && (
            <div className="dica dica-aba">
              Cada uma vira a série inteira, com as parcelas futuras já lançadas. É o que faz a
              fatura do mês que vem reconhecer a parcela 2 em vez de duplicar.
            </div>
          )}
          {aba === 'novos' && (
            <div className="dica dica-aba">
              A categoria é palpite pelo texto e erra bastante — toque na linha para mudar o nome
              e a categoria.
            </div>
          )}
          {aba === 'est' && (
            <div className="dica dica-aba">
              O que o cartão devolveu nesta fatura, e a compra de cada devolução. Decida aqui: a
              compra cancelada <b>não é lançada</b>, e a devolvida em parte <b>entra pelo
              líquido</b>.
            </div>
          )}

          {aba === 'est' ? (
            <PainelEstornos
              analise={analise}
              est={est}
              onTrocar={trocar}
            />
          ) : (
          <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
            <div className="titulo-lista">
              <span>
                {lista.filter((l) => est[l.i]?.marcada).length} marcadas
                {filtroDono && porAba[aba].length > lista.length && (
                  <> · {porAba[aba].length - lista.length} fora do filtro</>
                )}
              </span>
              <span className="acoes-lista">
                <button type="button" onClick={() => marcarLinhas(lista, true)}>
                  todas
                </button>
                <button type="button" onClick={() => marcarLinhas(lista, false)}>
                  nenhuma
                </button>
              </span>
            </div>

            {lista.length === 0 ? (
              <div className="vazio">Nada nesta aba.</div>
            ) : (
              lista.map((l) => (
                <LinhaFatura
                  key={l.i}
                  linha={l}
                  estado={est[l.i]}
                  opcoes={opcoes}
                  eu={eu}
                  padraoDivisao={padraoDivisao}
                  onTrocar={(m) => trocar(l.i, m)}
                />
              ))
            )}
          </div>
          )}

          {/* Embaixo dos cruzamentos, e não numa quinta aba: as quatro abas são
              uma PARTIÇÃO da fatura — 36 + 4 + 46 + 8 fecha o arquivo. Isto é
              de outro universo, lançamentos do app sem caixinha, e numa aba o
              número dele pareceria somar com os outros. */}
          {aba === 'app' && (
            <SobrasDoCiclo analise={analise} importacaoId={edicao?.id ?? null} />
          )}
        </div>
      </div>

      <div className="barra-acao">
        {naoFecham.length > 0 && (
          <div className="aviso" style={{ marginTop: 0, marginBottom: 9 }}>
            <span>⚠</span>
            <div>
              {naoFecham.length === 1 ? 'Uma linha dividida não fecha' : `${naoFecham.length} linhas divididas não fecham`}{' '}
              com o valor da fatura. Gravar assim <b>criaria ou perderia dinheiro</b> sem aparecer
              em lugar nenhum.
            </div>
          </div>
        )}

        {semDono.length > 0 && (
          <div className="aviso" style={{ marginTop: 0, marginBottom: 9 }}>
            <span>⚠</span>
            <div>
              {semDono.length === 1
                ? 'Uma linha está marcada'
                : `${semDono.length} linhas estão marcadas`}{' '}
              como <b>De fora sem dizer de quem é o gasto</b>. Sem o nome o gasto sai das suas
              contas e também da dívida de quem deve devolver.
            </div>
          </div>
        )}

        {semPagador.length > 0 && (
          <div className="aviso" style={{ marginTop: 0, marginBottom: 9 }}>
            <span>⚠</span>
            <div>
              {semPagador.length === 1
                ? 'Uma linha marcada está'
                : `${semPagador.length} linhas marcadas estão`}{' '}
              <b>sem pagador ou sem divisão</b>. Sem isso a linha fica fora do acerto sem aviso
              nenhum, e o servidor recusa.
            </div>
          </div>
        )}

        {edicao ? (
          <>
            <button
              className={`btn-full ${mudou && !semPagador.length && !naoFecham.length && !semDono.length && !ocupado ? 'valido' : ''}`}
              disabled={
                !mudou ||
                semPagador.length > 0 ||
                naoFecham.length > 0 ||
                semDono.length > 0 ||
                !!ocupado
              }
              onClick={() => (confirmando ? lancar() : setConfirmando(true))}
            >
              {ocupado ||
                (!mudou ? 'Nada mudou ainda' : confirmando ? 'Confirmar' : 'Importar com ajustes')}
              {!ocupado && mudou && (
                <b>{resumoDoDiferencial(diferencial())}</b>
              )}
            </button>
            <button
              type="button"
              className="btn-linha"
              onClick={() =>
                confirmando ? setConfirmando(false) : router.push(`/importacao/${edicao.id}`)
              }
            >
              {confirmando ? 'Voltar' : 'Cancelar edição'}
            </button>
          </>
        ) : (
          <button
            className={`btn-full ${marcadas.length && !semPagador.length && !naoFecham.length && !semDono.length && !ocupado ? 'valido' : ''}`}
            disabled={
              !marcadas.length ||
              semPagador.length > 0 ||
              naoFecham.length > 0 ||
              semDono.length > 0 ||
              !!ocupado
            }
            onClick={lancar}
          >
            {ocupado || `Lançar ${marcadas.length} · ${brl(somaMarcadas)}`}
            {!ocupado && quantosLancamentos !== marcadas.length && (
              <b>{quantosLancamentos} lançamentos, contando as parcelas futuras</b>
            )}
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Os estornos da própria fatura
// ---------------------------------------------------------------------------

/**
 * O que foi devolvido dentro desta fatura, e o que cada devolução cancela.
 *
 * `<details>` e não estado em React: recolher e abrir é exatamente o que o
 * elemento já faz, com teclado e leitor de tela de graça. Abre junto com a
 * tela, porque um estorno que ninguém vê é o que faz uma compra cancelada
 * virar série de doze parcelas; fecha num toque, porque oito linhas fixas
 * comem a tela antes de a revisão começar.
 *
 * Os de centavos vão para uma linha só no rodapé. Dar peso igual a −R$ 0,01 e
 * a −R$ 1.188,00 é transformar um aviso em parede.
 */
/**
 * O que uma devolução cancela entre os lançamentos JÁ GRAVADOS, e o botão.
 *
 * Separado do resto do painel porque a natureza da ação é outra: aqui a
 * importação mexe em dado FORA do próprio lote. Toda ação pede confirmação
 * dizendo id, data e valor, e nenhuma acontece em lote.
 */
function AchadoNoAppUI({
  achado,
  jaFeito,
  aoFazer,
}: {
  achado: NonNullable<Analise['estornosNoApp']>[number]['achado'];
  jaFeito: boolean;
  aoFazer: (o: { tipo: 'excluir' | 'ajustar'; ids: number[]; valor?: number }) => void;
}) {
  if (achado.tipo === 'nada') return null;

  if (achado.tipo === 'semEncaixe') {
    return (
      <div className="est-app">
        <div className="rot">No app, do mesmo lojista</div>
        <div className="est-pergunta">
          {achado.ids.length} lançamento{achado.ids.length === 1 ? '' : 's'} de{' '}
          {achado.valores.slice(0, 4).map((v) => brl(v)).join(', ')}
          {achado.valores.length > 4 ? '…' : ''}. <b>Nenhum valor encaixa</b> com esta devolução —
          o app não escolhe por você.
        </div>
      </div>
    );
  }

  const rotulo =
    achado.tipo === 'serie'
      ? `A compra inteira está no app: ${achado.ids.length} parcelas, ${brl(achado.valor)}`
      : achado.tipo === 'lancamento'
        ? `Está no app: 1 lançamento de ${brl(achado.valor)}`
        : achado.tipo === 'parcelas'
          ? `A fatura cancelou ${achado.canceladas} parcelas de ${brl(achado.valorParcela)}. O app tem ${achado.noApp} lançada${achado.noApp === 1 ? '' : 's'}.`
          : `Está no app por ${brl(achado.valorAtual)}`;

  return (
    <div className="est-app">
      <div className="rot">
        No app
        {achado.confianca === 'media' && <span className="confia">confira antes</span>}
      </div>
      <div className="est-diz">{rotulo}</div>
      <div className="est-acoes">
        {achado.tipo === 'parcial' ? (
          <button
            type="button"
            className={jaFeito ? 'feito' : 'perigo'}
            disabled={jaFeito}
            onClick={() => aoFazer({ tipo: 'ajustar', ids: achado.ids, valor: achado.valorSugerido })}
          >
            {jaFeito ? '✓ Ajustado' : `Baixar para ${brl(achado.valorSugerido)}`}
          </button>
        ) : (
          <button
            type="button"
            className={jaFeito ? 'feito' : 'perigo'}
            disabled={jaFeito}
            onClick={() => aoFazer({ tipo: 'excluir', ids: achado.ids })}
          >
            {jaFeito
              ? '✓ Excluído'
              : `Excluir ${achado.ids.length === 1 ? 'o lançamento' : `os ${achado.ids.length} lançamentos`}`}
          </button>
        )}
      </div>
    </div>
  );
}

function PainelEstornos({
  analise,
  est,
  onTrocar,
}: {
  analise: Analise;
  est: Record<number, Estado>;
  onTrocar: (i: number, m: Partial<Estado>) => void;
}) {
  /* O que já foi feito nos lançamentos antigos, nesta sessão. Fica aqui e não
     no estado da linha porque não é propriedade de linha nenhuma da fatura —
     é um efeito já aplicado no banco, e o botão não pode voltar atrás
     sozinho: desfazer uma exclusão é relançar, não desclicar. */
  const [feitos, setFeitos] = useState<Record<number, true>>({});
  const [erroApp, setErroApp] = useState('');
  const noApp = new Map((analise.estornosNoApp ?? []).map((x) => [x.i, x.achado]));

  async function agir(
    k: number,
    o: { tipo: 'excluir' | 'ajustar'; ids: number[]; valor?: number },
  ) {
    const texto =
      o.tipo === 'excluir'
        ? `Excluir ${o.ids.length === 1 ? 'o lançamento' : `os ${o.ids.length} lançamentos`} de uma compra cancelada?\n\nIsto mexe em dado que JÁ ESTÁ no app, fora desta importação, e não pode ser desfeito.`
        : `Baixar o valor para ${brl(o.valor ?? 0)}?\n\nIsto mexe em um lançamento que JÁ ESTÁ no app, fora desta importação.`;
    if (!window.confirm(texto)) return;
    setErroApp('');
    try {
      if (o.tipo === 'excluir') {
        for (const id of o.ids) await rpc('excluirLancamento', id);
      } else {
        await rpc('ajustarValorLancamento', o.ids[0], o.valor, 'Estorno parcial na fatura');
      }
      setFeitos((f) => ({ ...f, [k]: true }));
    } catch (e) {
      setErroApp(e instanceof Error ? e.message : 'Não deu para aplicar.');
    }
  }
  /*
   * `?? []` não é paranoia: um lote importado ANTES desta seção existir
   * guardou um `estado` sem o campo, e a edição reabre exatamente esse JSON.
   * Sem a guarda, abrir a importação de ontem quebra a tela — e quem abre uma
   * importação antiga é justamente quem quer corrigi-la.
   */
  const todos = analise.estornos ?? [];
  const porI = new Map(analise.linhas.map((l) => [l.i, l]));

  if (!todos.length) {
    return (
      <div className="card">
        <div className="vazio">Nenhuma devolução nesta fatura.</div>
      </div>
    );
  }

  const soma = todos.reduce((a, e) => a + Math.abs(e.negativa.valor), 0);

  return (
    <div className="card painel-est">
      <div className="titulo-lista">
        <span>
          {todos.length} {todos.length === 1 ? 'devolução' : 'devoluções'}
        </span>
        <span className="soma-est">−{brl(soma)}</span>
      </div>

      {todos.map((e, k) => {
        const v = e.vinculo;
        const refs = v.tipo === 'solto' ? [] : v.refs;
        const alvos = refs.map((i) => porI.get(i)).filter(Boolean) as Linha[];
        const bruto = Math.abs(e.negativa.valor);

        /* INTEGRAL e LINHA: a compra foi cancelada, então não se lança.
           A ação é desmarcar — e é reversível, porque desmarcar não apaga
           nada: só tira a linha do que vai ser gravado. */
        const todasFora = alvos.length > 0 && alvos.every((l) => !est[l.i]?.marcada);
        const cancela = v.tipo === 'integral' || v.tipo === 'linha';

        /* PARCIAL: o cartão devolveu PARTE. Com uma candidata só, dá para
           oferecer o líquido. Com várias, a tela PERGUNTA em vez de adivinhar:
           na fatura de setembro o estorno Apple de R$ 3,50 tinha seis compras
           Apple no mês e não casava com o valor de nenhuma. Chutar ali seria
           mexer no dinheiro de vocês por conta própria (C7). */
        const umaSo = v.tipo === 'parcial' && alvos.length === 1 ? alvos[0] : null;

        return (
          <div key={k} className={'est-item' + (cancela ? ' forte' : '')}>
            <div className="est-topo">
              <span className="est-valor">−{brl(bruto)}</span>
              <span className="est-nome">{e.negativa.descricao}</span>
            </div>

            <div className="est-diz">
              {v.tipo === 'integral'
                ? `Cancela a compra inteira — ${refs.length} ${refs.length === 1 ? 'linha' : 'linhas'}`
                : v.tipo === 'linha'
                  ? 'Cancela uma compra desta fatura, de mesmo valor'
                  : v.tipo === 'parcial'
                    ? `Devolveu parte · ${alvos.length} ${alvos.length === 1 ? 'compra do mesmo lojista' : 'compras do mesmo lojista'}`
                    : 'Não corresponde a nenhuma compra desta fatura'}
            </div>

            {alvos.length > 0 && (
              <ul className="est-alvos">
                {alvos.map((l) => {
                  const liq = est[l.i]?.valorLiquido;
                  return (
                    <li key={l.i} className={est[l.i]?.marcada ? '' : 'fora'}>
                      <span className="nm">{est[l.i]?.descricao?.trim() || l.descricao}</span>
                      <span className="vl">
                        {liq != null ? (
                          <>
                            <s>{brl(l.valor)}</s> {brl(liq)}
                          </>
                        ) : (
                          brl(l.valor)
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="est-acoes">
              {cancela && (
                <button
                  type="button"
                  className={todasFora ? 'feito' : ''}
                  onClick={() =>
                    alvos.forEach((l) => onTrocar(l.i, { marcada: !todasFora }))
                  }
                >
                  {todasFora
                    ? `✓ Fora do lote (${alvos.length})`
                    : `Não lançar ${alvos.length === 1 ? 'esta compra' : `estas ${alvos.length}`}`}
                </button>
              )}

              {umaSo && (
                <button
                  type="button"
                  className={est[umaSo.i]?.valorLiquido != null ? 'feito' : ''}
                  onClick={() =>
                    onTrocar(umaSo.i, {
                      valorLiquido:
                        est[umaSo.i]?.valorLiquido != null
                          ? null
                          : Math.round((umaSo.valor - bruto) * 100) / 100,
                    })
                  }
                >
                  {est[umaSo.i]?.valorLiquido != null
                    ? `✓ Lançando ${brl(est[umaSo.i].valorLiquido as number)}`
                    : `Lançar o líquido, ${brl(umaSo.valor - bruto)}`}
                </button>
              )}

              {v.tipo === 'parcial' && alvos.length > 1 && (
                <span className="est-pergunta">
                  Qual delas foi reduzida? Abra a linha na aba de origem e ajuste o valor —
                  o app não escolhe por você.
                </span>
              )}

              {v.tipo === 'solto' && !noApp.get(k) && (
                <span className="est-pergunta">
                  Compra de outro mês, ou ajuste do banco. Nada a fazer aqui.
                </span>
              )}
            </div>

            {/* O par pode estar no APP, não na fatura — é o caso Hering. */}
            {noApp.get(k) && (
              <AchadoNoAppUI
                achado={noApp.get(k)!}
                jaFeito={!!feitos[k]}
                aoFazer={(o) => agir(k, o)}
              />
            )}
          </div>
        );
      })}
      {erroApp && <p className="erro">{erroApp}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A linha
// ---------------------------------------------------------------------------

/**
 * O que está lançado no app, no ciclo deste cartão, e a fatura não explicou.
 *
 * Nasceu de um caso real: "Anthropic" na fatura, "Claude" já lançado à mão. O
 * cruzamento não liga os dois — nome diferente —, e o Irwin conferia num
 * SEGUNDO CELULAR o que já estava no app naqueles dias. Isto põe essa conferência
 * na própria tela.
 *
 * NASCE FECHADA, numa linha só. A pergunta "isto já está lá?" é a exceção da
 * revisão, não a regra, e uma lista aberta embaixo de 36 cruzamentos seria
 * parede. A consulta corre ao abrir a aba, para o NÚMERO já estar no título —
 * é ele que diz se vale abrir.
 */
function SobrasDoCiclo({
  analise,
  importacaoId,
}: {
  analise: Analise;
  importacaoId: number | null;
}) {
  // O ciclo vem das linhas À VISTA: as parceladas carregam a data da compra
  // original e esticariam a janela por meses (ver `sobrasDoCiclo`).
  const ciclo = useMemo(() => {
    const datas = analise.linhas
      .filter((l) => !l.parcela)
      .map((l) => l.data)
      .sort();
    return datas.length ? { ini: datas[0], fim: datas[datas.length - 1] } : null;
  }, [analise]);
  const explicados = useMemo(
    () =>
      analise.linhas
        .map((l) => ladoApp(l.app)?.id)
        .filter((x): x is number => typeof x === 'number'),
    [analise],
  );
  const [dados, setDados] = useState<Sobras | null>(null);
  const [erro, setErro] = useState('');
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    if (!ciclo) return;
    let viva = true;
    rpc('sobrasDoCiclo', ciclo.ini, ciclo.fim, explicados, importacaoId)
      .then((d) => {
        if (viva) setDados(d);
      })
      .catch((e) => {
        if (viva) setErro(e instanceof Error ? e.message : 'Não consegui consultar o app.');
      });
    return () => {
      viva = false;
    };
  }, [ciclo, explicados, importacaoId]);

  if (!ciclo) return null;
  const n = dados ? dados.cartao.length : null;

  return (
    <div className="sobras">
      <button
        type="button"
        className="sobras-puxa"
        aria-expanded={aberta}
        disabled={!n}
        onClick={() => setAberta(!aberta)}
      >
        <span className="seta" aria-hidden="true">
          {aberta ? '\u25be' : '\u25b8'}
        </span>
        <span className="tit">
          De cartão, no app, e não nesta fatura
          <small>
            {dataBR(ciclo.ini).slice(0, 5)} a {dataBR(ciclo.fim).slice(0, 5)} — o ciclo deste
            cartão
          </small>
        </span>
        <span className={'conta' + (n ? ' tem' : '')}>{erro ? '!' : n === null ? '…' : n}</span>
      </button>

      {erro && <p className="sobras-nota">{erro}</p>}

      {aberta && dados && n ? (
        <div className="sobras-miolo">
          <p className="sobras-alerta">
            {n === 1 ? 'Um gasto lançado' : `${n} gastos lançados`} <b>como cartão</b> neste
            ciclo que a fatura não trouxe. Ou foram de outro cartão, ou já estão lançados duas
            vezes.
          </p>
          {dados.cartao.map((l) => {
            const { dia, mes } = diaMes(l.data);
            return (
              <div key={l.id} className="sobras-item">
                <span className="dt">
                  {dia}
                  <br />
                  {mes}
                </span>
                <span className="nm">{l.descricao}</span>
                <span className="vl">{brl(l.valor)}</span>
              </div>
            );
          })}
          {dados.splitwise > 0 && (
            <p className="sobras-fora">
              Outros <b>{dados.splitwise}</b> lançamentos deste ciclo vieram do Splitwise, pelos
              grupos Mozi e Família. Lá o meio de pagamento nunca foi registrado, então eles ficam
              fora desta comparação.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Uma explicação da tela. Com `detalhe`, ela chega DOBRADA: à vista fica a
 * frase que decide alguma coisa, e o porquê abre no toque.
 *
 * Existe porque a revisão acumulou seis blocos de explicação, cada um quase do
 * tamanho de uma linha de gasto. Quem revisa 86 linhas lê a parede uma vez e
 * passa a ignorar todas — inclusive a que importava. Sem `detalhe` ela é um
 * parágrafo comum: nota curta não ganha nada em virar botão, e dobrar uma
 * instrução que a pessoa PRECISA seguir seria esconder o trabalho.
 */
function Nota({ children, detalhe }: { children: ReactNode; detalhe?: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  if (!detalhe) return <p className="nota">{children}</p>;
  return (
    <div className="nota">
      <button
        type="button"
        className="puxa"
        aria-expanded={aberta}
        onClick={() => setAberta(!aberta)}
      >
        <span>{children}</span>
        <span className="seta" aria-hidden="true">
          {aberta ? '▲' : '▼'}
        </span>
      </button>
      {aberta && <div className="detalhe">{detalhe}</div>}
    </div>
  );
}

/** O cadeado dos campos que vêm da fatura e não mudam: data e quem pagou. */
function Cadeado() {
  return (
    <svg
      className="cadeado"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function LinhaFatura({
  linha: l,
  estado: e,
  opcoes,
  eu,
  padraoDivisao,
  onTrocar,
}: {
  linha: Linha;
  estado: Estado;
  opcoes: Opcoes;
  eu: Pessoa | null;
  padraoDivisao: string;
  onTrocar: (m: Partial<Estado>) => void;
}) {
  const { dia, mes } = diaMes(l.data);
  const app = ladoApp(l.app);
  const s = l.situacao;
  const casou = !e.forcadaNova && (s.tipo === 'jaLancado' || s.tipo === 'suspeita');
  const serie = !e.forcadaNova && s.tipo === 'novaSerie' ? s.parcelas : null;
  const naSerie = !e.forcadaNova && s.tipo === 'naSerieNova' ? s : null;
  const nome = e.descricao.trim() || l.descricao;
  const editada = foiEditada(l, e, padraoDivisao);

  // A divergência é medida contra o valor que o app tem AGORA — depois de uma
  // conciliação ela some, e some sozinha.
  const dif = e.valorApp === null ? null : arred(l.valor - e.valorApp);

  /** Fechar solta a trava: só então a linha vai para a aba a que pertence. */
  const alternar = () =>
    onTrocar(e.aberta ? { aberta: false, abaTravada: null } : { aberta: true });

  /* Trocar a categoria arrasta o tipo junto enquanto ninguém tiver tocado no
     tipo — ver `Estado.tipoManual` para por que aqui, e não no Lançar. */
  const trocarGrupo = (nome: string) =>
    onTrocar(
      e.tipoManual
        ? { grupo: nome }
        : { grupo: nome, tipo: opcoes.gruposLancar.find((g) => g.nome === nome)?.tipo ?? e.tipo },
    );

  const valorLinha = valorEfetivo(l, e);
  /* A linha foi quebrada em pedacos. Dali em diante, categoria, tipo, quem
     pagou e a divisão valem POR PEDACO — `comoLancamentos` nem olha os da
     linha. Continuar aceitando toque neles é oferecer um controle que não
     controla nada, e quem mexesse ia jurar que tinha mexido. */
  const dividida = !!e.pedacos?.length;
  /* A conta mora em `partesDe`, junto do resto do rateio: com `De fora` as
     DUAS partes são zero, e fazer "total menos a do Irwin" aqui dava
     "Irwin R$ 0,00 · Maria R$ 90,00" num gasto que não é de nenhum dos dois. */
  const partes = partesDe(
    valorLinha,
    e.divisao as Divisao,
    e.deFora,
    opcoes.pctIrwinRenda,
    e.pctCustom,
  );
  const custom = !e.deFora && e.divisao === 'Custom';

  /**
   * O texto cru do campo que está sob o dedo, igual ao do Lançar.
   *
   * Sem isto, reescrever os dois lados a cada tecla faz o cursor pular e
   * atropela o que está sendo digitado — `1` vira `1,00` antes de virar `10`.
   * O outro lado continua derivado da porcentagem, que é a verdade gravada.
   */
  const [digitando, setDigitando] = useState<{ lado: 'irwin' | 'maria'; texto: string } | null>(
    null,
  );

  function digitouParte(qual: 'irwin' | 'maria', texto: string) {
    setDigitando({ lado: qual, texto });
    if (valorLinha <= 0) return;
    const v = Math.min(Math.max(lerMoeda(texto), 0), valorLinha);
    const pct = ((qual === 'irwin' ? v : valorLinha - v) / valorLinha) * 100;
    onTrocar({ pctCustom: Math.round(pct * 100) / 100 });
  }

  return (
    <div className={`linha-fat${e.marcada ? ' marcada' : ''}`}>
      <div className="topo" onClick={alternar} role="button" tabIndex={0}>
        <input
          type="checkbox"
          checked={e.marcada}
          onClick={(ev) => ev.stopPropagation()}
          onChange={(ev) => onTrocar({ marcada: ev.target.checked })}
          aria-label={`Lançar ${nome}`}
        />
        <div className="col-data">
          <div className="dia">{dia}</div>
          <div className="mes">{mes}</div>
        </div>
        <Avatar quem={(e.quemPagou || null) as never} tamanho={22} className="quem-pagou" />
        <div className="item-info">
          <div className="desc">
            {l.parcela && (
              <span className="parc">
                {l.parcela.n}/{l.parcela.de}
              </span>
            )}
            {nome}
          </div>
          <div className="meta">
            {l.estornada && <span className="selo-mud reclass">estornada</span>}
            {e.forcadaNova && <span className="selo-mud reclass">era &ldquo;já no app&rdquo;</span>}
            {e.mexidaDepois && <span className="selo-mud">mudou no app</span>}
            {editada && !e.forcadaNova && !e.mexidaDepois && (
              <span className="selo-mud">editada</span>
            )}
            {l.estornada
              ? 'cancelada nesta fatura'
              : casou
              ? s.tipo === 'jaLancado'
                ? `já no app · ${s.serieDescricao} ${s.seq}/${s.total}`
                : 'pode já estar no app'
              : naSerie
                ? `já entra na série da parcela 1/${naSerie.total} desta fatura`
                : serie
                  ? `vira ${serie} parcelas de ${brl(l.valor)}`
                  : [e.grupo.replace(/^\d+\s/, ''), e.divisao].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="item-valor">
          <div className="v">{brl(l.valor)}</div>
          {dif !== null && Math.abs(dif) >= 0.005 && (
            <div className="partes">
              <span className="efeito neg">{comSinal(dif)} vs. app</span>
            </div>
          )}
        </div>
      </div>

      {e.aberta && (
        <div className="corpo-fat">
          {/* O lado da FATURA em tom de observação, e os campos preenchidos com
              o que o app já tem: a tela mostra de onde veio cada número. */}
          <div className="da-fatura">
            na fatura · {dataBR(l.data)} · {l.descricao}
            {l.nomeCartao ? ` · ${l.nomeCartao}` : ''}
            {l.cartao ? ` · ${l.cartao}` : ''}
          </div>

          {casou && app ? (
            <Conciliacao
              linha={l}
              app={app}
              valorApp={e.valorApp}
              suspeita={s.tipo === 'suspeita'}
              eu={eu}
              onConciliou={(v) => onTrocar({ valorApp: v })}
              // Vira gasto novo, mas fica ONDE ESTÁ até ser fechada: quem
              // acabou de dizer "não é o mesmo gasto" ainda vai escrever o
              // nome e escolher a categoria, e a linha não pode sumir no meio.
              onNova={() =>
                onTrocar({ forcadaNova: true, marcada: true, aberta: true, abaTravada: 'app' })
              }
            />
          ) : (
            <>
              {e.abaTravada && (
                <div className="aviso" style={{ marginTop: 0 }}>
                  <span>⚠</span>
                  <div>
                    Vai ser lançada como <b>gasto novo</b>. Ajuste o nome e a categoria; ao fechar,
                    a linha passa para a aba <b>Novos</b>.
                  </div>
                </div>
              )}
              {serie && (
                <div className="aviso" style={{ marginTop: 0 }}>
                  <span>⚠</span>
                  <div>
                    Vira uma série de <b>{serie} parcelas</b> de {brl(l.valor)}, uma por mês a
                    partir de {dataBR(l.data)}. As futuras já entram lançadas.
                  </div>
                </div>
              )}
              {naSerie && (
                <div className="aviso" style={{ marginTop: 0 }}>
                  <span>⚠</span>
                  <div>
                    Esta fatura traz as <b>{naSerie.total} parcelas de uma vez</b>. A parcela{' '}
                    <b>1/{naSerie.total}</b> já cria a série inteira, então esta{' '}
                    <b>
                      {naSerie.seq}/{naSerie.total}
                    </b>{' '}
                    fica de fora — marcá-la lançaria o mesmo gasto duas vezes. Marque só se souber
                    que é outra compra.
                  </div>
                </div>
              )}

              {/* Daqui para baixo é o MESMO formulário do Lançar, reduzido: os
                  mesmos chips, as mesmas cores, as mesmas duas perguntas na
                  mesma ordem. Era uma pilha de `select` cinzas, e a diferença
                  não era estética — quem revisa uma fatura de 167 linhas estava
                  lendo texto onde o resto do app dá cor.

                  `campos-lanc` é o que traz o estilo de lá sem copiá-lo; ver o
                  bloco "Lançar e a revisão de fatura" no globals.css. */}
              <div className="campos-lanc">
                {/* O nome da fatura fica de fundo, apagado: digitar o substitui,
                    e apagar o campo o traz de volta. Sem um campo aqui, um
                    `Ifd*dpc Culinaria Japonesbelo` entraria na lista assim para
                    sempre. */}
                <div className="linha-desc">
                  <label className="campo">
                    <span>Nome</span>
                    <input
                      type="text"
                      value={e.descricao}
                      placeholder={l.descricao}
                      onChange={(ev) => onTrocar({ descricao: ev.target.value })}
                    />
                  </label>
                  {/* O botão do André, o mesmo do Lançar, no mesmo lugar: colado
                      no nome. Ele diz de quem é o custo e NÃO mexe na divisão
                      nem no acerto.

                      Fica TRAVADO, e não escondido, quando o dono já é outro
                      (`De fora`) ou quando a linha foi dividida: os dois gravam
                      a mesma coluna, e sumir faria o botão piscar para dentro e
                      para fora da tela a cada toque na divisão. */}
                  <button
                    type="button"
                    className="btn-andre"
                    aria-pressed={e.gastoDe === 'André'}
                    aria-label="Gasto do André"
                    disabled={e.deFora || dividida}
                    title={
                      e.deFora
                        ? 'O dono deste gasto já é outro'
                        : dividida
                          ? 'A linha foi dividida: o dono vale por pedaco'
                          : 'Gasto do André'
                    }
                    onClick={() =>
                      onTrocar({ gastoDe: e.gastoDe === 'André' ? '' : 'André' })
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/avatar-andre.jpg" alt="André" />
                  </button>
                </div>
                {e.descricao.trim() && (
                  <div className="dica">
                    na fatura: {l.descricao} ·{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => onTrocar({ descricao: '' })}
                    >
                      voltar ao original
                    </button>
                  </div>
                )}
                {e.gastoDe === 'André' && (
                  <Nota
                    detalhe={
                      <>
                        Classifica de quem é o custo —{' '}
                        <b>não muda a divisão nem o acerto</b>.
                      </>
                    }
                  >
                    Marcado como gasto do <b>André</b>.
                  </Nota>
                )}

                <div className="linha">
                  <label className="campo">
                    <span>{serie ? 'Valor da parcela' : 'Valor'}</span>
                    {/* `type="text"` não é decorativo: o CSS global estiliza
                        `input[type='text']`, e um input SEM atributo type não
                        casa com esse seletor. Sem ele o campo nasce com a
                        altura e a largura cruas do navegador e vaza por cima
                        do vizinho — foi o que aconteceu. */}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={numero(valorLinha)}
                      onChange={(ev) =>
                        onTrocar({ valorLiquido: lerMoeda(mascaraMoeda(ev.target.value)) })
                      }
                    />
                  </label>
                  {/* A data é TRAVADA: a do cartão é a que manda. Editá-la aqui
                      inventava uma data de compra que a fatura já afirma — e a
                      data é o que liga a parcela 2 à série que o app conhece.
                      `dataEditada` continua existindo porque um lote reaberto
                      pode ter uma, de antes desta regra. */}
                  <div className="campo">
                    <span>Data</span>
                    <div className="travado">
                      <span className="valor">{dataBR(e.dataEditada || l.data)}</span>
                      <Cadeado />
                    </div>
                  </div>
                </div>
                {e.valorLiquido !== null && (
                  <div className="dica">
                    na fatura: {brl(l.valor)} ·{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => onTrocar({ valorLiquido: null })}
                    >
                      voltar ao original
                    </button>
                  </div>
                )}

                {/* `select` e não chips, aqui: são 8 categorias e a tela da
                    fatura é percorrida linha a linha, dezenas de vezes. No
                    Lançar, que é uma vez por gasto, os chips coloridos pagam a
                    altura que ocupam; aqui não pagavam.

                    A bolinha da cor fica, à esquerda do `select`: é ela que
                    liga a linha ao gráfico do mês.

                    Tipo é campo do lançamento, não da categoria (A5), e aqui
                    simplesmente não existia: toda linha herdava o padrão da
                    categoria sem como discordar. Diferença de propósito em
                    relação ao Lançar: lá a categoria nunca mexe no tipo, porque
                    a pessoa a escolheu; aqui ela foi ADIVINHADA por palavra-
                    chave, então corrigir o palpite corrige o que saiu dele —
                    até alguém tocar no tipo, e aí ele para de seguir. */}
                {/* `fieldset disabled` e não `pointer-events: none`: ele tira os
                    campos da navegação por teclado e do leitor de tela também,
                    que é o que "não vale mais" quer dizer de verdade. */}
                <fieldset className="trecho" disabled={dividida}>
                    {dividida && (
                      <div className="aviso" style={{ marginTop: 12 }}>
                        <span>⚠</span>
                        <div>
                          A linha foi <b>dividida</b>. Daqui para baixo, cada pedaco responde por
                          si — o que está aqui ficou como <b>o ponto de partida</b> deles.
                        </div>
                      </div>
                    )}
                  <div className="grade" style={{ marginTop: 12 }}>
                    <label className="campo com-cor">
                      <span>Categoria</span>
                      <i className="pt-cor" style={{ background: corDaCategoria(e.grupo) }} />
                      <select value={e.grupo} onChange={(ev) => trocarGrupo(ev.target.value)}>
                        {opcoes.gruposLancar.map((g) => (
                          <option key={g.nome} value={g.nome}>
                            {g.nome}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="campo">
                      <span>Tipo</span>
                      <select
                        value={e.tipo}
                        onChange={(ev) => onTrocar({ tipo: ev.target.value, tipoManual: true })}
                      >
                        {['Variável', 'Fixa'].map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {/* Origem NÃO é campo aqui: a fatura é de cartão, e perguntar de
                      onde saiu o dinheiro numa fatura de cartão é pergunta sem
                      resposta possível. O valor continua viajando no payload, e
                      isso importa: se alguém trocou a origem à mão depois da
                      importação, a correção em lote preserva em vez de carimbar
                      `Cartão` por cima (A17). Só aparece quando foge do esperado. */}
                  {e.origem !== 'Cartão' && (
                    <p className="nota">
                      Esta linha está gravada como <b>{e.origem}</b>, e não Cartão. Fica como está.
                    </p>
                  )}

                  {/* Quem pagou fica TRAVADO quando a fatura resolveu o nome do
                      cartão: o dono do cartão é quem pagou. No adicional da
                      Maria quem paga é ela, e ela transfere depois — decisão do
                      Irwin em 19/11, para ela enxergar o cartão dela como gasto
                      dela. Trocar aqui só criaria divergência com a fatura.

                      Quando o nome NÃO bateu com ninguém do elenco, os botões
                      voltam. Sem pagador a gravação é recusada (A4), e um campo
                      travado em branco deixaria a fatura impossível de fechar. */}
                  <div className="rot sep">
                    1 · Quem pagou <span className="leve">de quem saiu o dinheiro</span>
                  </div>
                  {e.quemPagou ? (
                    <>
                      <div className="travado">
                        <i
                          className={
                            'pt ' +
                            (e.quemPagou === 'Irwin' ? 'i' : e.quemPagou === 'Maria' ? 'm' : 'duo')
                          }
                        />
                        <span className="valor">
                          {e.quemPagou === 'Ambos' ? 'Os dois' : e.quemPagou}
                        </span>
                        <Cadeado />
                      </div>
                      {l.nomeCartao && (
                        <Nota detalhe="A data e o pagador vêm da fatura e não mudam.">
                          Do nome no cartão: <b>{l.nomeCartao}</b>.
                        </Nota>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="chips">
                        {opcoes.pagadores.map((q) => (
                          <button
                            key={q}
                            type="button"
                            className="chip"
                            aria-pressed={e.quemPagou === q}
                            onClick={() => onTrocar({ quemPagou: q })}
                          >
                            <i
                              className={'pt ' + (q === 'Irwin' ? 'i' : q === 'Maria' ? 'm' : 'duo')}
                            />
                            {q === 'Ambos' ? 'Os dois' : q}
                          </button>
                        ))}
                      </div>
                      <p className="nota">
                        O nome no cartão (<b>{l.nomeCartao || 'em branco'}</b>) não bateu com
                        ninguém. <b>Escolha quem pagou</b> — sem isso a linha não é gravada.
                      </p>
                    </>
                  )}

                  {/* Lista suspensa, e não chips: são seis opções, e a fatura é
                      percorrida linha a linha dezenas de vezes. `Custom` —
                      Valor exato — entra agora. Ela ficava de fora com a
                      desculpa de que "quem quer valor exato divide a linha",
                      mas dividir é outra coisa: pedaco é a mesma compra com
                      dois DONOS, não a mesma compra em proporção diferente. */}
                  <div className="rot sep">
                    2 · De quem é o gasto <span className="leve">como dividir o custo</span>
                  </div>
                  <select
                    value={e.deFora ? 'De fora' : e.divisao}
                    onChange={(ev) => {
                      const d = ev.target.value;
                      setDigitando(null);
                      onTrocar({
                        deFora: d === 'De fora',
                        divisao: d,
                        pctCustom: d === 'Custom' ? (e.pctCustom ?? 50) : null,
                        /* Só limpa o dono ao SAIR de `De fora`. Limpar sempre
                           apagava a marca do André — que não é divisão, é
                           de quem é o custo — em quem trocasse 50/50 por
                           100% Irwin depois de marcar o botão dele. */
                        gastoDe:
                          d === 'De fora' ? e.gastoDe || DE_FORA[0] : e.deFora ? '' : e.gastoDe,
                      });
                    }}
                  >
                    {DIVISOES.map((d) => (
                      <option key={d} value={d}>
                        {ROTULO_DIVISAO[d]}
                      </option>
                    ))}
                  </select>

                  {e.deFora && (
                    <>
                      <label className="campo" style={{ marginTop: 12 }}>
                        <span>De quem é esse gasto</span>
                        <select
                          value={DE_FORA.includes(e.gastoDe) ? e.gastoDe : OUTRA}
                          onChange={(ev) =>
                            onTrocar({ gastoDe: ev.target.value === OUTRA ? '' : ev.target.value })
                          }
                        >
                          {DE_FORA.map((q) => (
                            <option key={q}>{q}</option>
                          ))}
                          <option value={OUTRA}>{OUTRA}</option>
                        </select>
                      </label>
                      {/* O nome é o que agrupa a dívida em `v_terceiros`. Sem ele o
                          saldo não tem dono e não serve para cobrar ninguém. */}
                      {!DE_FORA.includes(e.gastoDe) && (
                        <label className="campo">
                          <span>Nome da pessoa</span>
                          <input
                            type="text"
                            value={e.gastoDe}
                            placeholder="de quem é esse gasto"
                            onChange={(ev) => onTrocar({ gastoDe: ev.target.value })}
                          />
                        </label>
                      )}
                    </>
                  )}

                  {/* O que cada um vai carregar. Em Valor exato os dois são
                      CAMPO: é a divisão em que o número vem do dedo, não do
                      rótulo. Nas outras é leitura — digitar ali contradiria a
                      divisão escolhida logo acima. */}
                  <div className="partes compactas">
                    <div className="parte i">
                      <div className="quem">Parte do Irwin</div>
                      {custom ? (
                        <div className="moeda">
                          <span className="cifra">R$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label="Parte do Irwin"
                            value={
                              digitando?.lado === 'irwin' ? digitando.texto : numero(partes.irwin)
                            }
                            onChange={(ev) => digitouParte('irwin', ev.target.value)}
                            onBlur={() => setDigitando(null)}
                          />
                        </div>
                      ) : (
                        <div className="leitura">{brl(partes.irwin)}</div>
                      )}
                    </div>
                    <div className="parte m">
                      <div className="quem">Parte da Maria</div>
                      {custom ? (
                        <div className="moeda">
                          <span className="cifra">R$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label="Parte da Maria"
                            value={
                              digitando?.lado === 'maria' ? digitando.texto : numero(partes.maria)
                            }
                            onChange={(ev) => digitouParte('maria', ev.target.value)}
                            onBlur={() => setDigitando(null)}
                          />
                        </div>
                      ) : (
                        <div className="leitura">{brl(partes.maria)}</div>
                      )}
                    </div>
                  </div>
                  {e.deFora && (
                    <p className="nota">
                      Sai do resultado de vocês e entra como dívida{' '}
                      {e.gastoDe ? <>de <b>{e.gastoDe}</b></> : 'de quem você nomear'} em Quem nos
                      deve.
                    </p>
                  )}
                </fieldset>
              </div>

              <Divisor
                linha={l}
                estado={e}
                opcoes={opcoes}
                onTrocar={onTrocar}
              />

              {e.abaTravada && (
                <button
                  type="button"
                  className="btn-linha forte"
                  onClick={() => onTrocar({ aberta: false, abaTravada: null })}
                >
                  Pronto — mover para Novos
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conciliação — adotar o valor da fatura num lançamento que já existe
// ---------------------------------------------------------------------------

function Conciliacao({
  linha: l,
  app,
  valorApp,
  suspeita,
  eu,
  onConciliou,
  onNova,
}: {
  linha: Linha;
  app: LadoApp;
  valorApp: number | null;
  suspeita: boolean;
  eu: Pessoa | null;
  onConciliou: (v: number) => void;
  onNova: () => void;
}) {
  const [prev, setPrev] = useState<Preview | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const dif = valorApp === null ? 0 : arred(l.valor - valorApp);

  async function pedirPreview() {
    setErro('');
    setOcupado(true);
    try {
      setPrev(await rpc('previewConciliacao', app.id, l.valor));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui calcular.');
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    setErro('');
    setOcupado(true);
    try {
      await rpc('conciliarValor', app.id, l.valor);
      onConciliou(l.valor);
      setPrev(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gravar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {suspeita && (
        <div className="aviso" style={{ marginTop: 0 }}>
          <span>⚠</span>
          <div>
            <b>É palpite.</b> Casou só por valor e data próxima — a descrição não bate. Confira
            antes de tratar como o mesmo gasto.
          </div>
        </div>
      )}

      <div className="no-app">
        <div className="rot">no app</div>
        <div className="ln">
          <span className="q">Descrição</span>
          <b>{app.descricao}</b>
        </div>
        <div className="ln">
          <span className="q">Data</span>
          <b>{dataBR(app.data)}</b>
        </div>
        <div className="ln">
          <span className="q">Categoria</span>
          <b>{app.categoria}</b>
        </div>
        <div className="ln">
          <span className="q">Divisão</span>
          <b>
            {app.divisao} · {app.quemPagou ?? 'sem pagador'}
          </b>
        </div>
        <div className="ln">
          <span className="q">Valor</span>
          <b>{brl(valorApp ?? app.valor)}</b>
        </div>
      </div>

      {erro && (
        <div className="msg-erro" style={{ marginTop: 9 }}>
          {erro}
        </div>
      )}

      {Math.abs(dif) >= 0.005 ? (
        <>
          <div className="dica" style={{ marginTop: 9 }}>
            A fatura diz <b>{brl(l.valor)}</b>, o app tem <b>{brl(valorApp ?? 0)}</b> —{' '}
            {comSinal(dif)}. Costuma ser arredondamento na hora de lançar à mão.
          </div>

          {!prev ? (
            <button type="button" className="btn-linha" disabled={ocupado} onClick={pedirPreview}>
              {ocupado ? 'Calculando…' : 'Adotar o valor da fatura'}
            </button>
          ) : (
            <div className="prev">
              <h4>o que muda</h4>
              <div className="fim">
                <span>Valor</span>
                <span className="num">
                  <s>{brl(prev.antes.valor)}</s> {brl(prev.depois.valor)}
                </span>
              </div>
              <div className="fim">
                <span>No acerto deste mês</span>
                <span
                  className={`num ${prev.deltaAcerto > 0 ? 'pos' : prev.deltaAcerto < 0 ? 'neg' : ''}`}
                >
                  {Math.abs(prev.deltaAcerto) < 0.005
                    ? 'sem impacto'
                    : comSinal(eu === 'Maria' ? -prev.deltaAcerto : prev.deltaAcerto)}
                </span>
              </div>
              <button
                type="button"
                className="btn-linha forte"
                disabled={ocupado}
                onClick={confirmar}
              >
                {ocupado ? 'Gravando…' : 'Confirmar'}
              </button>
              <button type="button" className="btn-linha" onClick={() => setPrev(null)}>
                Cancelar
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="dica" style={{ marginTop: 9 }}>
          Mesmo valor nos dois lados. Nada a conciliar.
        </div>
      )}

      <button type="button" className="btn-linha" onClick={onNova}>
        Não é o mesmo gasto — lançar como novo
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * O valor que esta linha vai gravar.
 *
 * A ordem é uma decisão, não acaso:
 * 1. `valorLiquido` — decidido NESTA revisão, na aba de estornos;
 * 2. `valorAtual` — o que o lançamento tem hoje no banco, ao reabrir um lote,
 *    para não desfazer correção que alguém fez à mão depois;
 * 3. o valor da fatura.
 *
 * Existe como função, e não repetida em cada lugar, porque a soma do rodapé e
 * o payload da gravação TÊM que concordar. Enquanto eram dois cálculos, não
 * concordavam.
 */
function valorEfetivo(l: Linha, e: Estado | undefined): number {
  return e?.valorLiquido ?? e?.valorAtual ?? l.valor;
}

/**
 * Quebrar uma linha da fatura em pedaços.
 *
 * O caso que mandou fazer: a conta da Vivo, R$ 359,90, em que parte é da mãe
 * do Irwin e volta como reembolso. Sem isto, as duas saídas erram — lançar
 * tudo como gasto do casal, ou não lançar, que foi o que aconteceu e tirou a
 * despesa da conta por meses.
 *
 * O `resta` é a trava e não é preciosismo: pedaços que não somam o valor da
 * linha criam ou destroem dinheiro, e isso não aparece olhando uma linha só.
 * Enquanto não fechar, a tela diz quanto falta e não deixa concluir.
 */
function Divisor({
  linha: l,
  estado: e,
  opcoes,
  onTrocar,
}: {
  linha: Linha;
  estado: Estado;
  opcoes: Opcoes;
  onTrocar: (m: Partial<Estado>) => void;
}) {
  const total = baseDaDivisao(l, e);
  const pedacos = e.pedacos;
  const resta = restaDividir(l, e);

  if (!pedacos) {
    return (
      <button
        type="button"
        className="btn-linha"
        onClick={() =>
          onTrocar({
            /* Nasce com DOIS pedaços, não um: quem toca em "dividir" já quer
               dois, e abrir com um só obrigaria a um segundo toque para
               chegar ao estado que era a intenção. O primeiro leva o valor
               inteiro e o segundo nasce zerado, então o `resta` já aponta
               exatamente o que falta decidir. */
            pedacos: [
              {
                valor: total,
                descricao: e.descricao.trim() || l.descricao,
                grupo: e.grupo,
                divisao: e.divisao,
                quemPagou: e.quemPagou,
                deFora: false,
                gastoDe: '',
              },
              {
                valor: 0,
                descricao: '',
                grupo: e.grupo,
                divisao: e.divisao,
                quemPagou: e.quemPagou,
                deFora: false,
                gastoDe: '',
              },
            ],
          })
        }
      >
        Dividir esta linha
      </button>
    );
  }

  const mexer = (k: number, m: Partial<Pedaco>) =>
    onTrocar({ pedacos: pedacos.map((p, i) => (i === k ? { ...p, ...m } : p)) });

  return (
    <div className="divisor">
      <div className="divisor-cab">
        <span>Pedaços desta linha</span>
        <span className="tot">{brl(total)}</span>
      </div>

      {pedacos.map((p, k) => (
        <div className="pedaco" key={k}>
          <div className="grade">
            <div className="campo">
              <label>Valor</label>
              <input
                type="text"
                inputMode="decimal"
                value={numero(p.valor)}
                onChange={(ev) => mexer(k, { valor: lerMoeda(mascaraMoeda(ev.target.value)) })}
              />
            </div>
            <div className="campo">
              <label>Nome</label>
              <input
                type="text"
                value={p.descricao}
                placeholder={e.descricao.trim() || l.descricao}
                onChange={(ev) => mexer(k, { descricao: ev.target.value })}
              />
            </div>
          </div>

          <div className="grade">
            <div className="campo">
              <label>Categoria</label>
              <select value={p.grupo} onChange={(ev) => mexer(k, { grupo: ev.target.value })}>
                {opcoes.gruposLancar.map((g) => (
                  <option key={g.nome} value={g.nome}>
                    {g.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label>Divisão</label>
              <select
                value={p.deFora ? 'De fora' : p.divisao}
                onChange={(ev) => {
                  const v = ev.target.value;
                  mexer(k, {
                    deFora: v === 'De fora',
                    divisao: v,
                    gastoDe: v === 'De fora' ? p.gastoDe || DE_FORA[0] : '',
                  });
                }}
              >
                <option value="">—</option>
                {DIVISOES.filter((d) => d !== 'Custom').map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {p.deFora && (
            <>
              <div className="campo">
                <label>De quem é esse gasto</label>
                <select
                  value={DE_FORA.includes(p.gastoDe) ? p.gastoDe : OUTRA}
                  onChange={(ev) =>
                    mexer(k, { gastoDe: ev.target.value === OUTRA ? '' : ev.target.value })
                  }
                >
                  {DE_FORA.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                  <option value={OUTRA}>{OUTRA}</option>
                </select>
              </div>
              {/* O nome é o que agrupa a dívida em `v_terceiros`. Sem ele o
                  saldo não tem dono e não serve para cobrar ninguém. */}
              {!DE_FORA.includes(p.gastoDe) && (
                <div className="campo">
                  <label>Nome de quem é</label>
                  <input
                    type="text"
                    value={p.gastoDe}
                    placeholder="Quem vai devolver"
                    onChange={(ev) => mexer(k, { gastoDe: ev.target.value })}
                  />
                </div>
              )}
            </>
          )}

          {pedacos.length > 2 && (
            <button
              type="button"
              className="link tirar"
              onClick={() => onTrocar({ pedacos: pedacos.filter((_, i) => i !== k) })}
            >
              tirar este pedaço
            </button>
          )}
        </div>
      ))}

      <div className="divisor-pe">
        <span className={'resta' + (Math.abs(resta) < 0.005 ? ' ok' : '')}>
          {Math.abs(resta) < 0.005
            ? 'fecha com a linha ✓'
            : resta > 0
              ? `falta distribuir ${brl(resta)}`
              : `passou ${brl(-resta)} do valor da linha`}
        </span>
        <span className="botoes">
          {Math.abs(resta) >= 0.005 && pedacos.length > 0 && (
            <button
              type="button"
              className="link"
              onClick={() =>
                mexer(pedacos.length - 1, {
                  valor: arred(pedacos[pedacos.length - 1].valor + resta),
                })
              }
            >
              jogar no último
            </button>
          )}
          <button
            type="button"
            className="link"
            onClick={() =>
              onTrocar({
                pedacos: [
                  ...pedacos,
                  {
                    valor: 0,
                    descricao: '',
                    grupo: e.grupo,
                    divisao: e.divisao,
                    quemPagou: e.quemPagou,
                    deFora: false,
                    gastoDe: '',
                  },
                ],
              })
            }
          >
            + pedaço
          </button>
          <button type="button" className="link" onClick={() => onTrocar({ pedacos: null })}>
            não dividir
          </button>
        </span>
      </div>
    </div>
  );
}

/** O que a linha soma: o valor efetivo, ou a soma dos pedaços. */
function somaDaLinha(l: Linha, e: Estado | undefined): number {
  if (e?.pedacos?.length) return arred(e.pedacos.reduce((a, p) => a + p.valor, 0));
  return valorEfetivo(l, e);
}

/**
 * O valor que os pedaços TÊM que somar.
 *
 * Não é `valorEfetivo`. Aquele cai em `valorAtual`, que quer dizer "o que o
 * lançamento tem hoje no banco" — e numa linha dividida não existe UM
 * lançamento, existem N. Ao reabrir, `valorAtual` vinha com o valor do
 * primeiro pedaço (R$ 200 dos R$ 359,90 da Vivo) e a conta nunca fechava: a
 * tela acusava "não fecha" numa divisão que estava perfeita.
 *
 * A base é o valor da LINHA DA FATURA — ou o líquido, quando um estorno
 * parcial já reduziu o que aquela linha vale.
 */
function baseDaDivisao(l: Linha, e: Estado | undefined): number {
  return e?.valorLiquido ?? l.valor;
}

/** Quanto ainda falta distribuir para os pedaços fecharem com a linha. */
function restaDividir(l: Linha, e: Estado | undefined): number {
  if (!e?.pedacos?.length) return 0;
  return arred(baseDaDivisao(l, e) - e.pedacos.reduce((a, p) => a + p.valor, 0));
}

function abaDe(l: Linha, e: Estado | undefined): Aba {
  // A trava vem primeiro: uma linha sendo editada não muda de aba embaixo do
  // dedo de quem a está editando.
  if (e?.abaTravada) return e.abaTravada;
  if (e?.forcadaNova) return 'novos';
  const s = l.situacao;
  if (s.tipo === 'jaLancado' || s.tipo === 'suspeita') return 'app';
  if (s.tipo === 'novaSerie' || s.tipo === 'naSerieNova') return 'parc';
  return 'novos';
}

/**
 * Esta linha é do cartão de quem está marcando?
 *
 * Sem dono escolhido, todas. E a linha cujo nome no cartão NÃO bateu com
 * ninguém do elenco conta como sim, de propósito: ela é justamente a que
 * precisa de atenção, e nascer desmarcada seria o jeito de esquecê-la.
 */
function doDono(quemPagou: string, dono: string): boolean {
  return !dono || !quemPagou || quemPagou === dono;
}

function divisaoInicial(padrao: string, quemPagou: string): string {
  if (padrao !== PADRAO_PAGADOR) return padrao;
  // Sem nome reconhecido no cartão não se inventa pagador nem divisão: pela A4
  // a linha fica travada até alguém escolher.
  return quemPagou === 'Irwin' || quemPagou === 'Maria' ? `100% ${quemPagou}` : '';
}

/** Se alguém mexeu na linha, para o selo `editada` na lista. */
function foiEditada(l: Linha, e: Estado, padrao: string): boolean {
  const quem = l.quemPagou ?? '';
  return (
    !!e.descricao.trim() ||
    e.grupo !== l.categoriaSugerida ||
    e.quemPagou !== quem ||
    e.deFora ||
    !!e.gastoDe ||
    !!e.dataEditada ||
    e.valorLiquido !== null ||
    e.origem !== 'Cartão' ||
    e.divisao !== divisaoInicial(padrao, quem)
  );
}

/** Quantas parcelas a linha vira. `null` = uma linha só. */
function parcelasDe(l: Linha, e: Estado | undefined): number | null {
  if (!e || e.forcadaNova) return null;
  return l.situacao.tipo === 'novaSerie' ? l.situacao.parcelas : null;
}

/** O que o lote guarda: sem o que é estado de tela. */
function aoSalvar(est: Record<number, Estado>): Record<number, Estado> {
  const fora: Record<number, Estado> = {};
  for (const [k, e] of Object.entries(est)) {
    fora[Number(k)] = { ...e, aberta: false, abaTravada: null };
  }
  return fora;
}

/**
 * O ponto de partida da correção em lote: as decisões do dia, corrigidas pelo
 * que o banco diz HOJE.
 *
 * A precedência é o banco, não o arquivo. Se alguém renomeou `Ifd*dpc Culinaria`
 * para `Jantar no japonês` na tela normal, é `Jantar no japonês` que tem que
 * aparecer aqui — mostrar o nome da fatura convidaria a pessoa a "corrigir" de
 * volta um trabalho que já estava feito.
 *
 * Uma linha que o `estado` diz marcada mas que não está no banco foi apagada à
 * mão: volta desmarcada, que é a verdade.
 */
function aoReabrir(salvo: EstadoSalvo, atual: AtualDoLote): Record<number, Estado> {
  const daFatura = new Map(salvo.analise.linhas.map((l) => [l.i, l]));
  const dentro: Record<number, Estado> = {};

  for (const [k, e] of Object.entries(salvo.est)) {
    const ref = Number(k);
    const a = atual[ref];
    // `valorLiquido ?? null` normaliza o JSON de um lote gravado ANTES deste
    // campo existir — é a mesma guarda que `analise.estornos ?? []` precisou,
    // e pelo mesmo motivo: quem reabre um lote antigo é justamente quem quer
    // corrigi-lo.
    const limpo = {
      ...e,
      descricao: e.descricao ?? '',
      aberta: false,
      abaTravada: null,
      valorLiquido: e.valorLiquido ?? null,
      pedacos: e.pedacos ?? null,
      deFora: e.deFora ?? false,
      gastoDe: e.gastoDe ?? '',
      /* Lote gravado antes destes campos existirem: o tipo vem do banco, que
         é quem sabe o que foi realmente gravado; origem e data voltam ao
         padrão e são corrigidas logo abaixo pelo que o banco diz. */
      tipo: e.tipo ?? a?.tipo ?? 'Variável',
      tipoManual: e.tipoManual ?? false,
      origem: e.origem ?? 'Cartão',
      dataEditada: e.dataEditada ?? null,
      pctCustom: e.pctCustom ?? null,
    };

    if (!a) {
      dentro[ref] = { ...limpo, marcada: false };
      continue;
    }

    // Nome vazio continua querendo dizer "o da fatura serve" — o campo mostra o
    // original apagado atrás, e só o que difere dele é texto escolhido.
    const nomeFatura = daFatura.get(ref)?.descricao ?? '';
    dentro[ref] = {
      ...limpo,
      marcada: true,
      descricao: a.descricao === nomeFatura ? '' : a.descricao,
      grupo: a.categoria,
      divisao: a.divisao,
      /* Vem do BANCO como o resto desta reconstrução: reabrir com 50 no lugar
         da porcentagem gravada faria a correção em lote reescrever metade
         para cada um sem ninguém pedir. */
      pctCustom: a.pctCustom ?? null,
      quemPagou: a.quemPagou ?? '',
      deFora: a.deFora ?? false,
      gastoDe: a.gastoDe ?? '',
      tipo: a.tipo,
      /* O tipo veio do banco, então ele JÁ é uma escolha — não pode ser
         arrastado por uma troca de categoria aqui. */
      tipoManual: true,
      origem: a.origem ?? 'Cartão',
      dataEditada: a.data === (daFatura.get(ref)?.data ?? '') ? null : a.data,
      valorAtual: a.valor,
      mexidaDepois:
        (a.descricao === nomeFatura ? '' : a.descricao) !== (e.descricao ?? '') ||
        a.categoria !== e.grupo ||
        a.divisao !== e.divisao ||
        (a.pctCustom ?? null) !== (e.pctCustom ?? null) ||
        a.tipo !== e.tipo ||
        (a.origem ?? 'Cartão') !== (e.origem ?? 'Cartão') ||
        (a.quemPagou ?? '') !== e.quemPagou ||
        (a.deFora ?? false) !== (e.deFora ?? false) ||
        (a.gastoDe ?? '') !== (e.gastoDe ?? ''),
    };
  }
  return dentro;
}

/**
 * O que conta como "mudou" numa linha.
 *
 * Abrir e fechar não é mudança, e sem tirar isso da comparação o botão
 * acenderia só de alguém ter olhado.
 */
function assinaturaLinha(e: Estado | undefined): string {
  if (!e) return '';
  return [
    e.marcada, e.descricao ?? '', e.grupo, e.divisao, e.quemPagou,
    // A porcentagem do Valor exato: trocar 70/30 por 60/40 não muda a divisão
    // nem nada mais, e sem isto o diferencial não veria mexida em dinheiro.
    e.pctCustom ?? '',
    e.forcadaNova, e.valorAtual ?? '',
    // O mesmo motivo dos pedacos abaixo: marcar a linha inteira como `De fora`
    // não muda nome, categoria nem divisão, e sem isto o diferencial a
    // deixaria de fora — a correção sumiria em silêncio.
    e.deFora, e.gastoDe,
    // Tipo, origem e data também: trocar Variável por Fixa não mexe em nome
    // nem em categoria, e sem isto o diferencial não veria a mudança.
    e.tipo, e.origem, e.dataEditada ?? '',
    // Sem isto, decidir "lançar o líquido" não contaria como mudança e o
    // diferencial deixaria a linha de fora — a correção sumiria em silêncio.
    e.valorLiquido ?? '',
    // Os pedaços entram na assinatura inteiros: mudar o valor de um sem que a
    // linha mude de nome ou categoria continua sendo uma mudança, e sem isto o
    // diferencial não a veria.
    e.pedacos ? JSON.stringify(e.pedacos) : '',
  ].join('|');
}

function assinaturaDe(est: Record<number, Estado>): string {
  return Object.entries(est)
    .map(([k, e]) => k + '|' + assinaturaLinha(e))
    .sort()
    .join('\n');
}

/** "3 linhas corrigidas · 1 removida" — o que o botão vai fazer, em português. */
function resumoDoDiferencial(d: { linhas: unknown[]; apagar: unknown[] }): string {
  const partes: string[] = [];
  if (d.linhas.length) {
    partes.push(`${d.linhas.length} ${d.linhas.length === 1 ? 'linha' : 'linhas'} regravada${d.linhas.length === 1 ? '' : 's'}`);
  }
  if (d.apagar.length) {
    partes.push(`${d.apagar.length} removida${d.apagar.length === 1 ? '' : 's'}`);
  }
  return partes.join(' · ') + ' · o resto fica como está';
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** `fatura-paga-final 8607-agosto2026.xlsx` → um título legível para o lote. */
function tituloDa(a: Analise): string {
  const datas = a.linhas.map((l) => l.data).sort();
  const ultima = datas[datas.length - 1] ?? '';
  const mes = ultima ? dataBR(ultima).slice(3) : '';
  return `Fatura do cartão${mes ? ` · ${mes}` : ''}`;
}

/**
 * O arquivo em base64, em pedaços.
 *
 * `String.fromCharCode(...bytes)` com 100 KB estoura a pilha de chamadas do
 * navegador — o argumento vira uma lista de 100 mil itens.
 */
async function paraBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

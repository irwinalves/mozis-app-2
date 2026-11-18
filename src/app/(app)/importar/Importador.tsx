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
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/rpc';
import type { analisarFatura, previewConciliacao, LinhaParaLancar } from '@/lib/api';
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
          marcada:
            !l.estornada && (l.situacao.tipo === 'nova' || l.situacao.tipo === 'novaSerie'),
          descricao: '',
          grupo: l.categoriaSugerida,
          divisao: divisaoInicial(padraoDivisao, quemPagou),
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

  function marcarAba(a: Aba, valor: boolean) {
    setEst((s) => {
      const novo = { ...s };
      for (const l of porAba[a]) novo[l.i] = { ...novo[l.i], marcada: valor };
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

  const lista = porAba[aba];

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
            <div className="card suave" style={{ marginBottom: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 12.5 }}>
                Correção em lote. As linhas abrem <b>como estão no app hoje</b>, e só as que você
                mexer aqui são regravadas — o resto fica exatamente como está.
              </div>
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
              <span>{lista.filter((l) => est[l.i]?.marcada).length} marcadas</span>
              <span className="acoes-lista">
                <button type="button" onClick={() => marcarAba(aba, true)}>
                  todas
                </button>
                <button type="button" onClick={() => marcarAba(aba, false)}>
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
  /* A conta mora em `partesDe`, junto do resto do rateio: com `De fora` as
     DUAS partes são zero, e fazer "total menos a do Irwin" aqui dava
     "Irwin R$ 0,00 · Maria R$ 90,00" num gasto que não é de nenhum dos dois. */
  const partes = partesDe(valorLinha, e.divisao as Divisao, e.deFora, opcoes.pctIrwinRenda);

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
                  {/* O botão do André, o mesmo do Lançar. Ele diz de quem é o
                      custo e NÃO mexe na divisão nem no acerto — por isso fica
                      aqui em cima, longe das duas perguntas. Com a linha
                      marcada `De fora` ele sai de cena: o dono já é outro, e os
                      dois campos gravam a mesma coluna. */}
                  {!e.deFora && (
                    <button
                      type="button"
                      className="btn-andre"
                      aria-pressed={e.gastoDe === 'André'}
                      aria-label="Gasto do André"
                      title="Gasto do André"
                      onClick={() =>
                        onTrocar({ gastoDe: e.gastoDe === 'André' ? '' : 'André' })
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/avatar-andre.jpg" alt="André" />
                    </button>
                  )}
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
                  <p className="nota">
                    Marcado como gasto do <b>André</b>. Classifica de quem é o custo —{' '}
                    <b>não muda a divisão nem o acerto</b>.
                  </p>
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
                  <label className="campo">
                    <span>Data</span>
                    <input
                      type="date"
                      value={e.dataEditada || l.data}
                      onChange={(ev) => onTrocar({ dataEditada: ev.target.value || null })}
                    />
                  </label>
                </div>
                {(e.valorLiquido !== null || e.dataEditada) && (
                  <div className="dica">
                    na fatura: {brl(l.valor)} em {dataBR(l.data)} ·{' '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => onTrocar({ valorLiquido: null, dataEditada: null })}
                    >
                      voltar ao original
                    </button>
                  </div>
                )}

                <div className="rot sep">Categoria</div>
                <div className="chips">
                  {opcoes.gruposLancar.map((g) => (
                    <button
                      key={g.nome}
                      type="button"
                      className="chip cat"
                      style={{ '--c': corDaCategoria(g.nome) } as React.CSSProperties}
                      aria-pressed={e.grupo === g.nome}
                      onClick={() => trocarGrupo(g.nome)}
                    >
                      <i className="pt" />
                      {g.nome}
                    </button>
                  ))}
                </div>

                {/* Tipo é campo do lançamento, não da categoria (A5) — e aqui ele
                    simplesmente não existia: toda linha de fatura herdava o
                    padrão da categoria, sem como discordar.

                    Diferença de propósito em relação ao Lançar: lá a categoria
                    nunca mexe no tipo, porque a pessoa a escolheu. Aqui ela foi
                    ADIVINHADA por palavra-chave, então corrigir o palpite
                    corrige o que saiu dele — até alguém tocar no tipo, e aí ele
                    para de seguir. */}
                <div className="rot sep">Tipo</div>
                <div className="chips">
                  {['Variável', 'Fixa'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="chip"
                      aria-pressed={e.tipo === t}
                      onClick={() => onTrocar({ tipo: t, tipoManual: true })}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="rot sep">Origem</div>
                <div className="chips">
                  {['Cartão', 'Banco'].map((o) => (
                    <button
                      key={o}
                      type="button"
                      className="chip"
                      aria-pressed={e.origem === o}
                      onClick={() => onTrocar({ origem: o })}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                {e.origem !== 'Cartão' && (
                  <p className="nota">
                    Veio na fatura do cartão, mas vai ser gravada como <b>{e.origem}</b>.
                  </p>
                )}

                <div className="rot sep">
                  1 · Quem pagou <span className="leve">de quem saiu o dinheiro</span>
                </div>
                <div className="chips">
                  {opcoes.pagadores.map((q) => (
                    <button
                      key={q}
                      type="button"
                      className="chip"
                      aria-pressed={e.quemPagou === q}
                      onClick={() => onTrocar({ quemPagou: q })}
                    >
                      <i className={'pt ' + (q === 'Irwin' ? 'i' : q === 'Maria' ? 'm' : 'duo')} />
                      {q === 'Ambos' ? 'Os dois' : q}
                    </button>
                  ))}
                </div>
                {l.nomeCartao && (
                  <p className="nota">
                    Já veio preenchido pelo nome no cartão: <b>{l.nomeCartao}</b>.
                  </p>
                )}

                <div className="rot sep">
                  2 · De quem é o gasto <span className="leve">como dividir o custo</span>
                </div>
                <div className="chips">
                  {DIVISOES.filter((d) => d !== 'Custom').map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="chip"
                      aria-pressed={e.deFora ? d === 'De fora' : e.divisao === d}
                      onClick={() =>
                        onTrocar({
                          deFora: d === 'De fora',
                          divisao: d,
                          /* Só limpa o dono ao SAIR de `De fora`. Limpar sempre
                             apagava a marca do André — que não é divisão, é
                             de quem é o custo — em quem trocasse 50/50 por
                             100% Irwin depois de marcar o botão dele. */
                          gastoDe:
                            d === 'De fora'
                              ? e.gastoDe || DE_FORA[0]
                              : e.deFora
                                ? ''
                                : e.gastoDe,
                        })
                      }
                    >
                      {ROTULO_DIVISAO[d]}
                    </button>
                  ))}
                </div>

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

                {/* O que cada um vai carregar, em número. É leitura, não campo:
                    quem quiser um valor exato por pessoa divide a linha em
                    pedacos, que é onde esse caso mora. */}
                <div className="partes">
                  <div className="parte i">
                    <div className="quem">Parte do Irwin</div>
                    <div className="leitura">{brl(partes.irwin)}</div>
                  </div>
                  <div className="parte m">
                    <div className="quem">Parte da Maria</div>
                    <div className="leitura">{brl(partes.maria)}</div>
                  </div>
                </div>
                {e.deFora && (
                  <p className="nota">
                    Sai do resultado de vocês e entra como dívida{' '}
                    {e.gastoDe ? <>de <b>{e.gastoDe}</b></> : 'de quem você nomear'} em Quem nos
                    deve.
                  </p>
                )}
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

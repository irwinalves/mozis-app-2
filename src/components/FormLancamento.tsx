'use client';

/**
 * O formulário de lançamento — UM, para todas as telas que o precisam.
 *
 * POR QUE ELE EXISTE
 *
 * Até aqui havia TRÊS formulários do mesmo objeto: o do `Form.html` (completo,
 * em JS solto), o da edição de série e o da revisão de importação — estes dois
 * reconstruídos em React, cada um com um subconjunto diferente dos campos.
 * Não foi escolha: como o original vive em HTML servido byte a byte, não havia
 * o que reusar. O custo apareceu na primeira pergunta do Irwin — por que a
 * tela de editar série não deixa editar o lançamento inteiro.
 *
 * É a regra nº 3 (uma implementação, nunca duas) em três cópias. Este arquivo
 * fecha isso: a tela de Lançar usa ele agora, e série e importação passam a
 * usar em seguida, com `modo` trocando só o que muda.
 *
 * O QUE MUDOU EM RELAÇÃO AO FORMULÁRIO ANTIGO, e por quê
 *
 * - A barra de porcentagem da divisão `Custom` virou **dois campos de valor**.
 *   Medido: `Custom` é 951 de 3.802 lançamentos — um quarto da base foi
 *   digitado arrastando uma barrinha para acertar um número.
 * - "Quem pagou" e "Como dividir" ficaram **numeradas e explicadas**: são duas
 *   perguntas diferentes, e o acerto é exatamente a subtração entre elas. O
 *   próprio Irwin só percebeu isso vendo o protótipo.
 * - Categoria **não muda mais o tipo sozinha**. Nem tudo de casa é fixo.
 * - `Variável` passa a ser o padrão, por ser o caso comum.
 * - A prévia de parcelas e de ocorrências vem do SERVIDOR, das mesmas funções
 *   que gravam (`montarParcelas` / `montarRecorrencias`). Recalcular as datas
 *   aqui seria a quarta cópia da regra de clamp de fim de mês.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc, ErroRpc } from '@/lib/rpc';
import { brl, lerMoeda, mascaraMoeda, numero } from '@/lib/formato';
import DivisaoEPagador, {
  DE_FORA,
  fracaoDe,
  pagoIrwinDe,
  type Divisao,
  type Reparticao,
} from '@/components/DivisaoEPagador';

export type Opcoes = Awaited<ReturnType<typeof import('@/lib/api').getOpcoes>>;

/** Divisões que a tela oferece. A ordem é a da tela, e `Renda` fecha a lista:
 *  ainda não foi usada nenhuma vez em 3.802 lançamentos, mas é para ser. */
/** A cor é da CATEGORIA, não do estado do botão: é ela que volta nos gráficos
 *  do mês, então mudar aqui desalinha o relatório. */
const COR_CATEGORIA: Record<string, string> = {
  '1 Casa': '#2F5597',
  '2 Carro': '#1F7A6B',
  '3 Comida': '#4E8C2A',
  '4 Saúde': '#B23A3A',
  '5 Lazer & Pessoal': '#B5407A',
  '6 Viagem': '#1B7FA8',
  '7 Outros': '#6E6E6E',
  '8 Investimentos': '#2E6B2E',
  '9 Acerto de Contas': '#8A6D00',
};

type Repeticao = 'nao' | 'parcelado' | 'recorrente';

/** O mesmo leitor do `Form.html`, pelo mesmo motivo: uma implementação só. */
const paraNumero = lerMoeda;

function arred(n: number): number {
  return Math.round(n * 100) / 100;
}

/** O que `obterLancamento` devolve — a forma vem da função real, não de um
 *  tipo escrito à mão que pode discordar dela. */
export type LancamentoEdicao = Awaited<
  ReturnType<typeof import('@/lib/api').obterLancamento>
>;

interface Props {
  opcoes: Opcoes;
  /**
   * Presente = EDITAR este lançamento; ausente = criar um novo.
   *
   * É só isto que separa os dois modos. Era uma tela inteira à parte no
   * `Form.html`, com o seu próprio `abrirEdicao` reconfigurando campo por
   * campo — e foi assim que o `De fora` nasceu no Lançar e sumiu na edição.
   */
  lancamento?: LancamentoEdicao;
  /** Para onde voltar depois de salvar. */
  aoSalvar?: () => void;
  /**
   * O que vai ANTES do primeiro card, dentro da área rolável.
   *
   * Existe por causa do botão de importar fatura: ele é só da tela Lançar —
   * não faz sentido editando um lançamento que já existe — mas precisa rolar
   * junto com o formulário. Fora daqui ele viraria faixa fixa entre o
   * cabeçalho e a rolagem, comendo altura de tela no celular o tempo todo.
   */
  topo?: React.ReactNode;
  /**
   * Valores de partida para um lançamento NOVO — não é edição.
   *
   * Existe para o Quitar: ele abre esta tela com o acerto já preenchido, do
   * jeito que o `Form.html` fazia na tela antiga. A diferença é de onde vem o
   * número: antes a tela de quitação lia o saldo que o card tinha em memória;
   * agora quem monta isto é o servidor, a partir do MESMO `getAcertoContas()`
   * que desenha o card. Dois lugares calculando o saldo é como se cria a
   * divergência que ninguém sabe resolver depois.
   *
   * Não vai pela URL de propósito: valor do acerto é dado financeiro do casal,
   * e URL entra em histórico e em log de servidor. A URL só diz `?quitar=1`.
   */
  inicial?: {
    descricao?: string;
    valor?: number;
    categoria?: string;
    tipo?: string;
    origem?: string;
    pagador?: string;
    divisao?: Divisao;
  };
}

export default function FormLancamento({
  opcoes,
  lancamento,
  aoSalvar,
  topo,
  inicial,
}: Props) {
  const router = useRouter();
  const ed = lancamento;
  const editando = Boolean(ed);

  const [descricao, setDescricao] = useState(ed?.descricao ?? inicial?.descricao ?? '');
  const [valor, setValor] = useState(
    ed ? mascaraMoeda(numero(ed.valor)) : inicial?.valor ? mascaraMoeda(numero(inicial.valor)) : '',
  );
  const [data, setData] = useState(ed?.data ?? opcoes.hoje);
  const [categoria, setCategoria] = useState(ed?.categoria ?? inicial?.categoria ?? '');
  const [tipo, setTipo] = useState(ed?.tipo ?? inicial?.tipo ?? 'Variável');
  const [origem, setOrigem] = useState(ed?.fonte ?? inicial?.origem ?? 'Cartão');
  /**
   * As respostas das duas perguntas, num objeto só.
   *
   * Eram cinco `useState` separados aqui dentro. Viraram um porque agora quem
   * desenha é `DivisaoEPagador`, compartilhado com a edição de série e a
   * revisão de importação — e um componente controlado devolve a resposta
   * inteira, não cinco pedaços que as telas teriam que recombinar cada uma do
   * seu jeito.
   */
  const [reparticao, setReparticao] = useState<Reparticao>(() => {
    if (!ed) {
      const divisao: Divisao = inicial?.divisao ?? '50/50';
      return {
        pagador: inicial?.pagador ?? opcoes.eu ?? 'Irwin',
        divisao,
        fracao: fracaoDe(divisao, opcoes.pctIrwinRenda) ?? 0.5,
        quemDeFora: DE_FORA[0],
        pagoIrwinManual: null,
      };
    }
    const divisao: Divisao = ed.deFora ? 'De fora' : ((ed.divisao as Divisao) ?? '50/50');
    const fixa = fracaoDe(divisao, opcoes.pctIrwinRenda);
    return {
      pagador: ed.quemPagou ?? opcoes.eu ?? 'Irwin',
      divisao,
      // `Custom` não tem fração fixa: vem do lançamento, em percentual.
      fracao: fixa ?? (ed.pctCustom ?? 50) / 100,
      quemDeFora: ed.deFora && ed.gastoDe ? ed.gastoDe : DE_FORA[0],
      pagoIrwinManual: ed.quemPagou === 'Ambos' ? ed.pagoIrwin : null,
    };
  });
  const [ehAndre, setEhAndre] = useState(ed?.gastoDe === 'André');
  const [obs, setObs] = useState(ed?.obs ?? '');

  const [repeticao, setRepeticao] = useState<Repeticao>('nao');
  const [parcelas, setParcelas] = useState('12');
  const [tipoValor, setTipoValor] = useState<'total' | 'parcela'>('total');
  const [freq, setFreq] = useState('mensal');
  const [fimRec, setFimRec] = useState('');

  const [excluindo, setExcluindo] = useState(false);

  const [previa, setPrevia] = useState<{ data: string; descricao: string; valor: number }[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [avisoValor, setAvisoValor] = useState(false);

  const totalAnterior = useRef(0);

  const total = paraNumero(valor);
  const parteIrwin = arred(total * reparticao.fracao);
  const pagoIrwin = pagoIrwinDe(reparticao, total, parteIrwin);

  /**
   * Mudar o total mantém a PROPORÇÃO, não o valor digitado — foi a decisão de
   * 22/10, e é o que o banco guarda. A tela avisa, em vez de deixar o número
   * em reais mudar em silêncio debaixo do dedo.
   */
  function mudouValor(texto: string) {
    const novo = paraNumero(texto);
    if (reparticao.divisao === 'Custom' && totalAnterior.current > 0 && novo > 0 && novo !== totalAnterior.current) {
      setAvisoValor(true);
      setTimeout(() => setAvisoValor(false), 4500);
    }
    totalAnterior.current = novo;
    setValor(texto);
  }

  const buscarPrevia = useCallback(async () => {
    /* A descrição NÃO entra aqui.
       Ela entrava, e o efeito era a tela ficar muda: com valor e 12 parcelas
       preenchidos, quem ainda não tinha digitado o nome não via prévia nenhuma
       e não tinha como saber por quê. As datas e os valores não dependem do
       nome — só o rótulo da linha depende, e sem nome ele vira '1/12', que já
       é a informação que importa. */
    if (repeticao === 'nao' || total <= 0) {
      setPrevia([]);
      return;
    }
    try {
      const base = { data, descricao, valor: total };
      const r =
        repeticao === 'parcelado'
          ? await rpc('previewParcelas', { ...base, parcelado: true, parcelas, tipoValor })
          : await rpc('previewRecorrencia', {
              ...base,
              repetir: true,
              freqRec: freq,
              semFimRec: !fimRec,
              fimRec: fimRec || null,
            });
      setPrevia(r);
    } catch {
      setPrevia([]);
    }
  }, [repeticao, total, descricao, data, parcelas, tipoValor, freq, fimRec]);

  useEffect(() => {
    const t = setTimeout(buscarPrevia, 250);
    return () => clearTimeout(t);
  }, [buscarPrevia]);

  const categorias = useMemo(
    () => opcoes.gruposLancar.map((g) => g.nome),
    [opcoes.gruposLancar],
  );

  const ehQuitacao = categoria === '9 Acerto de Contas';
  /* O tipo de uma quitação é `Acerto`, venha ela do botão Quitar ou de alguém
     escolhendo a categoria à mão. São dois caminhos para a mesma linha, e
     deixá-los gravar tipos diferentes é como nasce dado que não se explica —
     a única quitação já gravada tem `Acerto`.

     Derivado, e não sincronizado por efeito: o estado `tipo` continua guardando
     o que a pessoa escolheu, então trocar a categoria de volta devolve a
     escolha dela intacta em vez de já ter sido sobrescrita no caminho. */
  const tipoGravado = ehQuitacao ? 'Acerto' : tipo;
  const ehFora = reparticao.divisao === 'De fora';

  async function salvar() {
    setErro('');
    if (!descricao.trim()) return setErro('Informe a descrição.');
    if (total <= 0) return setErro('Informe um valor maior que zero.');
    if (!categoria) return setErro('Escolha a categoria.');

    setSalvando(true);

    /* Os campos do lançamento são os MESMOS nas duas portas — só o verbo muda.
       `atualizarLancamento` ignora parcelado/repetir, porque editar uma linha
       nunca reparcela a compra: para isso existe a tela da série.

       Por isso criar é `{...campos}` mais o parcelamento, e não uma segunda
       lista escrita à mão: as duas existiram lado a lado e já cobraram o
       preço — travar o tipo da quitação exigiu a mesma edição duas vezes, e
       bastava esquecer uma para criar e editar gravarem coisas diferentes. */
    const campos = {
      data,
      descricao: descricao.trim(),
      grupo: categoria,
      tipo: tipoGravado,
      fonte: origem,
      valor: total,
      divisao: reparticao.divisao,
      deFora: ehFora,
      // A coluna guarda FRAÇÃO; a API converte de percentual. Mandar
      // percentual aqui é o contrato — ver `salvarLancamento`.
      pctIrwinCustom: reparticao.divisao === 'Custom' ? reparticao.fracao * 100 : null,
      quemPagou: reparticao.pagador,
      pagoIrwin: reparticao.pagador === 'Ambos' ? pagoIrwin : null,
      obs: obs.trim() || null,
      gastoDe: ehFora ? reparticao.quemDeFora : ehAndre ? 'André' : null,
    };

    try {
      if (ed) {
        await rpc('atualizarLancamento', ed.linha, campos);
        if (aoSalvar) aoSalvar();
        else router.push('/');
        return;
      }
      await rpc('salvarLancamento', {
        ...campos,
        parcelado: repeticao === 'parcelado',
        /**
         * `parcelas` SÓ vai quando é parcelado.
         *
         * `montarParcelas` lê este campo sem olhar para `parcelado` — mandar
         * "12" com `parcelado: false` cria doze parcelas em silêncio. Pego no
         * primeiro lançamento de verdade: a tela dizia "Nenhuma" e o banco
         * recebeu `1/12` a `12/12`. É a E1 inteira num caso só — a tela não
         * prova nada, o que foi gravado prova.
         */
        parcelas: repeticao === 'parcelado' ? parcelas : 1,
        tipoValor,
        repetir: repeticao === 'recorrente',
        freqRec: freq,
        fimRec: fimRec || null,
        semFimRec: repeticao === 'recorrente' && !fimRec,
      });
      if (aoSalvar) aoSalvar();
      else router.push('/');
    } catch (e) {
      setErro(e instanceof ErroRpc ? e.message : 'Não deu para salvar.');
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!ed) return;
    // Exclusão não se desfaz. A confirmação diz O QUE vai sumir, com valor —
    // "Tem certeza?" sozinho não dá ao dedo nenhuma informação nova.
    const ok = window.confirm(
      `Excluir "${ed.descricao}" de R$ ${numero(ed.valor)}?\n\nIsto não pode ser desfeito.`,
    );
    if (!ok) return;
    setErro('');
    setExcluindo(true);
    try {
      await rpc('excluirLancamento', ed.linha);
      if (aoSalvar) aoSalvar();
      else router.push('/');
    } catch (e) {
      setErro(e instanceof ErroRpc ? e.message : 'Não deu para excluir.');
      setExcluindo(false);
    }
  }

  return (
    <div className="form-lanc">
      {topo}
      <div className="card">
        <div className="linha-desc">
          <label className="campo">
            <span>Descrição</span>
            <input
              type="text"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Supermercado"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="btn-andre"
            aria-pressed={ehAndre}
            // `title` é dica do mouse e não vira nome acessível de forma
            // confiável; num app de celular ninguém passa o mouse. Sem o
            // `aria-label` o botão se anuncia como "botão", sem dizer o quê.
            aria-label="Gasto do André"
            title="Gasto do André"
            onClick={() => setEhAndre((v) => !v)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/avatar-andre.jpg" alt="André" />
          </button>
        </div>
        <div className="linha" style={{ marginTop: 12 }}>
          <label className="campo">
            <span>Valor</span>
            <input
              type="text"
              inputMode="decimal"
              value={valor}
              onChange={(e) => mudouValor(mascaraMoeda(e.target.value))}
              placeholder="0,00"
            />
          </label>
          <label className="campo">
            <span>Data</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </label>
        </div>
        {ehAndre && (
          <p className="nota">
            Marcado como gasto do <b>André</b>. Isso classifica de quem é o custo —{' '}
            <b>não muda a divisão nem o acerto</b>.
          </p>
        )}
      </div>

      <div className="card">
        <div className="rot">Categoria</div>
        <div className="chips">
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className="chip cat"
              style={{ '--c': COR_CATEGORIA[c] ?? '#6E6E6E' } as React.CSSProperties}
              aria-pressed={categoria === c}
              onClick={() => setCategoria(c)}
            >
              <i className="pt" />
              {c}
            </button>
          ))}
        </div>
        {ehQuitacao && (
          <p className="aviso">
            Acerto de contas <b>não é despesa</b>: não entra no resultado do mês. Só abate o que
            um deve ao outro.
          </p>
        )}

        {/* Na quitação os chips somem: `Acerto` não é Fixa nem Variável, e a
            tela mostrava os dois apagados — um convite a marcar um deles e
            transformar o acerto numa despesa fixa do mês. */}
        {!ehQuitacao && (
          <>
            <div className="rot sep">Tipo</div>
            <div className="chips">
              {['Variável', 'Fixa'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  aria-pressed={tipo === t}
                  onClick={() => setTipo(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="rot sep">Origem</div>
        <div className="chips">
          {opcoes.origens.map((o) => (
            <button
              key={o}
              type="button"
              className="chip"
              aria-pressed={origem === o}
              onClick={() => setOrigem(o)}
            >
              {o}
            </button>
          ))}
        </div>
        <p className="nota">Banco cobre tudo que sai da conta: Pix, TED, débito automático, boleto.</p>
      </div>

      <DivisaoEPagador
        total={total}
        valor={reparticao}
        aoMudar={setReparticao}
        pagadores={opcoes.pagadoresLancar}
        pctIrwinRenda={opcoes.pctIrwinRenda}
        avisoValor={avisoValor}
      />

      {/* EDITANDO: a repetição sai da tela, e no lugar entra o caminho para a
          série. Editar uma linha nunca reparcela a compra — quem faz isso é a
          tela da série, que mexe nas irmãs junto. Oferecer "Parcelado" aqui
          seria prometer o que esta porta não cumpre. */}
      {editando && ed?.serieId ? (
        <a className="card ir-serie" href={`/serie/${ed.serieId}?de=${ed.linha}`}>
          <span>
            {ed.serieTipo === 'recorrencia'
              ? 'Ver a recorrência inteira'
              : `Ver as ${ed.serieTotal ?? ed.serieLancamentos} parcelas desta compra`}
          </span>
          <span className="seta">›</span>
        </a>
      ) : null}

      {!editando && (
      <div className="card">
        <div className="rot">Repetição</div>
        <div className="chips">
          {(
            [
              ['nao', 'Nenhuma'],
              ['parcelado', 'Parcelado'],
              ['recorrente', 'Recorrente'],
            ] as const
          ).map(([v, r]) => (
            <button
              key={v}
              type="button"
              className="chip"
              aria-pressed={repeticao === v}
              onClick={() => setRepeticao(v)}
            >
              {r}
            </button>
          ))}
        </div>

        {repeticao === 'parcelado' && (
          <div className="linha" style={{ marginTop: 13 }}>
            <label className="campo">
              <span>Parcelas</span>
              <input
                type="number"
                min={2}
                max={48}
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value)}
              />
            </label>
            <label className="campo">
              <span>O valor digitado é</span>
              <select value={tipoValor} onChange={(e) => setTipoValor(e.target.value as 'total' | 'parcela')}>
                <option value="total">o total da compra</option>
                <option value="parcela">o de cada parcela</option>
              </select>
            </label>
          </div>
        )}

        {repeticao === 'recorrente' && (
          <div className="linha" style={{ marginTop: 13 }}>
            <label className="campo">
              <span>Frequência</span>
              <select value={freq} onChange={(e) => setFreq(e.target.value)}>
                <option value="mensal">mensal</option>
                <option value="quinzenal">quinzenal</option>
                <option value="semanal">semanal</option>
              </select>
            </label>
            <label className="campo">
              <span>Até quando</span>
              <input type="date" value={fimRec} onChange={(e) => setFimRec(e.target.value)} />
            </label>
          </div>
        )}

        {repeticao !== 'nao' && previa.length > 0 && (
          <div className="previa">
            <div className="cab">
              <span>
                {repeticao === 'parcelado'
                  ? `${previa.length} parcelas`
                  : `${previa.length} ${previa.length === 1 ? 'ocorrência agora' : 'ocorrências agora'}`}
              </span>
            </div>
            <ul>
              {previa.map((p, i) => (
                <li key={i}>
                  <span className="dt">{p.data}</span>
                  {/* O NOME é metade da prévia: é a descrição que vai ser
                      gravada, com o `N/N` que o servidor monta. Sem ele a
                      lista é só um calendário de valores, e não dá para
                      conferir o que vai nascer. */}
                  {/* `trim()` porque sem descrição o servidor devolve ' 1/12',
                      com o espaço do nome vazio na frente. */}
                  <span className="nm">{p.descricao.trim()}</span>
                  <span className="vl">{brl(p.valor)}</span>
                </li>
              ))}
            </ul>
            <div className="pe">
              {repeticao === 'parcelado'
                ? 'A última parcela absorve o arredondamento.'
                : 'Entram agora só as ocorrências até o fim deste mês. As demais são geradas automaticamente, uma por vez, no dia 1º de cada mês — o app nunca adianta o futuro.'}
            </div>
          </div>
        )}
      </div>
      )}

      <div className="card">
        <details className="mais">
          <summary>Mais detalhes</summary>
          <div className="detalhes">
            <label className="campo">
              <span>Observação</span>
              <textarea
                rows={2}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="De onde veio o número, por que o valor é esse…"
              />
            </label>
          </div>
        </details>
      </div>

      {erro && <p className="erro">{erro}</p>}

      <div className="rodape">
        <div className="dentro">
          <div className="resumo">
            <b>R$ {numero(total)}</b>
            {ehFora
              ? 'de fora'
              : repeticao === 'parcelado'
                ? 'parcelado'
                : repeticao === 'recorrente'
                  ? 'recorrente'
                  : 'à vista'}
          </div>
          {/* Excluir fica à ESQUERDA do Salvar e sem preenchimento: é a ação
              destrutiva, não pode disputar o dedo com a que se usa sempre. */}
          {editando && (
            <button type="button" className="excluir" onClick={excluir} disabled={excluindo || salvando}>
              {excluindo ? 'Excluindo…' : 'Excluir'}
            </button>
          )}
          <button type="button" className="salvar" onClick={salvar} disabled={salvando || excluindo}>
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

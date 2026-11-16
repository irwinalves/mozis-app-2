'use client';

/**
 * Registrar que a pessoa devolveu.
 *
 * O VALOR NASCE PREENCHIDO COM O SALDO, e isso não é conveniência: o caso
 * dominante é a devolução do valor cheio, e digitar R$ 200,00 de novo é a
 * chance de digitar R$ 20,00. Quem devolveu só parte troca o número.
 *
 * "QUEM RECEBEU" NÃO TEM PADRÃO SILENCIOSO quando os dois pagaram gastos dela.
 * É a mesma regra do pagador obrigatório (A4): adivinhar aqui faz a devolução
 * sumir do controle de quem adiantou de verdade. Quando só um dos dois pagou,
 * aí sim o campo abre nele — não é palpite, é a única resposta possível.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { rpc } from '@/lib/rpc';
import { brl, lerMoeda, mascaraMoeda, numero } from '@/lib/formato';

interface Devolucao {
  id: number;
  data: string;
  valor: number;
  paraQuem: string;
  obs: string | null;
}

export function Devolucoes({
  pessoa,
  saldo,
  eu,
  devolucoes,
}: {
  pessoa: string;
  saldo: number;
  eu: string | null;
  devolucoes: Devolucao[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(numero(Math.max(0, saldo)));
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [paraQuem, setParaQuem] = useState(eu === 'Irwin' || eu === 'Maria' ? eu : '');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const v = lerMoeda(valor);

  async function gravar() {
    setErro('');
    if (!(v > 0)) return setErro('O valor tem que ser maior que zero.');
    if (paraQuem !== 'Irwin' && paraQuem !== 'Maria') return setErro('Diga quem recebeu.');
    setOcupado(true);
    try {
      await rpc('registrarReembolso', { pessoa, paraQuem, valor: v, data, obs });
      setAberto(false);
      setObs('');
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui gravar.');
    } finally {
      setOcupado(false);
    }
  }

  async function apagar(id: number, valorDela: number) {
    if (
      !confirm(
        `Apagar a devolução de ${brl(valorDela)}?\n\nA dívida de ${pessoa} volta a contar esse valor.`,
      )
    )
      return;
    try {
      await rpc('excluirReembolso', id);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui apagar.');
    }
  }

  return (
    <div className="card" style={{ paddingTop: 6, paddingBottom: 6 }}>
      <div className="titulo-lista">
        <span>Devoluções</span>
        {!aberto && (
          <button type="button" className="link" onClick={() => setAberto(true)}>
            + registrar
          </button>
        )}
      </div>

      {aberto && (
        <div className="form-devolucao">
          <div className="grade">
            <div className="campo">
              <label>Quanto devolveu</label>
              <input
                type="text"
                inputMode="decimal"
                value={valor}
                autoFocus
                onChange={(e) => setValor(mascaraMoeda(e.target.value))}
              />
            </div>
            <div className="campo">
              <label>Quando</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </div>
          </div>

          <div className="campo">
            <label>Quem recebeu</label>
            <div className="escolhas">
              {(['Irwin', 'Maria'] as const).map((q) => (
                <button
                  key={q}
                  type="button"
                  className={paraQuem === q ? 'on' : ''}
                  onClick={() => setParaQuem(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="campo">
            <label>Observação (opcional)</label>
            <input
              type="text"
              value={obs}
              placeholder="Pix, dinheiro, cobre dois meses…"
              onChange={(e) => setObs(e.target.value)}
            />
          </div>

          {erro && <div className="t-erro">{erro}</div>}

          <div className="acoes-devolucao">
            <button type="button" className="link" onClick={() => setAberto(false)}>
              cancelar
            </button>
            <button type="button" className="btn-linha forte" disabled={ocupado} onClick={gravar}>
              {ocupado ? 'Gravando…' : `Registrar ${brl(v)}`}
            </button>
          </div>
        </div>
      )}

      {devolucoes.length === 0 && !aberto && (
        <div className="vazio">Nada devolvido ainda.</div>
      )}

      {devolucoes.map((d) => (
        <div key={d.id} className="linha-terceiro">
          <div className="lt-nome">
            <b>{brl(d.valor)}</b>
            <span className="lt-meta">
              {d.data.slice(8, 10)}/{d.data.slice(5, 7)} · para {d.paraQuem}
              {d.obs && ` · ${d.obs}`}
            </span>
          </div>
          <button
            type="button"
            className="link tirar"
            onClick={() => apagar(d.id, d.valor)}
          >
            apagar
          </button>
        </div>
      ))}
    </div>
  );
}

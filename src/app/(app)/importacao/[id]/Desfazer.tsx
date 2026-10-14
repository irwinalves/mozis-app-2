'use client';

/**
 * Desfazer o lote inteiro.
 *
 * Duas etapas de propósito: apagar 154 linhas de uma vez é destrutivo e não
 * tem volta, então o primeiro toque só revela a consequência e o segundo é que
 * age. É a mesma trava do excluir de um lançamento, com o número na frente.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { rpc } from '@/lib/rpc';

export function Desfazer({
  id,
  qtd,
  podeEditar,
}: {
  id: number;
  qtd: number;
  /** Lotes anteriores à coluna `estado` não têm a revisão para reabrir. */
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function desfazer() {
    setErro('');
    setOcupado(true);
    try {
      await rpc('desfazerImportacao', id);
      router.push('/');
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui desfazer.');
      setOcupado(false);
    }
  }

  if (!confirmando) {
    /*
     * Os dois lado a lado, grudados no topo da rolagem.
     *
     * Antes eram dois blocos largos no FIM da lista: para editar um lote de 143
     * linhas era preciso rolar as 143. A ação que se quer é sempre a mesma
     * — ajustar — e ela estava atrás do trabalho todo.
     *
     * `Editar` preenchido e `Desfazer` só com contorno: agora que o destrutivo
     * está sempre ao alcance do polegar, a diferença de peso importa mais, não
     * menos. A confirmação em duas etapas continua.
     */
    return (
      <div className="acoes-lote">
        {podeEditar && (
          <Link href={`/importacao/${id}/editar`} className="btn-par forte">
            Editar
          </Link>
        )}
        <button type="button" className="btn-par perigo" onClick={() => setConfirmando(true)}>
          Desfazer
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 10 }}>
      {erro && <div className="msg-erro">{erro}</div>}
      <div className="aviso" style={{ marginTop: 0 }}>
        <span>⚠</span>
        <div>
          Isso apaga <b>{qtd} {qtd === 1 ? 'lançamento' : 'lançamentos'}</b> e as séries que esta
          importação criou. As conciliações de valor que você confirmou <b>não voltam</b> — elas
          mudaram lançamentos que já existiam.
        </div>
      </div>
      <button type="button" className="btn-perigo forte" disabled={ocupado} onClick={desfazer}>
        {ocupado ? 'Apagando…' : `Sim, apagar ${qtd}`}
      </button>
      <button type="button" className="btn-linha" onClick={() => setConfirmando(false)}>
        Cancelar
      </button>
    </div>
  );
}

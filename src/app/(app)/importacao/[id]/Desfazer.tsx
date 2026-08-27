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
    return (
      <>
        {/* Editar vem antes de desfazer, e com mais peso: ajustar o lote é o
            que se quer quase sempre, e apagar tudo é o caso extremo. */}
        {podeEditar && (
          <Link href={`/importacao/${id}/editar`} className="btn-linha forte" style={{ marginTop: 12 }}>
            Editar esta importação
          </Link>
        )}
        <button type="button" className="btn-perigo" onClick={() => setConfirmando(true)}>
          Desfazer esta importação
        </button>
      </>
    );
  }

  return (
    <div className="card">
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

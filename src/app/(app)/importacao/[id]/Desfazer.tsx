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
import { rpc } from '@/lib/rpc';

export function Desfazer({ id, qtd }: { id: number; qtd: number }) {
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
      <button type="button" className="btn-perigo" onClick={() => setConfirmando(true)}>
        Desfazer esta importação
      </button>
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

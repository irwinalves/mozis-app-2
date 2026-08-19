/**
 * Importação de extrato — parsers portados do Apps Script.
 *
 * Funções puras: recebem texto e devolvem transações. XLSX e PDF continuam
 * sendo convertidos NO NAVEGADOR antes de chegar aqui (SheetJS e pdf.js, via
 * CDN sob demanda), então este módulo só vê texto.
 *
 * Regra transversal e deliberada: só entram valores **> 0**, não `abs`. Isso
 * descarta estornos e pagamentos de fatura, que chegam negativos e não são
 * gasto novo.
 */

export interface Transacao {
  data: string;
  descricao: string;
  valor: number;
}

/** OFX: blocos <STMTTRN>, com DTPOSTED, TRNAMT e MEMO/NAME. */
export function parseOFX(texto: string): Transacao[] {
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  return blocos
    .map((b) => {
      const data = (b.match(/<DTPOSTED>([^\r\n<]+)/i) || [])[1] || '';
      const valorStr = (b.match(/<TRNAMT>([^\r\n<]+)/i) || [])[1] || '0';
      const memo =
        (b.match(/<MEMO>([^\r\n<]+)/i) || [])[1] ||
        (b.match(/<NAME>([^\r\n<]+)/i) || [])[1] ||
        '';
      const y = data.substr(0, 4), m = data.substr(4, 2), d = data.substr(6, 2);
      return {
        data: y && m && d ? `${y}-${m}-${d}` : '',
        descricao: memo.trim(),
        valor: Math.abs(parseFloat(valorStr)) || 0,
      };
    })
    .filter((t) => t.data && t.valor > 0);
}

/**
 * Split de CSV respeitando aspas.
 * Um campo como `"R$ 1,234.56"` contém o próprio delimitador — split ingênuo quebra.
 */
export function dividirLinhaCSV(linha: string, delim: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (dentroAspas) {
      if (ch === '"') {
        if (linha[i + 1] === '"') { atual += '"'; i++; }
        else dentroAspas = false;
      } else atual += ch;
    } else if (ch === '"') {
      dentroAspas = true;
    } else if (ch === delim) {
      campos.push(atual);
      atual = '';
    } else {
      atual += ch;
    }
  }
  campos.push(atual);
  return campos;
}

export function ehValorMonetario(campo: string): boolean {
  const s = String(campo).replace(/^R\$\s*/i, '').trim();
  return /^-?\d{1,3}([.,]\d{3})*[.,]\d{2}$/.test(s) || /^-?\d+$/.test(s);
}

/**
 * Converte valor SEM presumir localidade: aceita `1.234,56` (BR) e `1,234.56`
 * (o que o SheetJS às vezes gera). Regra: o ÚLTIMO separador é o decimal.
 */
export function converterValor(campo: string): number {
  let s = String(campo).replace(/^R\$\s*/i, '').trim();
  const neg = s.charAt(0) === '-';
  if (neg) s = s.slice(1);
  const p = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const numStr = p === -1 ? s : s.slice(0, p).replace(/[.,]/g, '') + '.' + s.slice(p + 1);
  const v = parseFloat(numStr);
  return neg ? -v : v;
}

/**
 * CSV: detecta o delimitador, pula o bloco de cabeçalho do banco procurando uma
 * linha com "Data" + "Lançamento", e identifica cada campo por FORMATO, não por
 * posição — exportações de banco não têm layout estável.
 */
export function parseCSV(texto: string): Transacao[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!linhas.length) return [];
  const delim = linhas[0].split(';').length >= linhas[0].split(',').length ? ';' : ',';
  const todas = linhas.map((l) => dividirLinhaCSV(l, delim).map((c) => c.trim()));

  let idxHeader = -1;
  for (let i = 0; i < todas.length; i++) {
    const temData = todas[i].some((c) => /^data$/i.test(c));
    const temLanc = todas[i].some((c) => /^lan[çc]amento$/i.test(c));
    if (temData && temLanc) { idxHeader = i; break; }
  }
  const inicio = idxHeader >= 0 ? idxHeader + 1 : 0;

  const out: Transacao[] = [];
  for (let li = inicio; li < todas.length; li++) {
    const campos = todas[li];
    if (campos.length < 2) continue;
    let data: string | null = null;
    let valor: number | null = null;
    let descricao = '';
    campos.forEach((c) => {
      if (data === null) {
        const m1 = c.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const m2 = c.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (m1) { data = `${m1[1]}-${m1[2]}-${m1[3]}`; return; }
        if (m2) { data = `${m2[3]}-${m2[2]}-${m2[1]}`; return; }
      }
      if (valor === null && ehValorMonetario(c)) { valor = converterValor(c); return; }
      if (!descricao && c) descricao = c;
    });
    if (data && valor !== null && valor > 0) {
      out.push({ data, descricao: descricao || '(sem descrição)', valor });
    }
  }
  return out;
}

/**
 * PDF: heurístico. Procura data e valor na MESMA linha, com o valor DEPOIS da
 * data, e usa o que sobra como descrição.
 *
 * Explicitamente menos confiável que os outros — é por isso que a prévia importa
 * mais aqui, e a tela avisa o usuário.
 */
export function parsePDF(texto: string): Transacao[] {
  const linhas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const reData = /(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/;
  const reValor = /\(?-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\)?\s*$/;
  const anoAtual = new Date().getFullYear();
  const out: Transacao[] = [];

  linhas.forEach((linha) => {
    const md = linha.match(reData);
    const mv = linha.match(reValor);
    if (!md || !mv) return;
    if (md.index === undefined || mv.index === undefined) return;
    // O valor precisa vir DEPOIS da data, senão é outro número qualquer.
    if (mv.index < md.index + md[0].length) return;

    const dd = md[1], mm = md[2];
    const ano = md[3] ? (md[3].length === 2 ? '20' + md[3] : md[3]) : String(anoAtual);
    const valor = converterValor(mv[0].replace(/[()]/g, '').trim());
    if (!valor || valor <= 0) return;

    let desc = linha.slice(md.index + md[0].length, mv.index).trim();
    desc = desc.replace(/^[-–:\s]+|[-–:\s]+$/g, '');
    if (!desc) return;

    out.push({ data: `${ano}-${mm}-${dd}`, descricao: desc, valor });
  });

  return out;
}

export interface CategoriaKw {
  nome: string;
  keywords: string[];
}

/** Casa a descrição com as palavras-chave do Plano de Contas; sem match, `7 Outros`. */
export function sugerirCategoria(desc: string, plano: CategoriaKw[]): string {
  const d = String(desc).toLowerCase();
  for (const cat of plano) {
    for (const kw of cat.keywords) {
      if (kw && d.indexOf(kw) > -1) return cat.nome;
    }
  }
  return '7 Outros';
}

/** Despacha para o parser conforme o tipo de arquivo. */
export function parsePorTipo(conteudo: string, tipo: string): Transacao[] {
  if (tipo === 'ofx') return parseOFX(conteudo);
  if (tipo === 'pdf') return parsePDF(conteudo);
  return parseCSV(conteudo);
}

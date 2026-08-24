/** SÓ LEITURA — ensaio do backfill da Fase 0.2, versão final. Não grava. */
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!);

// A fração NÃO fica sempre no fim: há `Kit DDS Dani 1/4 [cartao temp]` e
// `Maranhão 4/4 (3/4 cada um pagou o seu)`. Pega-se a PRIMEIRA ocorrência e o
// que sobra à direita continua fazendo parte da descrição — que é apresentação.
const RE = /^(.*?)\s[(]?(\d[\d,+]*)\/(\d+)[)]?(\s|$)/;

const normal = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

interface L { id: number; data: string; descricao: string; valor: string }
type P = L & { raiz: string; chave: string; seq: number; total: number; v: number };

const linhas = await sql<L[]>`
  select id, data::text as data, descricao, valor_total::text as valor
  from lancamentos
  where descricao ~ ' [(]?[0-9][0-9,+]*/[0-9]+[)]?' order by data, id`;

const parseadas: P[] = [];
const naoParseadas: L[] = [];
for (const l of linhas) {
  const m = RE.exec(l.descricao);
  if (!m) { naoParseadas.push(l); continue; }
  parseadas.push({
    ...l, raiz: m[1], chave: normal(m[1]),
    seq: Number(m[2].split(/[,+]/)[0]), total: Number(m[3]), v: Number(l.valor),
  });
}

const grupos = new Map<string, P[]>();
for (const p of parseadas) {
  const k = p.chave + ' ' + p.total;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k)!.push(p);
}

type Serie = { nome: string; total: number; itens: P[]; completa: boolean; via: string };
const series: Serie[] = [];
const semIdentidade: { nome: string; total: number; itens: P[] }[] = [];
const seqUnicas = (it: P[]) => new Set(it.map((i) => i.seq)).size === it.length;

for (const itens of grupos.values()) {
  itens.sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
  const nome = itens[0].raiz;
  const total = itens[0].total;
  const guardar = (it: P[], via: string) =>
    series.push({ nome, total, itens: it, completa: it.length === total, via });

  // Identidade exige apenas que não haja DOIS lançamentos disputando a mesma
  // posição. Faltar parcela é história (nem toda compra foi lançada inteira),
  // não ambiguidade — a série continua sendo uma só.
  if (seqUnicas(itens)) { guardar(itens, 'seq única'); continue; }

  // Colisão: o VALOR separa séries intercaladas — duas compras no mesmo mês,
  // ambas em 6x. Agrupa por valor arredondado porque a última parcela absorve
  // o arredondamento (A7) e difere em centavos.
  const porValor = new Map<number, P[]>();
  for (const p of itens) {
    const b = Math.round(p.v);
    if (!porValor.has(b)) porValor.set(b, []);
    porValor.get(b)!.push(p);
  }
  if (porValor.size > 1 && [...porValor.values()].every(seqUnicas)) {
    for (const sub of porValor.values()) guardar(sub, 'separada por valor');
  } else {
    semIdentidade.push({ nome, total, itens });
  }
}

const n = (a: { itens: P[] }[]) => a.reduce((s, x) => s + x.itens.length, 0);
const completas = series.filter((s) => s.completa);
const incompletas = series.filter((s) => !s.completa);

console.log('linhas com padrao N/M ..........', linhas.length);
console.log('  nao parseadas ................', naoParseadas.length);
console.log('');
console.log('series com IDENTIDADE ..........', series.length, '->', n(series), 'linhas');
console.log('  completas ....................', completas.length, '->', n(completas), 'linhas');
console.log('  incompletas (falta parcela) ..', incompletas.length, '->', n(incompletas), 'linhas');
console.log('  separadas por valor ..........', series.filter((s) => s.via !== 'seq única').length);
console.log('SEM identidade (rotulo repetido)', semIdentidade.length, '->', n(semIdentidade), 'linhas');

if (naoParseadas.length) {
  console.log('\n-- ainda nao parseadas --');
  console.table(naoParseadas.map((l) => ({ id: l.id, data: l.data, descricao: l.descricao })));
}

console.log('\n-- sem identidade: dado torto, precisa de decisao humana --');
for (const a of semIdentidade) {
  console.log(`\n  ${a.nome} — ${a.itens.length} linhas de ${a.total}`);
  console.table(a.itens.map((i) => ({ id: i.id, data: i.data, descricao: i.descricao, valor: i.valor })));
}

console.log('\n-- series em ABERTO: as que a tela de edicao vai operar --');
const hoje = new Date().toISOString().slice(0, 10);
console.table(series.filter((s) => s.itens.some((i) => i.data > hoje)).map((s) => ({
  nome: s.nome, total: s.total, tem: s.itens.length, valor: s.itens[0].valor,
  futuras: s.itens.filter((i) => i.data > hoje).length,
  de: s.itens[0].data, ate: s.itens[s.itens.length - 1].data,
})));

await sql.end();

/**
 * As cores que carregam significado — identidade visual fixa do projeto.
 *
 * Mora num módulo próprio porque a MESMA cor aparece em lugares que não se
 * importam: o chip de categoria no Lançar, o chip na revisão de fatura, a
 * bolinha da lista e as fatias do gráfico do mês. Duas cópias desalinhariam o
 * relatório do formulário — e seria invisível de dentro de cada arquivo, que
 * é exatamente a armadilha do A26.
 */

/** A cor é da CATEGORIA, não do estado do botão. */
export const COR_CATEGORIA: Record<string, string> = {
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

/** Categoria desconhecida — nova, ou vinda de dado legado. */
export const COR_PADRAO = '#6E6E6E';

export const corDaCategoria = (nome: string) => COR_CATEGORIA[nome] ?? COR_PADRAO;

import type { Paginated, PaginationMeta } from '../utils/pagination.js';

export interface DataResponse<T> {
  data: T;
}

/** Envelope padrão para respostas de item único. Listagens usam `Paginated<T>`. */
export function ok<T>(data: T): DataResponse<T> {
  return { data };
}

export function paginated<T>(data: T[], pagination: PaginationMeta): Paginated<T> {
  return { data, pagination };
}

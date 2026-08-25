export interface Pagination {
  page: number
  pageSize: number
  offset: number
}

export type PaginationResult =
  | ({ ok: true } & Pagination)
  | { ok: false; status: number; error: string }

// Parses ?page=&pageSize= the same way across every paginated route (was
// duplicated 5x with no lower-bound check - page=0/negative produces a
// negative OFFSET and pageSize<=0 produces a zero/negative FETCH NEXT, both
// of which SQL Server rejects with a raw driver error instead of a clean
// 400). NaN from a non-numeric value is rejected the same way.
export function parsePagination(searchParams: URLSearchParams, maxPageSize = 200): PaginationResult {
  const page = parseInt(searchParams.get('page') || '1')
  const pageSize = parseInt(searchParams.get('pageSize') || '50')

  if (!Number.isInteger(page) || page < 1) {
    return { ok: false, status: 400, error: 'page must be a positive integer' }
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { ok: false, status: 400, error: 'pageSize must be a positive integer' }
  }

  const cappedPageSize = Math.min(pageSize, maxPageSize)
  return { ok: true, page, pageSize: cappedPageSize, offset: (page - 1) * cappedPageSize }
}

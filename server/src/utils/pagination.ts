export interface PaginationResult<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationResult<T> {
  return {
    items,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    },
  };
}

/** Maps a sort field name to a Prisma orderBy object for a known entity. */
export function orderBy(
  sortBy: string,
  sortOrder: 'asc' | 'desc',
  fields: Record<string, string>,
): Record<string, string>[] {
  const field = fields[sortBy] ?? fields.name ?? sortBy;
  return [{ [field]: sortOrder }];
}
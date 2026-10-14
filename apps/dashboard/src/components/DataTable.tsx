import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useState } from 'react';

/** Bảng có sắp xếp (TanStack Table, SPEC-00 §3). */
export function DataTable<T>({ data, columns, empty, initialSort, rowClass }: { data: T[]; columns: ColumnDef<T, unknown>[]; empty?: string; initialSort?: SortingState; rowClass?: (row: T) => string | undefined }) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const table = useReactTable({ data, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  if (data.length === 0) return <p className="muted empty">{empty ?? 'Không có dữ liệu.'}</p>;
  return (
    <table className="table">
      <thead>
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((h) => {
              const sort = h.column.getIsSorted();
              return (
                <th key={h.id} onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined} className={h.column.getCanSort() ? 'sortable' : undefined}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {sort === 'asc' ? ' ▲' : sort === 'desc' ? ' ▼' : ''}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((r) => (
          <tr key={r.id} className={rowClass?.(r.original)}>
            {r.getVisibleCells().map((c) => (
              <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

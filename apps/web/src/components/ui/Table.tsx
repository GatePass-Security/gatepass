"use client";

import { type HTMLAttributes, type ReactNode, useState, useCallback, useMemo } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cx } from "@/lib/utils";

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: "left" | "right";
  className?: string;
  render?: (value: T[keyof T], row: T) => ReactNode;
}

interface TableProps<T> extends HTMLAttributes<HTMLTableElement> {
  columns: Column<T>[];
  data: T[];
  onSort?: (column: string, direction: "asc" | "desc") => void;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  emptyMessage?: string;
  /** Accessible name for the table. */
  caption?: string;
  /**
   * Stable identity per row. Falls back to the array index, which is only safe
   * while the data never reorders — supply this whenever rows can be sorted.
   */
  getRowKey?: (row: T, index: number) => string | number;
}

/** Ordinal compare that keeps numbers numeric and everything else lexical. */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  onSort,
  sortColumn,
  sortDirection = "asc",
  emptyMessage = "No data available",
  caption,
  getRowKey,
  className = "",
  ...props
}: TableProps<T>) {
  const [internalSort, setInternalSort] = useState<{ column: string; direction: "asc" | "desc" }>({
    column: sortColumn ?? "",
    direction: sortDirection,
  });

  const controlled = sortColumn !== undefined;
  const currentSort = controlled ? { column: sortColumn, direction: sortDirection } : internalSort;

  const handleSort = useCallback(
    (column: string) => {
      const next = currentSort.column === column && currentSort.direction === "asc" ? "desc" : "asc";
      if (onSort) onSort(column, next);
      else setInternalSort({ column, direction: next });
    },
    [currentSort, onSort],
  );

  /*
   * When the parent controls sorting it hands back already-ordered data. When it
   * does not, the table has to do the sorting itself — previously the fallback
   * only flipped the arrow and set aria-sort="ascending" while the rows stayed
   * in their original order, telling a screen reader the table was sorted when
   * it was not.
   */
  const rows = useMemo(() => {
    if (controlled || !currentSort.column) return data;
    const key = currentSort.column;
    const dir = currentSort.direction === "asc" ? 1 : -1;
    return [...data].sort((a, b) => compareValues(a[key], b[key]) * dir);
  }, [data, controlled, currentSort.column, currentSort.direction]);

  return (
    <div className={cx("gp-card overflow-x-auto", className)}>
      <table className="w-full text-[0.855rem]" {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-sunken">
            {columns.map((col) => {
              const active = currentSort.column === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cx(
                    "px-4 py-2.5 text-[0.68rem] font-medium tracking-[0.06em] text-fg-muted uppercase",
                    col.align === "right" ? "text-right" : "text-left",
                    col.className,
                  )}
                  aria-sort={active ? (currentSort.direction === "asc" ? "ascending" : "descending") : undefined}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className={cx(
                        "inline-flex cursor-pointer items-center gap-1.5 rounded transition-colors hover:text-fg",
                        active && "text-fg",
                      )}
                    >
                      {col.header}
                      {active ? (
                        currentSort.direction === "asc" ? (
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-[0.82rem] text-fg-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              <tr
                key={getRowKey ? getRowKey(row, rowIdx) : rowIdx}
                className="border-b border-line transition-colors last:border-b-0 hover:bg-raised/60"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cx(
                      "px-4 py-3 text-fg-secondary",
                      col.align === "right" ? "text-right" : "text-left",
                      col.className,
                    )}
                  >
                    {col.render ? col.render(row[col.key] as T[keyof T], row) : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

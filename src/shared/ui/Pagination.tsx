import { useEffect, useState } from "react";

export interface PageState {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  setPage: (page:number) => void;
  setPageSize: (size:number) => void;
}

export function usePagination<T>(rows: T[], defaultPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => { if (page !== currentPage) setPage(currentPage); }, [page, currentPage]);
  return {
    pageItems: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    pagination: { page: currentPage, pageCount, pageSize, total: rows.length, setPage, setPageSize } satisfies PageState,
  };
}

export function PaginationBar({ state }: { state: PageState }) {
  const first = state.total ? (state.page - 1) * state.pageSize + 1 : 0;
  const last = Math.min(state.page * state.pageSize, state.total);
  return <nav className="pagination-bar" aria-label="التنقل بين صفحات الجدول">
    <span className="pagination-count">عرض {first}–{last} من {state.total}</span>
    <label className="pagination-size">صفوف الصفحة
      <select aria-label="عدد الصفوف في الصفحة" value={state.pageSize} onChange={event => { state.setPageSize(Number(event.target.value)); state.setPage(1); }}>
        {[10,20,50,100].map(size => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
    <div className="pagination-buttons">
      <button className="secondary" aria-label="الصفحة الأولى" disabled={state.page <= 1} onClick={() => state.setPage(1)}>الأولى</button>
      <button className="secondary" aria-label="الصفحة السابقة" disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)}>السابق</button>
      <span aria-live="polite">{state.page} / {state.pageCount}</span>
      <button className="secondary" aria-label="الصفحة التالية" disabled={state.page >= state.pageCount} onClick={() => state.setPage(state.page + 1)}>التالي</button>
      <button className="secondary" aria-label="الصفحة الأخيرة" disabled={state.page >= state.pageCount} onClick={() => state.setPage(state.pageCount)}>الأخيرة</button>
    </div>
  </nav>;
}

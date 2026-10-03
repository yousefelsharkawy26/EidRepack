import { AppState } from "../lib/domain";
import { Screen } from "../lib/types";

function SearchResults({ state, query, onPick }: { state: AppState; query: string; onPick: (screen: Screen) => void }) {
  const q = query.trim().toLowerCase()
  const results = [
    ...state.items.filter(item => (item.name + item.sku).toLowerCase().includes(q)).map(item => ({ text: item.name, detail: item.sku, screen: 'inventory' as Screen })),
    ...state.customers.filter(customer => customer.name.toLowerCase().includes(q)).map(customer => ({ text: customer.name, detail: 'عميل', screen: 'customers' as Screen })),
    ...state.sales.filter(sale => sale.number.toLowerCase().includes(q)).map(sale => ({ text: sale.number, detail: 'فاتورة بيع', screen: 'collections' as Screen }))
  ].slice(0, 5)
  if (!results.length) return <div style={{ position: 'absolute', top: 67, left: 90, width: 280, background: 'white', border: '1px solid #e2ebe6', boxShadow: '0 12px 30px #173c3217', borderRadius: 10, padding: 12, zIndex: 2, fontSize: 11, color: '#71817b' }}>لا توجد نتائج مطابقة</div>
  return <div style={{ position: 'absolute', top: 67, left: 90, width: 280, background: 'white', border: '1px solid #e2ebe6', boxShadow: '0 12px 30px #173c3217', borderRadius: 10, padding: 6, zIndex: 2 }}>{results.map((result, index) => <button key={index} onClick={() => onPick(result.screen)} style={{ display: 'block', width: '100%', textAlign: 'right', background: 'transparent', padding: '9px 8px', borderRadius: 7 }}><b style={{ display: 'block', color: '#274139', fontSize: 11 }}>{result.text}</b><small style={{ color: '#82918b', fontSize: 10 }}>{result.detail}</small></button>)}</div>
}

export default SearchResults
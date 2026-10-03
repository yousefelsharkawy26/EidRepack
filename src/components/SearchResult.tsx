import { AppState } from "../lib/domain";
import { Screen } from "../app/screens";

function SearchResults({ state, query, onPick }: { state: AppState; query: string; onPick: (screen: Screen) => void }) {
  const q = query.trim().toLowerCase()
  const results = [
    ...state.items.filter(item => (item.name + item.sku).toLowerCase().includes(q)).map(item => ({ text: item.name, detail: item.sku, screen: 'inventory' as Screen })),
    ...state.customers.filter(customer => customer.name.toLowerCase().includes(q)).map(customer => ({ text: customer.name, detail: 'عميل', screen: 'customers' as Screen })),
    ...state.sales.filter(sale => sale.number.toLowerCase().includes(q)).map(sale => ({ text: sale.number, detail: 'فاتورة بيع', screen: 'collections' as Screen }))
  ].slice(0, 5)
  if (!results.length) return <div className="search-results search-results-empty">لا توجد نتائج مطابقة</div>
  return <div className="search-results">{results.map((result, index) => <button className="search-result" key={index} onClick={() => onPick(result.screen)}><b>{result.text}</b><small>{result.detail}</small></button>)}</div>
}

export default SearchResults

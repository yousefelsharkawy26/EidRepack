import { HandCoins, PackageCheck, ShoppingBag, ShoppingCart } from "lucide-react"
import { activityTime, AppState } from "../lib/domain"

function Activity({ title, detail, at, type }: AppState['activity'][number]) {
  const Icon = type === 'sale' ? ShoppingBag : type === 'packing' ? PackageCheck : type === 'purchase' ? ShoppingCart : HandCoins
  return <div className="activity-row"><div className={'activity-icon ' + type}><Icon size={16}/></div><div className="activity-main"><b>{title}</b><span>{detail}</span></div><time>{activityTime(at)}</time></div>
}

export default Activity
function Metric({ title, value, note, icon, tone = '' }: { title: string; value: string; note: string; icon: React.ReactNode; tone?: string }) {
  return <div className="metric"><div className="metric-head"><span>{title}</span><span className={'metric-icon ' + tone}>{icon}</span></div><strong>{value}</strong><div className="metric-foot">{note}</div></div>
}

export default Metric
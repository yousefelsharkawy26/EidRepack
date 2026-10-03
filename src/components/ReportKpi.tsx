function ReportKpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="report-kpi"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

export default ReportKpi
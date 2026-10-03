function ReportRow({ label, value }: { label: string; value: string }) {
  return <div className="report-list-row"><span>{label}</span><strong>{value}</strong></div>
}

export default ReportRow
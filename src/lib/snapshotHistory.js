function nextDay(day) {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function buildNetWorthHistory(dailyRows, runRows) {
  const daily = new Map((dailyRows ?? []).map((row) => [row.day, row]))
  const runs = new Map((runRows ?? []).map((row) => [row.target_day, row]))
  const dates = [...daily.keys(), ...runs.keys()].sort()
  if (dates.length === 0) return []

  const points = []
  for (let day = dates[0]; day <= dates.at(-1); day = nextDay(day)) {
    const row = daily.get(day)
    const run = runs.get(day)
    if (row) {
      points.push(Object.freeze({
        ...row,
        quality_status: row.run_id === null ? 'legacy' : row.quality_status,
        history_status: row.run_id === null ? 'legacy' : row.quality_status,
        is_gap: false,
      }))
    } else {
      points.push(Object.freeze({
        day,
        total_aed: null,
        assets_aed: null,
        liabilities_aed: null,
        run_id: run?.id ?? null,
        quality_status: run?.status === 'skipped_incomplete' ? 'skipped' : 'gap',
        history_status: run?.status === 'skipped_incomplete' ? 'skipped' : 'gap',
        quality_evidence: run?.final_evidence ?? null,
        snapshot_at: run?.snapshot_at ?? null,
        is_gap: true,
      }))
    }
  }
  return Object.freeze(points)
}

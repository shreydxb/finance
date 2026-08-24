export async function loadAccountsWealthView({ loadWealth, listHistory }) {
  const [wealth, history] = await Promise.all([loadWealth(), listHistory(90)])
  return Object.freeze({ wealth, history })
}

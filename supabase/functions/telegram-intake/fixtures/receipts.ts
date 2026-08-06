// A corpus of model responses shaped like the ones a vision model actually
// returns for the receipt types this household sends: Noon/Carrefour orders,
// restaurant bills, fuel, utilities, and Zerodha-style INR contract notes —
// plus the misbehaviours worth pinning down (markdown fences, prose preamble, a
// stringy amount, a 0–100 confidence, an unreadable total, an invented
// category). Model-agnostic on purpose: these guarantees must hold whichever
// model OPENROUTER_MODEL points at.
//
// These exercise the deterministic half of the pipeline. Tuning the *prompt*
// against real photographs still needs live keys and real receipts — see
// README.md, "Tuning against real receipts".

export const TODAY = '2026-08-06'

export interface ReceiptCase {
  label: string
  raw: string
  expect: {
    amount: number | null
    currency: string
    category: string | null
    date?: string
    confidence?: number
    confidenceAtMost?: number
    note?: string | null
  }
}

export const RECEIPT_CASES: ReceiptCase[] = [
  {
    label: 'Carrefour grocery run, clean JSON',
    raw: '{"date":"2026-08-05","amount":184.25,"currency":"AED","category":"Groceries","paid_by":"Shrey","paid_with":"ENBD Credit Card 4412","note":"Carrefour · weekly groceries","confidence":0.94}',
    expect: { amount: 184.25, currency: 'AED', category: 'Groceries', date: '2026-08-05', confidence: 0.94 },
  },
  {
    label: 'Noon order wrapped in a markdown fence',
    raw: '```json\n{"date":"2026-08-06","amount":329,"currency":"AED","category":"Shopping","paid_by":"Tarika","paid_with":"Wio Personal","note":"Noon · kitchen storage set","confidence":0.91}\n```',
    expect: { amount: 329, currency: 'AED', category: 'Shopping', confidence: 0.91 },
  },
  {
    label: 'Restaurant bill with the amount as a currency string',
    raw: '{"date":"2026-08-04","amount":"AED 236.50","currency":"AED","category":"Dining Out","paid_by":"Shrey","paid_with":"VISA ****4412","note":"Reif Kushiyaki · dinner for two","confidence":0.9}',
    expect: { amount: 236.5, currency: 'AED', category: 'Dining Out', confidence: 0.9 },
  },
  {
    label: 'Zerodha contract note in rupees',
    raw: '{"date":"2026-08-03","amount":"12,500.00","currency":"₹","category":"Savings & Investments","paid_by":"Shrey","paid_with":null,"note":"Zerodha · Nifty index fund SIP","confidence":0.88}',
    expect: { amount: 12500, currency: 'INR', category: 'Savings & Investments', confidence: 0.88 },
  },
  {
    label: 'ENOC fuel, day-first receipt date',
    raw: '{"date":"04/08/2026","amount":142,"currency":"AED","category":"Transport & Fuel","paid_by":"Shrey","paid_with":"ENBD Credit Card 4412","note":"ENOC · petrol","confidence":0.93}',
    expect: { amount: 142, currency: 'AED', category: 'Transport & Fuel', date: '2026-08-04', confidence: 0.93 },
  },
  {
    label: 'DEWA bill with confidence on a 0–100 scale',
    raw: '{"date":"2026-08-01","amount":612.4,"currency":"AED","category":"Utilities","paid_by":"Shrey","paid_with":"Joint Current","note":"DEWA · July bill","confidence":88}',
    expect: { amount: 612.4, currency: 'AED', category: 'Utilities', confidence: 0.88 },
  },
  {
    label: 'Talabat order behind a sentence of preamble',
    raw: 'Here is the extracted transaction:\n{"date":"2026-08-06","amount":74.5,"currency":"AED","category":"Dining Out","paid_by":"Tarika","paid_with":"Wio Personal","note":"Talabat · Wagamama","confidence":0.87}',
    expect: { amount: 74.5, currency: 'AED', category: 'Dining Out', confidence: 0.87 },
  },
  {
    label: 'Lulu receipt with trailing commentary',
    raw: '{"date":"2026-08-02","amount":88.9,"currency":"AED","category":"Groceries","paid_by":"Shrey","paid_with":"Joint Current","note":"Lulu Hypermarket","confidence":0.92}\nLet me know if you need anything else.',
    expect: { amount: 88.9, currency: 'AED', category: 'Groceries', confidence: 0.92 },
  },
  {
    label: 'Dirhams written as Dhs',
    raw: '{"date":"2026-08-06","amount":55,"currency":"Dhs","category":"Dining Out","paid_by":"Shrey","paid_with":"cash","note":"Karak stop","confidence":0.86}',
    expect: { amount: 55, currency: 'AED', category: 'Dining Out', confidence: 0.86 },
  },
  {
    label: 'Category abbreviated to "dining"',
    raw: '{"date":"2026-08-06","amount":120,"currency":"AED","category":"dining","paid_by":"Shrey","paid_with":null,"note":"Tashas · brunch","confidence":0.84}',
    expect: { amount: 120, currency: 'AED', category: 'Dining Out', confidence: 0.84 },
  },
  {
    label: 'Thousands separator with no decimals',
    raw: '{"date":"2026-08-06","amount":"1,234","currency":"AED","category":"Shopping","paid_by":"Tarika","paid_with":"Wio Personal","note":"IKEA · desk","confidence":0.89}',
    expect: { amount: 1234, currency: 'AED', category: 'Shopping', confidence: 0.89 },
  },
  {
    label: 'Pharmacy receipt with no currency printed',
    raw: '{"date":"2026-08-06","amount":63.75,"currency":null,"category":"Medical","paid_by":"Tarika","paid_with":null,"note":"Life Pharmacy · prescription","confidence":0.9}',
    expect: { amount: 63.75, currency: 'AED', category: 'Medical', confidence: 0.9 },
  },
  {
    label: 'Refund shown as a negative total',
    raw: '{"date":"2026-08-06","amount":-84,"currency":"AED","category":"Shopping","paid_by":"Shrey","paid_with":"ENBD Credit Card 4412","note":"Noon · returned charger","confidence":0.9}',
    expect: { amount: 84, currency: 'AED', category: 'Shopping', confidence: 0.9 },
  },
  {
    label: 'Mis-read year lands in the future',
    raw: '{"date":"2027-08-06","amount":45,"currency":"AED","category":"Groceries","paid_by":"Shrey","paid_with":"Joint Current","note":"Union Coop","confidence":0.88}',
    expect: { amount: 45, currency: 'AED', category: 'Groceries', date: TODAY, confidence: 0.88 },
  },
  {
    label: 'Blurred total — model admits it and still gets capped',
    raw: '{"date":"2026-08-06","amount":null,"currency":"AED","category":"Groceries","paid_by":"Shrey","paid_with":"Joint Current","note":"Waitrose · total unreadable","confidence":0.55}',
    expect: { amount: null, currency: 'AED', category: 'Groceries', confidenceAtMost: 0.2 },
  },
  {
    label: 'Invented category the household does not have',
    raw: '{"date":"2026-08-06","amount":210,"currency":"AED","category":"Pet Supplies","paid_by":"Tarika","paid_with":"Wio Personal","note":"Pet Corner · cat food","confidence":0.95}',
    expect: { amount: 210, currency: 'AED', category: null, confidenceAtMost: 0.6 },
  },
]

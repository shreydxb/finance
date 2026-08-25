import { useEffect, useState } from 'react'
import {
  Amount,
  AttentionIndicator,
  Badge,
  Button,
  Card,
  ChartFrame,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FreshnessIndicator,
  IconButton,
  Input,
  LoadingState,
  MissingValue,
  Panel,
  Percentage,
  ProvenanceDisclosure,
  QualityIndicator,
  Select,
  Status,
  Textarea,
} from './index'

const CHART_COLUMNS = [
  { key: 'period', label: 'Period' },
  { key: 'value', label: 'Fixture value' },
  { key: 'quality', label: 'Supplied quality' },
]

const CHART_ROWS = [
  { id: 'may', period: 'May', value: 'AED 420,000', quality: 'Complete' },
  { id: 'jun', period: 'June', value: 'AED 438,000', quality: 'Complete' },
  { id: 'jul', period: 'July', value: 'Unavailable', quality: 'Incomplete' },
  { id: 'aug', period: 'August', value: 'AED 451,200', quality: 'Provisional' },
]

const TOKEN_SWATCHES = [
  ['Canvas', 'bg-canvas'],
  ['Surface', 'bg-surface'],
  ['Subtle', 'bg-surface-subtle'],
  ['Action', 'bg-action'],
  ['Positive', 'bg-financial-positive'],
  ['Negative', 'bg-financial-negative'],
  ['Attention', 'bg-attention'],
]

function PreviewSection({ children, description, id, title }) {
  return (
    <section aria-labelledby={id} className="grid gap-4">
      <div>
        <h2 id={id} className="m-0 text-title-2 font-semibold text-text-primary">{title}</h2>
        {description ? <p className="mb-0 mt-1 max-w-copy text-body text-text-secondary">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function Preview() {
  const [theme, setTheme] = useState('light')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
    return () => {
      document.documentElement.classList.remove('dark', 'reduce-motion')
    }
  }, [theme, reduceMotion])

  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-shell flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="m-0 text-label font-semibold uppercase tracking-[0.14em] text-action">SHR-117 · Phase 1</p>
            <h1 className="mb-0 mt-1 text-title-1 font-[650] tracking-tight">Design-system foundation</h1>
            <p className="mb-0 mt-1 text-body text-text-secondary">Deterministic fixture data only · no authentication or production data calls</p>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Preview controls">
            <Button
              intent="secondary"
              aria-pressed={theme === 'dark'}
              onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}
            >
              {theme === 'light' ? 'Use dark theme' : 'Use light theme'}
            </Button>
            <Button
              intent="secondary"
              aria-pressed={reduceMotion}
              onClick={() => setReduceMotion((value) => !value)}
            >
              {reduceMotion ? 'Motion reduced' : 'Reduce motion'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-content gap-12 px-4 py-8 sm:px-6 sm:py-12">
        <PreviewSection id="tokens" title="Semantic foundation" description="Semantic roles are the public contract; raw ramps remain temporary migration compatibility.">
          <Panel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
              {TOKEN_SWATCHES.map(([label, color]) => (
                <div key={label} className="grid gap-2">
                  <div className={`h-14 rounded-control border border-border ${color}`} />
                  <span className="text-label font-semibold text-text-secondary">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-3 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">
              <p className="m-0 text-display font-[650] tracking-tight">Display</p>
              <p className="m-0 text-title-1 font-[650]">Page title</p>
              <p className="m-0 text-title-2 font-semibold">Section title</p>
              <p className="m-0 text-body text-text-secondary">Body copy stays compact, calm, and readable.</p>
            </div>
          </Panel>
        </PreviewSection>

        <PreviewSection id="actions" title="Actions and controls" description="Intent, loading, disabled, invalid, labeling, help, and error states are explicit.">
          <Panel className="grid gap-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Primary action</Button>
              <Button intent="secondary">Secondary</Button>
              <Button intent="quiet">Quiet action</Button>
              <Button intent="danger">Destructive</Button>
              <Button loading>Saving</Button>
              <Button disabled>Disabled</Button>
              <IconButton label="More options">···</IconButton>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Household label that remains readable when it becomes unusually long" help="Help text is programmatically associated with this input." required>
                <Input defaultValue="Our Money household" />
              </Field>
              <Field label="Reporting view" error="Choose an available reporting view.">
                <Select defaultValue="">
                  <option value="">Select a view</option>
                  <option value="summary">Summary</option>
                  <option value="detail">Detailed records</option>
                </Select>
              </Field>
              <Field label="Notes" help="Presentation-only fixture copy.">
                <Textarea defaultValue="A calm multiline control with a persistent label." />
              </Field>
              <div className="grid content-start gap-3">
                <Checkbox label="Include reviewed records" description="The caller supplies what reviewed means." defaultChecked />
                <Checkbox label="Unavailable option" description="Disabled state remains legible." disabled />
              </div>
            </div>
          </Panel>
        </PreviewSection>

        <PreviewSection id="values" title="Financial presentation" description="Values arrive already formatted and semantically classified; these primitives perform no arithmetic or inference.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="m-0 text-label font-semibold text-text-secondary">Large supplied amount</p>
              <Amount className="mt-2 block break-words text-title-1" label="AED 12,345,678.90">AED 12,345,678.90</Amount>
            </Card>
            <Card>
              <p className="m-0 text-label font-semibold text-text-secondary">Supplied negative value</p>
              <Amount className="mt-2 block text-title-1" tone="negative" label="negative AED 48,250">−AED 48,250</Amount>
            </Card>
            <Card>
              <p className="m-0 text-label font-semibold text-text-secondary">Supplied positive change</p>
              <Percentage className="mt-2 block text-title-1" tone="positive" label="up 4.2 percent">+4.2%</Percentage>
            </Card>
            <Card>
              <p className="m-0 text-label font-semibold text-text-secondary">Missing value</p>
              <MissingValue className="mt-2 text-title-1" reason="Unavailable because a required fixture input is missing" />
            </Card>
          </div>
        </PreviewSection>

        <PreviewSection id="statuses" title="Status, quality, freshness, and attention" description="Separate presentation channels consume caller-supplied states and explanations.">
          <Panel className="grid gap-6">
            <div className="flex flex-wrap gap-2">
              <Badge>Neutral</Badge>
              <Badge tone="info">Information</Badge>
              <Badge tone="success">Success</Badge>
              <Badge tone="warning">Warning</Badge>
              <Badge tone="danger">Error</Badge>
              <Badge tone="positive">Positive</Badge>
              <Badge tone="negative">Negative</Badge>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Status tone="success" label="Connected" />
              <Status tone="warning" label="Needs attention" />
              <Status tone="danger" label="Unavailable" />
            </div>
            <div className="flex flex-wrap items-start gap-4">
              <QualityIndicator status="complete" reason="All required fixture inputs are present." detail="Status supplied directly by the preview fixture." />
              <QualityIndicator status="provisional" reason="One supplied input requires review." detail="No quality inference occurs inside the component." />
              <QualityIndicator status="incomplete" reason="A required supplied input is missing." detail="Dependent values remain unavailable." />
            </div>
            <FreshnessIndicator state="stale" label="Stale fixture" timestamp="Updated 19 Aug 2026" dateTime="2026-08-19" detail="The stale state and display timestamp are supplied; no threshold is calculated here." />
            <ProvenanceDisclosure label="Fixture provenance">
              This demonstration uses hard-coded, non-production strings. The component does not query or interpret a source.
            </ProvenanceDisclosure>
            <AttentionIndicator
              tone="review"
              label="2 fixture records require review"
              description="Review severity and count are supplied by the caller."
              actionLabel="Review fixture"
              onAction={() => {}}
            />
          </Panel>
        </PreviewSection>

        <PreviewSection id="feedback" title="Feedback states">
          <div className="grid gap-4 lg:grid-cols-3">
            <EmptyState title="No matching fixture records" description="Clear filters or add a record when this is a real domain surface." action={<Button intent="secondary">Clear fixture filters</Button>} />
            <LoadingState label="Loading fixture state" />
            <ErrorState title="Fixture could not load" description="The inline action remains near the recoverable error." onAction={() => {}} />
          </div>
        </PreviewSection>

        <PreviewSection id="overlays" title="Accessible overlays" description="Radix Dialog supplies portaling, focus containment, Escape dismissal, inert background behavior, and focus restoration.">
          <Panel className="flex flex-wrap gap-3">
            <Dialog
              title="Inspect fixture details"
              description="Focus enters this dialog, stays contained, and returns to the trigger when it closes."
              trigger={<Button intent="secondary">Open dialog</Button>}
              footer={<Button>Done</Button>}
            >
              <Field label="Dialog note" help="Tab through this field and the dialog actions.">
                <Input defaultValue="Deterministic fixture" />
              </Field>
            </Dialog>
            <ConfirmDialog
              open={confirmOpen}
              onOpenChange={setConfirmOpen}
              trigger={<Button intent="danger">Open confirmation</Button>}
              title="Delete fixture record?"
              description="This is a deterministic demonstration. Cancel receives initial focus as the safe default."
              cancelLabel="Keep fixture"
              confirmLabel="Delete fixture"
              onConfirm={() => setConfirmOpen(false)}
            />
          </Panel>
        </PreviewSection>

        <PreviewSection id="chart" title="Chart accessibility foundation" description="The visual is illustrative; the complete deterministic data alternative is always available to keyboard and assistive-technology users.">
          <ChartFrame
            title="Illustrative history fixture"
            description="Four supplied periods with one incomplete and one provisional observation."
            summary="Supplied summary: August is AED 451,200; July is unavailable."
            columns={CHART_COLUMNS}
            rows={CHART_ROWS}
            trailing={<Badge tone="warning">Provisional fixture</Badge>}
          >
            <div className="ds-chart-grid flex h-56 items-end gap-4 rounded-control border border-border bg-surface-subtle px-4 pt-4">
              <div className="h-[62%] flex-1 rounded-t bg-action-soft ring-1 ring-inset ring-action/30" />
              <div className="h-[74%] flex-1 rounded-t bg-action-soft ring-1 ring-inset ring-action/30" />
              <div className="h-[12%] flex-1 border-x border-t border-dashed border-danger bg-danger-soft" />
              <div className="h-[82%] flex-1 rounded-t bg-action ring-1 ring-inset ring-action" />
            </div>
          </ChartFrame>
        </PreviewSection>
      </main>
    </div>
  )
}

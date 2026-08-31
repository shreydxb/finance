import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import {
  Amount,
  AttentionIndicator,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  FreshnessIndicator,
  IconButton,
  Input,
  LoadingState,
  MissingValue,
  Percentage,
  QualityIndicator,
  DataTable,
  Kpi,
  KpiGroup,
  SectionHeader,
  SegmentedControl,
  Select,
  Textarea,
} from './index'

describe('foundation controls', () => {
  it('exposes loading, disabled, invalid, and icon labels', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <div>
        <Button loading onClick={onClick}>Saving record</Button>
        <Button disabled onClick={onClick}>Disabled action</Button>
        <IconButton label="More options">···</IconButton>
        <Field label="Reporting view" help="Choose one view." error="A view is required." required>
          <Select defaultValue="">
            <option value="">Select</option>
          </Select>
        </Field>
        <Field label="Notes" help="Optional context.">
          <Textarea />
        </Field>
        <Checkbox label="Include reviewed records" description="Caller-supplied filter." />
      </div>,
    )

    const loading = screen.getByRole('button', { name: 'Saving record' })
    expect(loading).toBeDisabled()
    expect(loading).toHaveAttribute('aria-busy', 'true')
    await user.click(loading)
    await user.click(screen.getByRole('button', { name: 'Disabled action' }))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'More options' })).toHaveAccessibleName('More options')

    const select = screen.getByLabelText(/Reporting view/)
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAttribute('required')
    expect(select).toHaveAccessibleDescription('Choose one view. A view is required.')
    expect(screen.getByLabelText('Notes')).toHaveAccessibleDescription('Optional context.')
    expect(screen.getByLabelText('Include reviewed records')).toHaveAccessibleDescription('Caller-supplied filter.')
  })

  it('shows supplied financial and domain states without deriving them', () => {
    render(
      <div>
        <Amount tone="negative" label="negative AED 48,250">−AED 48,250</Amount>
        <Amount label="AED 12,345,678.90">AED 12,345,678.90</Amount>
        <Percentage tone="positive" label="up 4.2 percent">+4.2%</Percentage>
        <MissingValue reason="Required fixture input is missing" />
        <QualityIndicator status="complete" reason="Fixture complete" />
        <QualityIndicator status="provisional" reason="Fixture provisional" />
        <QualityIndicator status="incomplete" reason="Fixture incomplete" />
        <FreshnessIndicator state="stale" label="Stale fixture" timestamp="Updated 19 Aug 2026" />
        <AttentionIndicator label="2 records require review" description="Severity supplied by caller." tone="review" />
      </div>,
    )

    expect(screen.getByLabelText('negative AED 48,250')).toHaveTextContent('−AED 48,250')
    expect(screen.getByLabelText('AED 12,345,678.90')).toHaveTextContent('AED 12,345,678.90')
    expect(screen.getByText('Required fixture input is missing')).toHaveClass('ds-visually-hidden')
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Provisional')).toBeInTheDocument()
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
    expect(screen.getByText('Stale fixture')).toBeInTheDocument()
    expect(screen.getByText('2 records require review')).toBeInTheDocument()
  })

  it('renders feedback states with accessible status and actions', async () => {
    const retry = vi.fn()
    const user = userEvent.setup()
    render(
      <div>
        <EmptyState title="No matching records" description="Clear filters." />
        <LoadingState label="Loading records" />
        <ErrorState title="Could not load" description="Try safely again." onAction={retry} />
      </div>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading records')
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('exposes V6 section, KPI, segment, and overflow-table primitives without deriving values', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <section>
        <SectionHeader kicker="Fixture" title="Shared patterns" description="Caller-supplied content." />
        <SegmentedControl
          label="Fixture period"
          value="mtd"
          onChange={onChange}
          options={[{ value: 'mtd', label: 'MTD' }, { value: 'ytd', label: 'YTD' }]}
        />
        <KpiGroup label="Fixture summary">
          <Kpi label="Recorded" value="AED 12,000" hint="Canonical fixture" />
        </KpiGroup>
        <DataTable caption="Fixture financial table">
          <table><tbody><tr><th scope="row">Recorded</th><td>AED 12,000</td></tr></tbody></table>
        </DataTable>
      </section>,
    )

    expect(screen.getByRole('heading', { name: 'Shared patterns' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Fixture period' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'MTD' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Fixture financial table' })).toHaveAttribute('tabindex', '0')
    await user.click(screen.getByRole('button', { name: 'YTD' }))
    expect(onChange).toHaveBeenCalledWith('ytd')
  })

  it('has no automated accessibility violations in representative light and dark states', async () => {
    const { container, rerender } = render(
      <main>
        <Field label="Long household field label that must remain associated" help="Helpful context.">
          <Input />
        </Field>
        <Button>Continue</Button>
        <QualityIndicator status="provisional" reason="Review supplied fixture" />
      </main>,
    )
    expect(await axe(container)).toHaveNoViolations()

    document.documentElement.classList.add('dark')
    rerender(
      <main>
        <Field label="Long household field label that must remain associated" help="Helpful context.">
          <Input />
        </Field>
        <Button>Continue</Button>
        <QualityIndicator status="incomplete" reason="Missing supplied fixture" />
      </main>,
    )
    expect(await axe(container)).toHaveNoViolations()
    document.documentElement.classList.remove('dark')
  })
})

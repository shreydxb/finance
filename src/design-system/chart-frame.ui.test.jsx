import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChartFrame } from './index'

describe('ChartFrame', () => {
  it('provides a keyboard-operable complete data alternative', async () => {
    const user = userEvent.setup()
    render(
      <ChartFrame
        title="Fixture history"
        description="Deterministic observations"
        summary="July is unavailable."
        columns={[
          { key: 'period', label: 'Period' },
          { key: 'value', label: 'Value' },
          { key: 'quality', label: 'Quality' },
        ]}
        rows={[
          { id: 'jun', period: 'June', value: 'AED 438,000', quality: 'Complete' },
          { id: 'jul', period: 'July', value: 'Unavailable', quality: 'Incomplete' },
        ]}
      >
        <svg><rect width="10" height="10" /></svg>
      </ChartFrame>,
    )

    expect(screen.getByText('July is unavailable.')).toBeInTheDocument()
    const disclosure = screen.getByText('View data table')
    await user.click(disclosure)
    const table = screen.getByRole('table', { name: 'Fixture history data' })
    expect(table).toBeVisible()
    expect(screen.getByRole('row', { name: /July Unavailable Incomplete/ })).toBeInTheDocument()
  })
})

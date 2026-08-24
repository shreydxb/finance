export const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Leave this page and discard them?'

export function confirmNavigation(dirty, confirmDiscard) {
  return !dirty || confirmDiscard(UNSAVED_CHANGES_MESSAGE)
}

import preview from '../../../../.storybook/preview'
import { ErrorState } from './ErrorState'

// CSF Factory format (ADR-0027 §4). Molecule tier — the recoverable error panel over the Card + Button
// atoms (already proven); these stories cover only the retryable vs not-retryable branch it adds.
const meta = preview.meta({
  title: 'molecules/ErrorState',
  component: ErrorState,
  args: { message: 'flags-service is unreachable or timed out.', onRetry: () => {} },
})

export const Retryable = meta.story({})
export const NotRetryable = meta.story({
  args: { title: 'Not found', message: 'No post with that id exists.', retryable: false },
})

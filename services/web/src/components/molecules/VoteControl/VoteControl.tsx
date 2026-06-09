import { forwardRef } from 'react'
import { IconButton } from '../../atoms/IconButton'

export type VoteValue = 1 | -1 | 0

export interface VoteControlProps {
  score: number
  /** The viewer's current vote, for highlighting (0 / undefined = none). */
  value?: VoteValue
  pending?: boolean
  orientation?: 'vertical' | 'horizontal'
  onVote: (value: 1 | -1) => void
}

/** Molecule: the Reddit-shaped up/score/down control. Colours come from the vote tokens. */
export const VoteControl = forwardRef<HTMLDivElement, VoteControlProps>(function VoteControl(
  { score, value = 0, pending = false, orientation = 'vertical', onVote },
  ref,
) {
  const layout = orientation === 'vertical' ? 'flex-col' : 'flex-row'
  return (
    <div ref={ref} className={`flex ${layout} items-center gap-1`}>
      <IconButton
        label="Upvote"
        disabled={pending}
        onClick={() => onVote(1)}
        className={value === 1 ? 'border-upvote text-upvote' : 'border-transparent text-muted'}
      >
        ▲
      </IconButton>
      <span
        className={`min-w-8 text-center text-sm font-semibold tabular-nums ${value === 1 ? 'text-upvote' : value === -1 ? 'text-downvote' : 'text-text'}`}
      >
        {score}
      </span>
      <IconButton
        label="Downvote"
        disabled={pending}
        onClick={() => onVote(-1)}
        className={value === -1 ? 'border-downvote text-downvote' : 'border-transparent text-muted'}
      >
        ▼
      </IconButton>
    </div>
  )
})
VoteControl.displayName = 'VoteControl'

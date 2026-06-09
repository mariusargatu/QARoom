import { forwardRef, type HTMLAttributes } from 'react'

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  /** The display name or handle the initials + colour derive from. */
  name: string
  size?: AvatarSize
}

const SIZE: Record<AvatarSize, string> = {
  sm: 'h-6 w-6 text-[0.6rem]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-14 w-14 text-lg',
}

// Token-only background tints; index is a deterministic char-sum (no Math.random — determinism
// lint). Initials use the high-contrast `text-text` (set in the base class) so small avatars clear
// WCAG AA — the colour identity lives in the background, not the glyph.
const TINTS = ['bg-primary/30', 'bg-accent/30', 'bg-success/30', 'bg-warning/30', 'bg-info/30']

// Branded ids ("user_01KT…", "comm_…") would otherwise initialise to the prefix ("US", "CO"),
// collapsing every user/community to the same two letters. Detect that shape and derive initials
// from the trailing alphanumerics instead, so distinct entities read distinctly.
const ID_PREFIX = /^(user|comm|sess|post|key|mdec)_/

function initials(name: string): string {
  const trimmed = name.trim()
  if (ID_PREFIX.test(trimmed)) {
    const tail = trimmed.replace(/[^a-zA-Z0-9]/g, '').slice(-2)
    return tail ? tail.toUpperCase() : '?'
  }
  const words = trimmed.split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first) return '?'
  const second = words[1]
  if (!second) return first.slice(0, 2).toUpperCase()
  return (first.charAt(0) + second.charAt(0)).toUpperCase()
}

function tintFor(name: string): string {
  let sum = 0
  for (const ch of name) sum += ch.charCodeAt(0)
  return TINTS[sum % TINTS.length] ?? 'bg-primary/20 text-primary'
}

/** Atom: an initials avatar. Colour + initials are a deterministic function of the name. */
export const Avatar = forwardRef<HTMLSpanElement, AvatarProps>(function Avatar(
  { name, size = 'md', className = '', ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      role="img"
      aria-label={name}
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-text ${SIZE[size]} ${tintFor(name)} ${className}`}
      {...rest}
    >
      {initials(name)}
    </span>
  )
})
Avatar.displayName = 'Avatar'

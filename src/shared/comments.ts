export type CommentPerson = {
  id: string
  name: string
  email: string
  color: string
  initial: string
  avatarUrl?: string
}

export const CURRENT_USER: CommentPerson = {
  id: 'user-jesse',
  name: 'Jesse Bishop',
  email: 'jesse@vanta.local',
  color: '#5B5FC7',
  initial: 'J'
}

export const COMMENT_PEOPLE: CommentPerson[] = [
  CURRENT_USER,
  {
    id: 'user-maya',
    name: 'Maya Chen',
    email: 'maya@vanta.local',
    color: '#E06B9A',
    initial: 'M'
  },
  {
    id: 'user-alex',
    name: 'Alex Rivera',
    email: 'alex@vanta.local',
    color: '#2D9F6F',
    initial: 'A'
  },
  {
    id: 'user-sam',
    name: 'Sam Okonkwo',
    email: 'sam@vanta.local',
    color: '#D97706',
    initial: 'S'
  },
  {
    id: 'user-priya',
    name: 'Priya Nair',
    email: 'priya@vanta.local',
    color: '#0EA5E9',
    initial: 'P'
  }
]

export function getCommentPerson(id: string): CommentPerson {
  return COMMENT_PEOPLE.find((person) => person.id === id) || CURRENT_USER
}

export function formatCommentTime(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  const days = Math.floor(delta / 86_400_000)
  if (days === 1) return '1 day ago'
  if (days < 14) return `${days} days ago`
  return new Date(ts).toLocaleDateString()
}

export function nextCommentNumber(nodes: Array<{ type: string; commentNumber?: number }>): number {
  let max = 0
  for (const node of nodes) {
    if (node.type === 'comment' && node.commentNumber) max = Math.max(max, node.commentNumber)
  }
  return max + 1
}

export function renderCommentText(text: string): Array<{ type: 'text' | 'mention'; value: string }> {
  const parts: Array<{ type: 'text' | 'mention'; value: string }> = []
  const re = /@\[(.+?)\]\((.+?)\)|@([\w.-]+)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
    if (match[1] && match[2]) {
      parts.push({ type: 'mention', value: match[1] })
    } else if (match[3]) {
      const person = COMMENT_PEOPLE.find(
        (item) => item.name.toLowerCase().startsWith(match![3].toLowerCase()) || item.initial.toLowerCase() === match![3].toLowerCase()
      )
      parts.push({ type: 'mention', value: person?.name || match[3] })
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  if (!parts.length) parts.push({ type: 'text', value: text })
  return parts
}

export function mentionToken(person: CommentPerson): string {
  return `@[${person.name}](${person.id})`
}

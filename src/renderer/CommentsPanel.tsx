import { useMemo, useState } from 'react'
import SearchIcon from '@mui/icons-material/Search'
import FilterListIcon from '@mui/icons-material/FilterList'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import CheckIcon from '@mui/icons-material/Check'
import type { DesignNode, DesignPage } from '../shared/types'
import { formatCommentTime, getCommentPerson } from '../shared/comments'
import { CommentRichText } from './CommentOverlays'

export function CommentsPanel({
  comments,
  pages,
  activeId,
  showResolved,
  query,
  onQuery,
  onToggleResolved,
  onSelect,
  onResolve
}: {
  comments: DesignNode[]
  pages: DesignPage[]
  activeId: string | null
  showResolved: boolean
  query: string
  onQuery: (value: string) => void
  onToggleResolved: () => void
  onSelect: (id: string) => void
  onResolve: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pageName = (id?: string) => pages.find((page) => page.id === id)?.name || 'Page 1'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return comments
      .filter((node) => !node.drafting)
      .filter((node) => (showResolved ? true : !node.resolved))
      .filter((node) => {
        if (!q) return true
        const blob = [
          String(node.commentNumber || ''),
          pageName(node.pageId),
          ...(node.messages || []).map((message) => message.text)
        ]
          .join(' ')
          .toLowerCase()
        return blob.includes(q)
      })
      .sort((a, b) => (b.messages?.[0]?.createdAt || 0) - (a.messages?.[0]?.createdAt || 0))
  }, [comments, pages, query, showResolved])

  return (
    <div className="comments-panel">
      <div className="comments-panel-head">
        <h3>Comments</h3>
      </div>
      <div className="comments-panel-tools">
        <div className="comments-search">
          <SearchIcon sx={{ fontSize: 16 }} />
          <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search" />
        </div>
        <button
          type="button"
          className={showResolved ? 'is-on' : ''}
          title={showResolved ? 'Hide resolved' : 'Show resolved'}
          onClick={onToggleResolved}
        >
          <FilterListIcon sx={{ fontSize: 18 }} />
        </button>
        <button type="button" title="More" onClick={() => setMenuOpen((open) => !open)}>
          <MoreHorizIcon sx={{ fontSize: 18 }} />
        </button>
        {menuOpen && (
          <div className="comments-panel-menu">
            <button
              type="button"
              onClick={() => {
                onToggleResolved()
                setMenuOpen(false)
              }}
            >
              {showResolved ? 'Hide resolved' : 'Show resolved'}
            </button>
          </div>
        )}
      </div>
      <div className="comments-list">
        {!filtered.length && <p className="comments-empty">No comments yet. Click the canvas to leave one.</p>}
        {filtered.map((node) => {
          const first = node.messages?.[0]
          const author = getCommentPerson(first?.authorId || 'user-jesse')
          return (
            <button
              key={node.id}
              type="button"
              className={`comments-item${activeId === node.id ? ' is-active' : ''}${node.resolved ? ' is-resolved' : ''}${node.unread ? ' is-unread' : ''}`}
              onClick={() => onSelect(node.id)}
            >
              <div className="comments-item-top">
                <span className="comment-person-avatar" style={{ background: author.color }}>
                  {author.initial}
                </span>
                <div className="comments-item-meta">
                  <div className="comments-item-line">
                    <strong>
                      #{node.commentNumber || 1} · {pageName(node.pageId)}
                    </strong>
                    {!node.resolved && (
                      <span
                        className="comments-resolve"
                        title="Resolve"
                        onClick={(event) => {
                          event.stopPropagation()
                          onResolve(node.id)
                        }}
                      >
                        <CheckIcon sx={{ fontSize: 16 }} />
                      </span>
                    )}
                  </div>
                  <div className="comments-item-sub">
                    <span>{author.name}</span>
                    <span>{first ? formatCommentTime(first.createdAt) : ''}</span>
                  </div>
                </div>
              </div>
              {first && (
                <div className="comments-item-text">
                  <CommentRichText text={first.text} />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

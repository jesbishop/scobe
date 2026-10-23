import { useEffect, useRef, useState } from 'react'
import { KeyboardArrowDownIcon, KeyboardArrowRightIcon } from './lucideIcons'
import type { FramePreset, FramePresetCategory } from '../shared/framePresets'

export function FramePresetsPanel({
  title,
  categories,
  defaultOpenId = 'phone',
  onSelect
}: {
  title: string
  categories: FramePresetCategory[]
  defaultOpenId?: string
  onSelect: (preset: FramePreset) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([defaultOpenId]))

  useEffect(() => {
    const scrollParent = rootRef.current?.closest('.props')
    if (scrollParent instanceof HTMLElement) scrollParent.scrollTop = 0
  }, [title])

  const toggle = (id: string) => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="frame-presets" ref={rootRef}>
      <div className="prop-node-title">{title}</div>
      {categories.map((category) => {
        const open = openIds.has(category.id)
        return (
          <section key={category.id} className="frame-preset-category">
            <button type="button" className="frame-preset-category-head" onClick={() => toggle(category.id)}>
              {open ? (
                <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
              ) : (
                <KeyboardArrowRightIcon sx={{ fontSize: 16 }} />
              )}
              <span>{category.label}</span>
            </button>
            {open && (
              <div className="frame-preset-list">
                {category.presets.map((preset) => (
                  <button
                    key={`${category.id}:${preset.name}`}
                    type="button"
                    className="frame-preset-item"
                    onClick={() => onSelect(preset)}
                  >
                    <span className="frame-preset-name">{preset.name}</span>
                    <span className="frame-preset-size">
                      {preset.width} × {preset.height}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

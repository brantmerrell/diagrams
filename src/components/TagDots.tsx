interface TagDotsProps {
  tags: string[]
  /** Render before the label (tree rows) rather than after it (search rows). */
  leading?: boolean
}

/**
 * Compact per-diagram quality-tag indicator shown beside diagram entries in the
 * navigator, so the tags a diagram carries are visible without opening it.
 */
const TagDots: React.FC<TagDotsProps> = ({ tags, leading }) => {
  if (tags.length === 0) return null
  return (
    <span className={`tag-dots${leading ? ' tag-dots--leading' : ''}`} title={tags.join(', ')}>
      {tags.map(t => (
        <span key={t} className={`tag-dot tag-dot--${t}`} aria-label={t} />
      ))}
    </span>
  )
}

export default TagDots

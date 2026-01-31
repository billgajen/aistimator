/**
 * Floating Button Component
 *
 * A floating action button that opens the widget modal.
 */

interface FloatingButtonProps {
  onClick: () => void
  label: string
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

export function FloatingButton({ onClick, label, position }: FloatingButtonProps) {
  const positionClasses: Record<string, string> = {
    'bottom-right': 'estimator-fab-br',
    'bottom-left': 'estimator-fab-bl',
    'top-right': 'estimator-fab-tr',
    'top-left': 'estimator-fab-tl',
  }

  return (
    <button
      className={`estimator-fab ${positionClasses[position] || positionClasses['bottom-right']}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="estimator-fab-icon">💬</span>
      <span className="estimator-fab-label">{label}</span>
    </button>
  )
}

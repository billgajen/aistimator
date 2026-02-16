import { useRef, useState, useCallback, useEffect } from 'react'

interface UseSortableOptions {
  onReorder: (fromIndex: number, toIndex: number) => void
  itemCount: number
}

/**
 * Lightweight drag-drop hook using HTML5 DnD (desktop) + pointer events (mobile).
 * No external dependencies.
 */
export function useSortable({ onReorder, itemCount }: UseSortableOptions) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // Pointer-based drag state for mobile
  const pointerState = useRef<{
    active: boolean
    startY: number
    currentY: number
    index: number
    itemHeight: number
    containerEl: HTMLElement | null
  } | null>(null)

  const rafRef = useRef<number>(0)

  // Clean up on unmount
  useEffect(() => {
    const ref = rafRef
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current)
    }
  }, [])

  /** HTML5 drag handlers (desktop) */
  const getDragHandleProps = useCallback(
    (index: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', String(index))
        setDragIndex(index)
      },
      onDragEnd: () => {
        setDragIndex(null)
        setOverIndex(null)
      },
    }),
    []
  )

  const getItemProps = useCallback(
    (index: number) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOverIndex(index)
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
        if (!isNaN(fromIndex) && fromIndex !== index) {
          onReorder(fromIndex, index)
        }
        setDragIndex(null)
        setOverIndex(null)
      },
      onDragLeave: () => {
        setOverIndex(null)
      },
      style: {
        opacity: dragIndex === index ? 0.4 : 1,
        transition: 'opacity 150ms',
      } as React.CSSProperties,
    }),
    [dragIndex, onReorder]
  )

  /** Pointer-based handlers (mobile touch) */
  const getPointerHandleProps = useCallback(
    (index: number) => ({
      onPointerDown: (e: React.PointerEvent) => {
        // Only handle primary pointer (finger/mouse)
        if (e.button !== 0) return
        const target = e.currentTarget as HTMLElement
        const container = target.closest('[data-sortable-container]') as HTMLElement
        if (!container) return

        const items = container.querySelectorAll('[data-sortable-item]')
        const itemEl = items[index] as HTMLElement
        if (!itemEl) return

        e.preventDefault()
        target.setPointerCapture(e.pointerId)

        pointerState.current = {
          active: true,
          startY: e.clientY,
          currentY: e.clientY,
          index,
          itemHeight: itemEl.offsetHeight,
          containerEl: container,
        }

        setDragIndex(index)
      },
      onPointerMove: (e: React.PointerEvent) => {
        const state = pointerState.current
        if (!state?.active) return

        state.currentY = e.clientY
        const delta = state.currentY - state.startY
        const moveCount = Math.round(delta / state.itemHeight)
        const newIndex = Math.max(0, Math.min(itemCount - 1, state.index + moveCount))
        setOverIndex(newIndex !== state.index ? newIndex : null)
      },
      onPointerUp: (e: React.PointerEvent) => {
        const state = pointerState.current
        if (!state?.active) return

        const delta = state.currentY - state.startY
        const moveCount = Math.round(delta / state.itemHeight)
        const toIndex = Math.max(0, Math.min(itemCount - 1, state.index + moveCount))

        if (toIndex !== state.index) {
          onReorder(state.index, toIndex)
        }

        pointerState.current = null
        setDragIndex(null)
        setOverIndex(null)
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      },
      onPointerCancel: (e: React.PointerEvent) => {
        pointerState.current = null
        setDragIndex(null)
        setOverIndex(null)
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      },
      style: {
        touchAction: 'none' as const,
        cursor: 'grab',
      },
    }),
    [itemCount, onReorder]
  )

  return {
    dragIndex,
    overIndex,
    getDragHandleProps,
    getItemProps,
    getPointerHandleProps,
  }
}

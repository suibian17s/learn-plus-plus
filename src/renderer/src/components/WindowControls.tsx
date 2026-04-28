import React, { useEffect, useRef } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { BorderOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons'

type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

interface WindowControlsProps {
  quitOnClose?: boolean
}

export default function WindowControls({ quitOnClose = false }: WindowControlsProps) {
  const closeTimer = useRef<number | null>(null)
  const lastClickRef = useRef(0)
  const controlsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    document.documentElement.classList.remove('lp2-window-closing')
    const offResume = window.learn.app.onResume(() => {
      document.documentElement.classList.remove('lp2-window-closing')
      closeTimer.current = null
    })
    return () => {
      offResume()
    }
  }, [])

  useEffect(() => {
    const root = controlsRef.current
    if (!root) return undefined

    const handleNativeMouseDown = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null
      const button = target?.closest<HTMLButtonElement>('[data-window-action]')
      if (!button) return
      event.preventDefault()
      event.stopPropagation()
      runAction(button.dataset.windowAction as WindowAction)
    }

    root.addEventListener('mousedown', handleNativeMouseDown, true)
    return () => {
      root.removeEventListener('mousedown', handleNativeMouseDown, true)
    }
  }, [quitOnClose])

  function runAction(action: WindowAction) {
    try {
      if (action === 'close') {
        if (closeTimer.current) return
        document.documentElement.classList.add('lp2-window-closing')
        closeTimer.current = window.setTimeout(() => {
          const closeTask = quitOnClose ? window.learn.app.quitWindow() : window.learn.app.closeWindow()
          Promise.resolve(closeTask).finally(() => {
            window.setTimeout(() => {
              document.documentElement.classList.remove('lp2-window-closing')
              closeTimer.current = null
            }, 260)
          })
        }, 220)
        return
      }

      if (action === 'minimize') {
        window.learn.app.minimizeWindow()
        return
      }

      window.learn.app.toggleMaximizeWindow()
    } catch {
      // Silently ignore errors from rapid clicks or destroyed windows
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>, action: WindowAction) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    runAction(action)
  }

  function handleMouseDown(event: MouseEvent<HTMLButtonElement>, action: WindowAction) {
    event.preventDefault()
    event.stopPropagation()
    runAction(action)
  }

  function createDebouncedClick(action: WindowAction) {
    return (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      const now = Date.now()
      if (now - lastClickRef.current < 200) return
      lastClickRef.current = now
      runAction(action)
    }
  }

  return (
    <div
      ref={controlsRef}
      className="lp2-window-controls"
      role="group"
      aria-label="Window controls"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        aria-label="Minimize"
        data-window-action="minimize"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onPointerDown={(event) => handlePointerDown(event, 'minimize')}
        onMouseDown={(event) => handleMouseDown(event, 'minimize')}
        onClick={createDebouncedClick('minimize')}
      >
        <MinusOutlined />
      </button>
      <button
        type="button"
        aria-label="Maximize or restore"
        data-window-action="toggle-maximize"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onPointerDown={(event) => handlePointerDown(event, 'toggle-maximize')}
        onMouseDown={(event) => handleMouseDown(event, 'toggle-maximize')}
        onClick={createDebouncedClick('toggle-maximize')}
      >
        <BorderOutlined />
      </button>
      <button
        type="button"
        aria-label="Close"
        className="close"
        data-window-action="close"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onPointerDown={(event) => handlePointerDown(event, 'close')}
        onMouseDown={(event) => handleMouseDown(event, 'close')}
        onClick={createDebouncedClick('close')}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}

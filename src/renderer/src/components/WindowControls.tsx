import type { MouseEvent, PointerEvent } from 'react'
import { useEffect, useRef } from 'react'
import { BorderOutlined, CloseOutlined, MinusOutlined } from '@ant-design/icons'

type WindowAction = 'minimize' | 'toggle-maximize' | 'close'

interface WindowControlsProps {
  quitOnClose?: boolean
}

export default function WindowControls({ quitOnClose = false }: WindowControlsProps) {
  const closeTimer = useRef<number | null>(null)
  const lastAction = useRef<{ action: WindowAction; time: number } | null>(null)
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
    const now = Date.now()
    if (lastAction.current && lastAction.current.action === action && now - lastAction.current.time < 260) {
      return
    }
    lastAction.current = { action, time: now }

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

  function suppressClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div ref={controlsRef} className="lp2-window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        aria-label="Minimize"
        data-window-action="minimize"
        onPointerDown={(event) => handlePointerDown(event, 'minimize')}
        onMouseDown={(event) => handleMouseDown(event, 'minimize')}
        onClick={suppressClick}
      >
        <MinusOutlined />
      </button>
      <button
        type="button"
        aria-label="Maximize or restore"
        data-window-action="toggle-maximize"
        onPointerDown={(event) => handlePointerDown(event, 'toggle-maximize')}
        onMouseDown={(event) => handleMouseDown(event, 'toggle-maximize')}
        onClick={suppressClick}
      >
        <BorderOutlined />
      </button>
      <button
        type="button"
        aria-label="Close"
        className="close"
        data-window-action="close"
        onPointerDown={(event) => handlePointerDown(event, 'close')}
        onMouseDown={(event) => handleMouseDown(event, 'close')}
        onClick={suppressClick}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}

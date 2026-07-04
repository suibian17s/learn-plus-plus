import { CloseOutlined, MinusOutlined, BorderOutlined } from '@ant-design/icons'

interface WindowControlsProps {
  quitOnClose?: boolean
}

export default function WindowControls({ quitOnClose = false }: WindowControlsProps) {
  function handleMinimize() {
    window.learn.app.controlWindow('minimize')
  }

  function handleToggleMaximize() {
    window.learn.app.controlWindow('toggle-maximize')
  }

  function handleClose() {
    if (quitOnClose) {
      window.learn.app.controlWindow('quit')
    } else {
      window.learn.app.controlWindow('close')
    }
  }

  return (
    <div className="lp2-window-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button type="button" aria-label="Minimize" onClick={handleMinimize}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <MinusOutlined />
      </button>
      <button type="button" aria-label="Maximize" onClick={handleToggleMaximize}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <BorderOutlined />
      </button>
      <button type="button" aria-label="Close" className="close" onClick={handleClose}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <CloseOutlined />
      </button>
    </div>
  )
}

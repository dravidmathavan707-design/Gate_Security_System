import { useEffect, useRef } from 'react'
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser'
import { Camera, ScanLine } from 'lucide-react'

interface QRScannerProps {
  onDetected: (value: string) => void
  onError: (message: string) => void
}

export function QRScanner({ onDetected, onError }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const onDetectedRef = useRef(onDetected)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onDetectedRef.current = onDetected
    onErrorRef.current = onError
  }, [onDetected, onError])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let isCancelled = false
    const reader = new BrowserQRCodeReader()

    reader.decodeFromVideoDevice(undefined, video, (result, _error, controls) => {
      if (controls && !controlsRef.current) controlsRef.current = controls
      if (!result) return
      controlsRef.current?.stop()
      onDetectedRef.current(result.getText())
    }).then((controls) => {
      if (isCancelled) controls.stop()
      else controlsRef.current = controls
    }).catch((error: unknown) => {
      if (!isCancelled) {
        const message = error instanceof Error ? error.message : 'Camera access is unavailable.'
        onErrorRef.current(message)
      }
    })

    return () => {
      isCancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [])

  return (
    <div className="scanner-wrap">
      <div className="scanner-view">
        <video ref={videoRef} muted autoPlay playsInline aria-label="Live QR scanner" />
        <div className="scanner-shade" />
        <div className="scan-frame" aria-hidden="true">
          <span className="frame-corner corner-top-left" />
          <span className="frame-corner corner-top-right" />
          <span className="frame-corner corner-bottom-left" />
          <span className="frame-corner corner-bottom-right" />
          <span className="scan-line" />
        </div>
        <div className="camera-label"><span className="camera-live-dot" /> LIVE CAMERA</div>
        <div className="scanner-center-icon"><ScanLine size={25} /></div>
        <div className="scanner-caption"><Camera size={14} /> Hold your QR steady in the frame</div>
      </div>
    </div>
  )
}

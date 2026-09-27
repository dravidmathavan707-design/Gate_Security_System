import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface DepartmentQrPreviewProps {
  value: string
  label: string
  size?: number
}

export function DepartmentQrPreview({ value, label, size = 140 }: DepartmentQrPreviewProps) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    let mounted = true

    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      type: 'image/png',
    })
      .then((url: string) => {
        if (mounted) setDataUrl(url)
      })
      .catch(() => {
        if (mounted) setDataUrl('')
      })

    return () => {
      mounted = false
    }
  }, [size, value])

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '12px',
      border: '1px solid #dfe7f1',
      background: '#ffffff',
      display: 'grid',
      placeItems: 'center',
      overflow: 'hidden',
      boxShadow: 'inset 0 0 0 1px rgba(148, 163, 184, 0.18)',
    }}>
      {dataUrl ? (
        <img src={dataUrl} alt={label} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '0.35rem' }} />
      ) : (
        <span style={{ fontSize: '0.68rem', letterSpacing: '0.08em', color: '#64748b', textTransform: 'uppercase' }}>QR</span>
      )}
    </div>
  )
}

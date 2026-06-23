import { useEffect, useRef } from 'react'

interface ToastProps {
  message: string
  onClose: () => void
  duration?: number
}

const Toast: React.FC<ToastProps> = ({ message, onClose, duration = 3000 }) => {
  // Keep a ref so the timer is not reset when the parent re-renders with a new onClose identity
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const timer = setTimeout(() => onCloseRef.current(), duration)
    return () => clearTimeout(timer)
  }, [duration])

  return (
    <div className="toast">
      {message}
    </div>
  )
}

export default Toast

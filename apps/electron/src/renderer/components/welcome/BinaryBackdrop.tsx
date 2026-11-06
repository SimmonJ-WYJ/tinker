/** 一次性字符水波：波前沿径向推动字符，波峰/波谷依次衰减。 */
import * as React from 'react'
export function BinaryBackdrop(): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [finished, setFinished] = React.useState(false)
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let width = 0, height = 0, frame = 0
    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect()
      width = bounds.width; height = bounds.height
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = width * ratio; canvas.height = height * ratio
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    const color = getComputedStyle(canvas).color
    const smoothstep = (start: number, end: number, value: number): number => {
      const t = Math.max(0, Math.min(1, (value - start) / (end - start)))
      return t * t * (3 - 2 * t)
    }
    const start = performance.now()
    const draw = (now: number): void => {
      const progress = Math.min((now - start) / 2800, 1)
      ctx.clearRect(0, 0, width, height)
      const cx = width * .5, cy = height * .36
      const reach = Math.hypot(width * .5, height * .64)
      // 起步保留推进速度，让点击立即可见；后半段继续平滑减速。
      const eased = progress ** 3 * (10 + progress * (-15 + 6 * progress))
      const travel = .42 * progress + .58 * eased
      const radius = -20 + (reach + 360) * travel
      const visibility = smoothstep(0, .035, progress) * (1 - smoothstep(.62, 1, progress))
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'; ctx.fillStyle = color
      for (let row = 0, y = 12; y < height; row++, y += 20) {
        for (let col = 0, x = 12; x < width; col++, x += 22) {
          const dx = x - cx, dy = y - cy
          const distance = Math.hypot(dx, dy)
          const behind = radius - distance
          if (behind < -180 || behind > 560) continue
          // 主波峰之后保留两道衰减的余波，字符随波沿径向往复位移。
          // 可见波前用连续门函数过渡；边界已接近透明才停止绘制。
          const envelope = Math.exp(-Math.pow((behind - 65) / 155, 2)) * smoothstep(-140, -15, behind)
          const wave = Math.sin(behind / 32)
          const displacement = wave * 8 * envelope * (1 - smoothstep(.3, 1, progress) * .6)
          const alpha = (.045 + .12 * (.5 + .5 * wave)) * envelope * visibility
          ctx.globalAlpha = alpha
          const unit = Math.max(distance, 1)
          const symbol = '01010101+/='[(row * 13 + col * 7 + col * row) % 11]
          ctx.fillText(symbol ?? '0', x + dx / unit * displacement, y + dy / unit * displacement)
        }
      }
      if (progress < 1) frame = requestAnimationFrame(draw)
      else setFinished(true)
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])
  if (finished) return <></>
  return <div className="binary-backdrop" aria-hidden="true" onAnimationEnd={(event) => { if (event.target === event.currentTarget) setFinished(true) }}><canvas ref={canvasRef} className="binary-backdrop__field" /></div>
}

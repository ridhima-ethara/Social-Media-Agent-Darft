/**
 * THE AGENT HOLOGRAM
 *
 * A wireframe icosahedron turning above a pool of light, drawn on a 2D canvas.
 *
 * Canvas rather than WebGL: the whole figure is a few dozen projected lines
 * and points, which 2D draws with no context to lose and nothing to fall back
 * from. It is decoration over live figures — `aria-hidden`, pointer-transparent
 * — and it stops dead under `prefers-reduced-motion`.
 *
 * `busy` is the platform's real state. The figure turns roughly twice as fast
 * while an agent is working and holds its resting speed otherwise, so the
 * motion reports rather than performs.
 */

import { useEffect, useRef } from 'react'

/** The twelve vertices of an icosahedron, on the unit sphere. */
function icosahedron(): { vertices: number[][]; edges: Array<[number, number]> } {
  const g = (1 + Math.sqrt(5)) / 2
  const norm = Math.hypot(1, g)
  const vertices = [
    [-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0],
    [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g],
    [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1],
  ].map((v) => v.map((c) => c / norm))
  const edges: Array<[number, number]> = []
  for (let i = 0; i < 12; i += 1) {
    for (let j = i + 1; j < 12; j += 1) {
      const a = vertices[i]!
      const b = vertices[j]!
      if (Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) < 1.2) edges.push([i, j])
    }
  }
  return { vertices, edges }
}

/** Motes inside the shell. Deterministic, so a re-render never moves them. */
function motes(count: number): number[][] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: count }, (_, i) => {
    const y = 1 - (i / (count - 1)) * 2
    const ring = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    const r = 0.42 + ((i * 29) % 26) / 100
    return [ring * Math.cos(theta) * r, y * r, ring * Math.sin(theta) * r, (i * 1.7) % 6.28]
  })
}

function rotate(v: number[], ax: number, ay: number): number[] {
  const cx = Math.cos(ax)
  const sx = Math.sin(ax)
  const cy = Math.cos(ay)
  const sy = Math.sin(ay)
  const [x = 0, y = 0, z = 0] = v
  const z1 = z * cx - y * sx
  const y1 = y * cx + z * sx
  return [x * cy + z1 * sy, y1, z1 * cy - x * sy]
}

export function AgentHologram({ busy, className = '' }: { busy: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /*
   * The draw loop reads `busy` from a ref so the effect never restarts — and
   * the ref is written in an effect, not during render, which is where
   * assigning to one is a side effect.
   */
  const busyRef = useRef(busy)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const { vertices, edges } = icosahedron()
    const particles = motes(40)
    let raf = 0
    let t = 0
    let last = 0
    let alive = true

    const draw = (ts: number): void => {
      if (!alive) return
      const ctx = canvas.getContext('2d')
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!ctx || w === 0 || h === 0) return

      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(w * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const dt = last > 0 ? Math.min((ts - last) / 1000, 0.05) : 0.016
      last = ts
      if (!reduced) t += dt * (busyRef.current ? 2.2 : 1)

      // The hologram's hue and the theme's own light level, from the tokens.
      const styles = getComputedStyle(document.documentElement)
      const hue = Number(styles.getPropertyValue('--holo-hue').trim() || 265)
      const light = document.documentElement.getAttribute('data-theme') === 'light'
      const colour = (l: number, a: number): string =>
        light
          ? `hsla(${hue}, 72%, ${Math.round(Math.min(l * 0.55, 56))}%, ${a * 0.85})`
          : `hsla(${hue}, 88%, ${l}%, ${a})`

      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'

      const R = Math.min(w * 0.2, h * 0.24)
      const cx = w / 2
      const cy0 = h * 0.42
      const cy = cy0 + Math.sin(t * 0.9) * 5
      const baseY = cy0 + R * 1.55

      // the pool of light the figure floats above
      const pool = ctx.createRadialGradient(cx, baseY, 0, cx, baseY, R * 1.6)
      pool.addColorStop(0, colour(60, 0.2))
      pool.addColorStop(0.45, colour(55, 0.09))
      pool.addColorStop(1, colour(50, 0))
      ctx.fillStyle = pool
      ctx.beginPath()
      ctx.ellipse(cx, baseY, R * 1.6, R * 0.44, 0, 0, Math.PI * 2)
      ctx.fill()

      // rings on the floor, and one travelling outward
      for (const [scale, alpha] of [[1.45, 0.18], [1.08, 0.3], [0.7, 0.45]] as const) {
        ctx.strokeStyle = colour(68, alpha)
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.ellipse(cx, baseY, R * scale, R * scale * 0.24, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      const pulse = (t * 0.45) % 1
      ctx.strokeStyle = colour(72, (1 - pulse) * 0.5)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.ellipse(cx, baseY, R * (0.6 + pulse * 1.05), R * (0.6 + pulse * 1.05) * 0.24, 0, 0, Math.PI * 2)
      ctx.stroke()

      // the outer orbit, with two arcs running around it
      ctx.strokeStyle = colour(70, 0.1)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy0, R * 1.85, 0, Math.PI * 2)
      ctx.stroke()
      const a0 = t * 0.5
      ctx.strokeStyle = colour(76, 0.5)
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(cx, cy0, R * 1.85, a0, a0 + 0.9)
      ctx.stroke()
      ctx.strokeStyle = colour(76, 0.25)
      ctx.beginPath()
      ctx.arc(cx, cy0, R * 1.85, a0 + Math.PI, a0 + 3.6)
      ctx.stroke()

      // two ellipses tilted around the shell
      ctx.strokeStyle = colour(70, 0.16)
      ctx.beginPath()
      ctx.ellipse(cx, cy, R * 1.4, R * 0.44, -0.3 + Math.sin(t * 0.3) * 0.06, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = colour(70, 0.1)
      ctx.beginPath()
      ctx.ellipse(cx, cy, R * 1.6, R * 0.52, 0.28, 0, Math.PI * 2)
      ctx.stroke()

      // the shell itself, projected
      const ay = t * 0.55
      const ax = 0.42 + Math.sin(t * 0.4) * 0.07
      const focal = 3.6
      const points = vertices.map((v) => {
        const r = rotate(v, ax, ay)
        const s = focal / (focal + (r[2] ?? 0))
        return [cx + (r[0] ?? 0) * R * s, cy + (r[1] ?? 0) * R * s, r[2] ?? 0]
      })

      for (const p of particles) {
        const r = rotate(p, ax, ay * 1.15)
        const s = focal / (focal + (r[2] ?? 0))
        const alpha = 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.4 + (p[3] ?? 0)))
        ctx.fillStyle = colour(82, alpha)
        ctx.beginPath()
        ctx.arc(cx + (r[0] ?? 0) * R * s, cy + (r[1] ?? 0) * R * s, Math.max((1.4 - (r[2] ?? 0)) * 0.7, 0.3), 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.lineCap = 'round'
      for (const [i, j] of edges) {
        const a = points[i]!
        const b = points[j]!
        const depth = (((a[2] ?? 0) + (b[2] ?? 0)) / 2 + 1) / 2
        const alpha = 0.8 - depth * 0.5
        ctx.strokeStyle = colour(70, alpha * 0.15)
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.moveTo(a[0]!, a[1]!)
        ctx.lineTo(b[0]!, b[1]!)
        ctx.stroke()
        ctx.strokeStyle = colour(76 - depth * 16, alpha)
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(a[0]!, a[1]!)
        ctx.lineTo(b[0]!, b[1]!)
        ctx.stroke()
      }

      for (const p of points) {
        const depth = ((p[2] ?? 0) + 1) / 2
        const r = 2.2 - depth * 1.2
        const glow = ctx.createRadialGradient(p[0]!, p[1]!, 0, p[0]!, p[1]!, r * 3)
        glow.addColorStop(0, colour(88, 0.85 - depth * 0.5))
        glow.addColorStop(1, colour(70, 0))
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p[0]!, p[1]!, r * 3, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.globalCompositeOperation = 'source-over'
    }

    const loop = (ts: number): void => {
      if (!alive) return
      draw(ts)
      // Still under reduced motion: one frame, then nothing.
      if (!reduced) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" className={`block h-full w-full ${className}`} style={{ pointerEvents: 'none' }} />
}

/**
 * THE AGENT HOLOGRAM
 *
 * A luminous core inside two counter-turning wireframe shells, floating above
 * a pool of light, drawn on a 2D canvas.
 *
 * Canvas rather than WebGL: the whole figure is a few dozen projected lines
 * and points, which 2D draws with no context to lose and nothing to fall back
 * from. It is decoration over live figures — `aria-hidden`, pointer-transparent
 * — and it stops dead under `prefers-reduced-motion`.
 *
 * `busy` is the platform's real state. While an agent is working the shells
 * turn faster, the core burns brighter and more sparks rise from the pool; at
 * rest it settles. The motion reports rather than performs.
 *
 * Every colour comes from two hue tokens, `--holo-hue` and `--holo-hue-2`, so
 * the figure follows the theme rather than carrying a palette of its own.
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

/**
 * Sparks that rise from the pool into the shell. Each is a phase, a lateral
 * offset and a speed, all derived from its index — nothing here is random, so
 * the same spark is always the same spark.
 */
function sparks(count: number): number[][] {
  return Array.from({ length: count }, (_, i) => [
    ((i * 0.618) % 1), // phase
    (((i * 37) % 19) / 9 - 1) * 0.95, // lateral offset, −0.95…0.95
    0.16 + ((i * 13) % 7) / 40, // speed
    ((i * 2.3) % 6.28), // wobble seed
  ])
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

/** A point on a tilted ellipse, for the satellites that ride the rings. */
function onEllipse(cx: number, cy: number, rx: number, ry: number, tilt: number, theta: number): [number, number] {
  const x = Math.cos(theta) * rx
  const y = Math.sin(theta) * ry
  return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]
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
    const embers = sparks(28)
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
      const working = busyRef.current
      if (!reduced) t += dt * (working ? 2.2 : 1)

      // Both hues and the theme's own light level, from the tokens.
      const styles = getComputedStyle(document.documentElement)
      const hue = Number(styles.getPropertyValue('--holo-hue').trim() || 265)
      const hue2 = Number(styles.getPropertyValue('--holo-hue-2').trim() || 300)
      const light = document.documentElement.getAttribute('data-theme') === 'light'
      const tint = (hh: number, l: number, a: number): string =>
        light
          ? `hsla(${hh}, 72%, ${Math.round(Math.min(l * 0.55, 56))}%, ${a * 0.85})`
          : `hsla(${hh}, 88%, ${l}%, ${a})`
      const colour = (l: number, a: number): string => tint(hue, l, a)
      const colour2 = (l: number, a: number): string => tint(hue2, l, a)

      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'

      const R = Math.min(w * 0.2, h * 0.24)
      const cx = w / 2
      const cy0 = h * 0.42
      const cy = cy0 + Math.sin(t * 0.9) * 5
      const baseY = cy0 + R * 1.55
      const heat = working ? 1.5 : 1

      // ── the pool of light the figure floats above ──────────────────────
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

      // ── sparks rising from the pool into the shell ─────────────────────
      const climb = baseY - (cy - R * 0.5)
      for (const [phase = 0, lateral = 0, speed = 0.2, wobble = 0] of embers) {
        const life = (t * speed + phase) % 1
        const x = cx + lateral * R * 1.3 * (1 - life * 0.4) + Math.sin(t * 2 + wobble * 7) * 3
        const y = baseY - life * climb
        const alpha = Math.sin(life * Math.PI) * 0.55 * heat
        const size = 0.7 + (1 - life) * 0.9
        ctx.fillStyle = life > 0.6 ? colour2(84, alpha) : colour(82, alpha)
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── the outer orbit, with two arcs running around it ───────────────
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
      ctx.strokeStyle = colour2(76, 0.3)
      ctx.beginPath()
      ctx.arc(cx, cy0, R * 1.85, a0 + Math.PI, a0 + 3.6)
      ctx.stroke()

      // ── two ellipses tilted around the shell, each carrying a satellite ─
      const rings = [
        { rx: R * 1.4, ry: R * 0.44, tilt: -0.3 + Math.sin(t * 0.3) * 0.06, alpha: 0.16, theta: t * 0.8, tone: colour },
        { rx: R * 1.6, ry: R * 0.52, tilt: 0.28, alpha: 0.1, theta: t * 0.55 + Math.PI, tone: colour2 },
      ]
      for (const ring of rings) {
        ctx.strokeStyle = ring.tone(70, ring.alpha)
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(cx, cy, ring.rx, ring.ry, ring.tilt, 0, Math.PI * 2)
        ctx.stroke()

        // the satellite's trail, fading behind it
        for (let k = 0; k < 10; k += 1) {
          const from = ring.theta - (k + 1) * 0.07
          const to = ring.theta - k * 0.07
          ctx.strokeStyle = ring.tone(82, (1 - k / 10) * 0.55)
          ctx.lineWidth = 2 - k * 0.15
          ctx.beginPath()
          ctx.ellipse(cx, cy, ring.rx, ring.ry, ring.tilt, from, to)
          ctx.stroke()
        }
        const [sx, sy] = onEllipse(cx, cy, ring.rx, ring.ry, ring.tilt, ring.theta)
        const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, 9)
        halo.addColorStop(0, ring.tone(92, 0.9))
        halo.addColorStop(0.35, ring.tone(80, 0.4))
        halo.addColorStop(1, ring.tone(70, 0))
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(sx, sy, 9, 0, Math.PI * 2)
        ctx.fill()
      }

      // ── the core, burning at the centre of everything ──────────────────
      const breathe = 1 + Math.sin(t * 1.6) * 0.08
      const coreR = R * 0.5 * breathe
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR)
      halo.addColorStop(0, colour2(85, 0.55 * heat))
      halo.addColorStop(0.3, colour(75, 0.32 * heat))
      halo.addColorStop(0.7, colour(65, 0.1 * heat))
      halo.addColorStop(1, colour(60, 0))
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
      ctx.fill()

      // A hot point, not a disc: white only at the very centre, falling into
      // the second hue within a few pixels so the core reads as a spark of
      // energy rather than a flat white circle.
      const nucleusR = R * 0.09 * (1 + Math.sin(t * 2.4) * 0.1)
      const nucleus = ctx.createRadialGradient(cx, cy, 0, cx, cy, nucleusR * 1.6)
      nucleus.addColorStop(0, light ? colour2(96, 0.95) : `hsla(${hue2}, 60%, 96%, 0.9)`)
      nucleus.addColorStop(0.22, colour2(88, 0.7 * heat))
      nucleus.addColorStop(0.6, colour2(80, 0.25 * heat))
      nucleus.addColorStop(1, colour2(80, 0))
      ctx.fillStyle = nucleus
      ctx.beginPath()
      ctx.arc(cx, cy, nucleusR * 1.6, 0, Math.PI * 2)
      ctx.fill()

      // ── the shells, projected ──────────────────────────────────────────
      const ay = t * 0.55
      const ax = 0.42 + Math.sin(t * 0.4) * 0.07
      const focal = 3.6
      const project = (v: number[], rx: number, ry: number, scale: number): number[] => {
        const r = rotate(v, rx, ry)
        const s = focal / (focal + (r[2] ?? 0) * scale)
        return [cx + (r[0] ?? 0) * R * scale * s, cy + (r[1] ?? 0) * R * scale * s, r[2] ?? 0]
      }
      const outer = vertices.map((v) => project(v, ax, ay, 1))
      const inner = vertices.map((v) => project(v, -ax * 0.8 + 0.6, -ay * 1.35, 0.5))

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

      // the inner shell, turning against the outer one, in the second hue
      for (const [i, j] of edges) {
        const a = inner[i]!
        const b = inner[j]!
        const depth = (((a[2] ?? 0) + (b[2] ?? 0)) / 2 + 1) / 2
        ctx.strokeStyle = colour2(78 - depth * 14, (0.55 - depth * 0.3) * heat)
        ctx.lineWidth = 0.9
        ctx.beginPath()
        ctx.moveTo(a[0]!, a[1]!)
        ctx.lineTo(b[0]!, b[1]!)
        ctx.stroke()
      }
      for (const p of inner) {
        ctx.fillStyle = colour2(90, 0.8 - (((p[2] ?? 0) + 1) / 2) * 0.5)
        ctx.beginPath()
        ctx.arc(p[0]!, p[1]!, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }

      // rays from the core to the vertices facing the viewer
      outer.forEach((p, i) => {
        const z = p[2] ?? 0
        if (z > -0.15) return
        const strength = (0.5 + 0.5 * Math.sin(t * 1.8 + i * 1.3)) * (-z) * 0.28 * heat
        const ray = ctx.createLinearGradient(cx, cy, p[0]!, p[1]!)
        ray.addColorStop(0, colour2(85, strength))
        ray.addColorStop(1, colour(80, 0))
        ctx.strokeStyle = ray
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(p[0]!, p[1]!)
        ctx.stroke()
      })

      // the outer shell: each edge twice, glow under line, faded by depth
      for (const [i, j] of edges) {
        const a = outer[i]!
        const b = outer[j]!
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

      // the vertices, glowing, each twinkling on its own beat
      outer.forEach((p, i) => {
        const depth = ((p[2] ?? 0) + 1) / 2
        const r = (2.2 - depth * 1.2) * (1 + 0.25 * Math.sin(t * 3 + i * 0.9))
        const glow = ctx.createRadialGradient(p[0]!, p[1]!, 0, p[0]!, p[1]!, r * 3)
        glow.addColorStop(0, colour(88, 0.85 - depth * 0.5))
        glow.addColorStop(1, colour(70, 0))
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(p[0]!, p[1]!, r * 3, 0, Math.PI * 2)
        ctx.fill()
      })

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

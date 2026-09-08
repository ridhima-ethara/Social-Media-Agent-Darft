/**
 * Application shell. Screens are components selected by `page` in the store —
 * there is no router library by design (Part 3).
 *
 * P0 scaffold: renders the themed shell so the phase gate can be verified.
 * P9/P10 replace the body with the full sixteen-screen switch.
 */
export default function App() {
  return (
    <div className="h-screen w-screen overflow-hidden bg-page text-ink flex items-center justify-center">
      <div className="text-center">
        <p className="text-ink-3 text-xs uppercase tracking-[0.28em] mb-3">Ethara SocialAI</p>
        <h1 className="display text-2xl">Twelve agents · one intelligence</h1>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import logoSvg from './assets/logo.svg'
import MainScreen from './components/MainScreen'

function App(): React.JSX.Element {
  const [modelReady, setModelReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  // Load the QVAC LLM once for the whole app.
  useEffect(() => {
    window.qvacAPI
      .loadModel()
      .then(() => setModelReady(true))
      .catch((err) => setModelError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800">
        <img src={logoSvg} alt="AirUI Logo" className="w-8 h-8" />
        <h1 className="text-lg font-semibold font-michroma tracking-wide">
          <span className="text-white">Air</span>
          <span className="text-brand">UI</span>
        </h1>
      </header>
      <MainScreen modelReady={modelReady} modelError={modelError} />
    </div>
  )
}

export default App

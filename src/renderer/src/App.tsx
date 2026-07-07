// import Versions from './components/Versions'
// import electronLogo from './assets/electron.svg'

// function App(): React.JSX.Element {
//   const ipcHandle = (): void => window.electron.ipcRenderer.send('ping')

//   return (
//     <>
//       <img alt="logo" className="logo" src={electronLogo} />
//       <div className="creator">Powered by electron-vite</div>
//       <div className="text">
//         Build an Electron app with <span className="react">React</span>
//         &nbsp;and <span className="ts">TypeScript</span>
//       </div>
//       <p className="tip">
//         Please try pressing <code>F12</code> to open the devTool
//       </p>
//       <div className="actions">
//         <div className="action">
//           <a href="https://electron-vite.org/" target="_blank" rel="noreferrer">
//             Documentation
//           </a>
//         </div>
//         <div className="action">
//           <a target="_blank" rel="noreferrer" onClick={ipcHandle}>
//             Send IPC
//           </a>
//         </div>
//       </div>
//       <Versions></Versions>
//     </>
//   )
// }

// export default App

// import { useState } from 'react'

// type Message = { role: 'user' | 'assistant'; content: string }

// function App(): React.JSX.Element {
//   const [loading, setLoading] = useState(false)
//   const [messages, setMessages] = useState<Message[]>([])
//   const [input, setInput] = useState('')

//   const handleSend = (): void => {
//     if (!input.trim()) return
//     setMessages((prev) => [
//       ...prev,
//       { role: 'user', content: input },
//       { role: 'assistant', content: 'Stub response from the assistant.' }
//     ])
//     setInput('')
//   }

//   return (
//     <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
//       {/* Header */}
//       <header className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800">
//         <h1 className="text-lg font-semibold">LLM Desktop App</h1>
//         <span className="ml-auto flex items-center gap-2 text-sm text-zinc-500">
//           <span
//             className={`inline-block w-2 h-2 rounded-full ${
//               loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
//             }`}
//           />
//           {loading ? 'Loading model…' : 'Ready'}
//         </span>
//       </header>

//       {/* Messages */}
//       <main className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
//         {loading ? (
//           <div className="flex-1 flex items-center justify-center h-full">
//             <div className="flex gap-1">
//               <span className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce [animation-delay:0ms]" />
//               <span className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce [animation-delay:150ms]" />
//               <span className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce [animation-delay:300ms]" />
//             </div>
//           </div>
//         ) : (
//           messages.map((msg, i) => (
//             <div
//               key={i}
//               className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
//             >
//               <div
//                 className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
//                   msg.role === 'user'
//                     ? 'bg-indigo-600 text-white rounded-br-md'
//                     : 'bg-zinc-800 text-zinc-100 rounded-bl-md'
//                 }`}
//               >
//                 {msg.content}
//               </div>
//             </div>
//           ))
//         )}
//       </main>

//       {/* Input */}
//       <div className="px-6 py-4 border-t border-zinc-800">
//         <div className="flex gap-3">
//           <textarea
//             className="flex-1 resize-none rounded-xl bg-zinc-800 px-4 py-3 text-sm outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-indigo-500/50"
//             rows={1}
//             placeholder="Type a message…"
//             value={input}
//             onChange={(e) => setInput(e.target.value)}
//             onKeyDown={(e) => {
//               if (e.key === 'Enter' && !e.shiftKey) {
//                 e.preventDefault()
//                 handleSend()
//               }
//             }}
//           />
//           <button
//             onClick={handleSend}
//             className="self-end rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
//           >
//             Send
//           </button>
//         </div>
//       </div>
//     </div>
//   )
// }

// export default App

import { useEffect, useState } from 'react'
import WebcamCapture from './components/WebcamCapture'
import HeadPointer from './components/HeadPointer'

type Mode = 'gestures' | 'head'

function App(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('head')
  const [modelReady, setModelReady] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)

  // Load the QVAC model once for the whole app — both modes share it.
  useEffect(() => {
    window.qvacAPI
      .loadModel()
      .then(() => setModelReady(true))
      .catch((err) => setModelError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800">
        <h1 className="text-lg font-semibold">QVAC Gazer</h1>
        <div className="flex gap-1 rounded-lg bg-zinc-900 p-1 text-sm">
          <button
            onClick={() => setMode('head')}
            className={`rounded-md px-3 py-1 ${mode === 'head' ? 'bg-indigo-600 text-white' : 'text-zinc-400'}`}
          >
            Head Pointer
          </button>
          <button
            onClick={() => setMode('gestures')}
            className={`rounded-md px-3 py-1 ${mode === 'gestures' ? 'bg-indigo-600 text-white' : 'text-zinc-400'}`}
          >
            Gestures
          </button>
        </div>
      </header>
      {mode === 'head' ? (
        <HeadPointer modelReady={modelReady} modelError={modelError} />
      ) : (
        <WebcamCapture modelReady={modelReady} modelError={modelError} />
      )}
    </div>
  )
}

export default App

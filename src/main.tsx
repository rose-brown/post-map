import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { StartGate } from './ui/StartGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartGate>
      <App />
    </StartGate>
  </StrictMode>,
)

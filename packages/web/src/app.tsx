import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { LoginPage } from './pages/login'
import { ChatPage } from './pages/chat'
import { LandingPage } from './pages/landing'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/:owner/:agent/*" element={<ChatPage />} />
      </Routes>
    </BrowserRouter>
  )
}

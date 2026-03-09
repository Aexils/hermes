import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import Session from './pages/Session'
import Stats from './pages/Stats'
import AudioPractice from './pages/AudioPractice'
import Admin from './pages/Admin'
import NotificationCenter from './components/NotificationCenter'
import { type ReactNode } from 'react'

// PageTransition must NOT call useLocation() internally.
// AnimatePresence keeps the exiting instance mounted — if it called useLocation(),
// the hook would update to the new route, changing the inner motion.div key,
// which resets the animation and breaks mode="wait" (exit never completes).
function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.99 }}
      transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {children}
    </motion.div>
  )
}

function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}

export default function App() {
  const location = useLocation()

  return (
    <>
      <Layout>
        <AnimatePresence mode="wait" initial={false}>
          <PageTransition key={location.pathname}>
            <Routes location={location}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/session" element={<Session />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/audio" element={<AudioPractice />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PageTransition>
        </AnimatePresence>
      </Layout>
      <NotificationCenter />
    </>
  )
}

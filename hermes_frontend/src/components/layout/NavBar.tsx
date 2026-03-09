import { Link, useLocation } from 'react-router-dom'
import { BookOpen, BarChart3, Zap, Settings, Headphones } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useSessionStore } from '../../store/sessionStore'

const NAV = [
  { to: '/', label: 'Learn', icon: BookOpen },
  { to: '/stats', label: 'Stats', icon: BarChart3 },
  { to: '/audio', label: 'Audio', icon: Headphones },
  { to: '/admin', label: 'Admin', icon: Settings },
]

export default function NavBar() {
  const { pathname } = useLocation()
  const { sessionActive, currentIndex, exercises } = useSessionStore()

  return (
    <nav className="sticky top-0 z-50 glass-strong border-b border-white/[0.06]">
      <div className="container mx-auto max-w-4xl px-5 sm:px-8 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
            <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-bold text-sm tracking-tight text-gradient">HERMES</span>
        </Link>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || (to === '/' && pathname === '/session')
            const isLearn = to === '/'
            const showSessionDot = isLearn && sessionActive && exercises.length > 0

            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                  active
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}

                {showSessionDot && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </span>
                )}

                {isLearn && sessionActive && exercises.length > 0 && pathname !== '/session' && (
                  <span className="ml-0.5 px-1 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/25 tabular-nums">
                    {currentIndex}/{exercises.length}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

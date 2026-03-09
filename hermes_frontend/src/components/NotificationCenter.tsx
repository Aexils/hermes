import { AnimatePresence, motion } from 'framer-motion'
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useNotificationStore } from '../store/notificationStore'
import { cn } from '../lib/cn'

export default function NotificationCenter() {
  const { items, dismiss } = useNotificationStore()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence initial={false}>
        {items.map((n) => (
          <motion.div
            key={n.id}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className={cn(
              'pointer-events-auto w-72 rounded-xl border backdrop-blur-xl shadow-xl overflow-hidden',
              n.status === 'loading' && 'bg-[#1a1a2e]/90 border-violet-500/20',
              n.status === 'success' && 'bg-[#0d1f16]/90 border-emerald-500/25',
              n.status === 'error'   && 'bg-[#1f0d0d]/90 border-red-500/25',
            )}
          >
            {/* Progress bar */}
            <div className="h-0.5 bg-white/5 relative">
              {n.status === 'loading' && (
                n.progress === null ? (
                  // Indeterminate — sweep animation
                  <motion.div
                    className="absolute inset-y-0 w-1/3 bg-violet-500/70 rounded-full"
                    animate={{ x: ['0%', '300%'] }}
                    transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
                  />
                ) : (
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-violet-500/70"
                    animate={{ width: `${n.progress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                )
              )}
              {n.status === 'success' && (
                <div className="absolute inset-y-0 left-0 right-0 bg-emerald-500/50" />
              )}
              {n.status === 'error' && (
                <div className="absolute inset-y-0 left-0 right-0 bg-red-500/50" />
              )}
            </div>

            <div className="px-3.5 py-2.5 flex items-start gap-2.5">
              {/* Icon */}
              <div className="mt-0.5 shrink-0">
                {n.status === 'loading' && (
                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                )}
                {n.status === 'success' && (
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                )}
                {n.status === 'error' && (
                  <AlertCircle className="w-4 h-4 text-red-400" />
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-xs font-semibold leading-tight',
                  n.status === 'loading' && 'text-slate-200',
                  n.status === 'success' && 'text-emerald-300',
                  n.status === 'error'   && 'text-red-300',
                )}>
                  {n.title}
                </p>
                {n.detail && (
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{n.detail}</p>
                )}
                {n.status === 'loading' && n.progress !== null && (
                  <p className="text-[10px] text-violet-400/70 mt-1 font-mono">{n.progress}%</p>
                )}
              </div>

              {/* Close */}
              <button
                onClick={() => dismiss(n.id)}
                className="mt-0.5 shrink-0 text-slate-600 hover:text-slate-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

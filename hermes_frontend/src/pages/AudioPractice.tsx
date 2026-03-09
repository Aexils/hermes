import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Headphones, Mic, ChevronDown } from 'lucide-react'
import { api } from '../api/client'
import DictationPractice from '../components/DictationPractice'
import PronunciationPractice from '../components/PronunciationPractice'
import { cn } from '../lib/cn'
import type { Book } from '../api/types'

type Tab = 'dictation' | 'pronunciation'

export default function AudioPractice() {
  const [tab, setTab] = useState<Tab>('dictation')
  const [selectedBookId, setSelectedBookId] = useState<number | null>(null)

  const { data: books, isLoading } = useQuery<Book[]>({
    queryKey: ['books'],
    queryFn: api.getBooks,
  })

  const transcribedBooks = books?.filter((b) => b.transcribed) ?? []
  const activeBookId = selectedBookId ?? transcribedBooks[0]?.id ?? null

  if (isLoading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-teal-500/40 border-t-teal-400 rounded-full animate-spin" />
    </div>
  )

  if (transcribedBooks.length === 0) return (
    <div className="glass rounded-2xl p-10 text-center space-y-3">
      <Headphones className="w-10 h-10 text-teal-500/30 mx-auto" />
      <div>
        <p className="font-semibold text-slate-300">No transcribed books yet</p>
        <p className="text-sm text-slate-500 mt-1">
          Sync Audiobookshelf then start transcription from the Admin panel.
        </p>
      </div>
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Audio Practice</h1>
        <p className="text-sm text-slate-400 mt-0.5">Train your ear and voice with real book passages</p>
      </div>

      {/* Book selector (only if multiple transcribed books) */}
      {transcribedBooks.length > 1 && (
        <div className="relative">
          <select
            value={activeBookId ?? ''}
            onChange={(e) => setSelectedBookId(Number(e.target.value))}
            className="w-full glass border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-slate-200 appearance-none outline-none focus:border-violet-500/40 bg-transparent pr-8"
          >
            {transcribedBooks.map((b) => (
              <option key={b.id} value={b.id} className="bg-[#12121f]">{b.title}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        </div>
      )}

      {transcribedBooks.length === 1 && (
        <div className="glass rounded-xl px-4 py-2.5 border border-teal-500/15">
          <p className="text-xs text-teal-400/60 font-semibold uppercase tracking-wider">Book</p>
          <p className="text-sm text-slate-200 mt-0.5">{transcribedBooks[0].title}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 glass rounded-xl p-1 border border-white/[0.06]">
        <TabButton active={tab === 'dictation'} onClick={() => setTab('dictation')}>
          <Headphones className="w-3.5 h-3.5" /> Dictation
        </TabButton>
        <TabButton active={tab === 'pronunciation'} onClick={() => setTab('pronunciation')}>
          <Mic className="w-3.5 h-3.5" /> Pronunciation
        </TabButton>
      </div>

      {/* Content */}
      {activeBookId && (
        <motion.div
          key={`${tab}-${activeBookId}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'dictation'
            ? <DictationPractice bookId={activeBookId} />
            : <PronunciationPractice bookId={activeBookId} />
          }
        </motion.div>
      )}
    </motion.div>
  )
}

function TabButton({ active, onClick, children }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all duration-200',
        active
          ? 'bg-teal-600/20 text-teal-300 border border-teal-500/30'
          : 'text-slate-400 hover:text-slate-200',
      )}
    >
      {children}
    </button>
  )
}

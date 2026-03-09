import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BookOpen, Zap, RefreshCw, ChevronRight,
  TrendingUp, Target, Flame, Headphones,
  Sparkles, SlidersHorizontal, Plus, Minus, BookMarked,
  Play,
} from 'lucide-react'
import { api } from '../api/client'
import { useSessionStore } from '../store/sessionStore'
import { getCEFRConfig } from '../lib/cefr'
import { cn } from '../lib/cn'
import type { UserStats, SystemStatus, Book, Chapter } from '../api/types'
import { useNotify } from '../store/notificationStore'

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.4, ease: 'easeOut' },
  }),
}

type PickerMode = null | 'auto' | 'custom'
type CustomStep = 'book' | 'chapter' | 'counts'

interface SessionCounts {
  grammar: number
  vocabulary: number
  comprehension: number
}

export default function Dashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const parsingRef = useRef<{ title: string; notifId: string }[]>([])

  // Study picker state
  const [pickerMode, setPickerMode] = useState<PickerMode>(null)
  const [customStep, setCustomStep] = useState<CustomStep>('book')
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)
  const [counts, setCounts] = useState<SessionCounts>({ grammar: 5, vocabulary: 8, comprehension: 5 })

  const { sessionActive, batchId: storedBatchId, currentIndex, exercises } = useSessionStore()

  const { data: stats } = useQuery<UserStats>({
    queryKey: ['stats'],
    queryFn: api.getStats,
  })

  const { data: systemStatus } = useQuery<SystemStatus>({
    queryKey: ['status'],
    queryFn: api.getStatus,
    staleTime: 1000 * 30,
    retry: false,
  })

  const { data: books = [], isLoading: booksLoading } = useQuery<Book[]>({
    queryKey: ['books'],
    queryFn: api.getBooks,
    enabled: pickerMode === 'custom',
  })

  const { data: chapters = [], isLoading: chaptersLoading } = useQuery<Chapter[]>({
    queryKey: ['chapters', selectedBook?.id],
    queryFn: () => api.getBookChapters(selectedBook!.id),
    enabled: !!selectedBook && customStep === 'chapter',
  })

  const parsedBooks = books.filter((b) => b.parsed)

  const absNotifId = useRef('')
  const absSyncMutation = useMutation({
    mutationFn: () => {
      absNotifId.current = notify.loading('Syncing Audiobookshelf…', 'Fetching your audiobook library')
      return api.syncAudiobookshelf()
    },
    onSuccess: (data) => {
      if (data.found > 0) {
        notify.success(absNotifId.current, 'Audiobooks synced',
          `${data.found} found · ${data.new} new · ${data.updated} updated`)
      } else {
        notify.error(absNotifId.current, 'No audiobooks found', 'Check that Audiobookshelf is running')
      }
    },
    onError: (e: Error) => {
      notify.error(absNotifId.current, 'Audiobookshelf unreachable', e.message)
    },
  })

  const bookloreNotifId = useRef('')
  const syncMutation = useMutation({
    mutationFn: () => {
      bookloreNotifId.current = notify.loading('Syncing Booklore…', 'Checking your reading progress')
      return api.syncBooklore()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['stats'] })
      if (data.parsing_books.length > 0) {
        notify.success(bookloreNotifId.current, 'Booklore synced',
          `Parsing ${data.parsing_books.length} book(s)…`)
        data.parsing_books.forEach((title) => {
          const pid = notify.loading(`Parsing "${title}"`, 'Extracting chapters and sentences…')
          parsingRef.current.push({ title, notifId: pid })
        })
      } else if (data.new_chapters_detected > 0) {
        notify.success(bookloreNotifId.current, 'Booklore synced',
          `${data.new_chapters_detected} new chapter(s) detected`)
      } else {
        notify.success(bookloreNotifId.current, 'Booklore synced', 'Already up to date')
      }
    },
    onError: (e: Error) => {
      notify.error(bookloreNotifId.current, 'Booklore unreachable', e.message)
    },
  })

  useEffect(() => {
    if (parsingRef.current.length === 0) return
    const interval = setInterval(async () => {
      if (parsingRef.current.length === 0) { clearInterval(interval); return }
      try {
        const bks = await api.getBooks()
        parsingRef.current = parsingRef.current.filter(({ title, notifId }) => {
          const book = bks.find(
            (b) => b.title.toLowerCase().includes(title.toLowerCase().slice(0, 20))
          )
          if (book?.parsed) {
            notify.success(notifId, `"${title}" ready`, 'Chapters extracted — ready to generate a session')
            queryClient.invalidateQueries({ queryKey: ['books'] })
            return false
          }
          return true
        })
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncMutation.isSuccess])

  const canResume = sessionActive && exercises.length > 0 && currentIndex < exercises.length

  const cefr = getCEFRConfig(stats?.cefr_level ?? 'B1')
  const grammarScores = Object.values(stats?.grammar_scores ?? {})
  const grammarAvg = grammarScores.length
    ? grammarScores.reduce((a, b) => a + b, 0) / grammarScores.length
    : 0
  const accuracy = Math.round(grammarAvg * 100)

  function handleAutoStart() {
    navigate('/session')
  }

  function handleCustomGenerate() {
    if (!selectedBook) return
    const params: Record<string, unknown> = {
      book_id: selectedBook.id,
      scope: 'chapter',
      grammar_count: counts.grammar,
      vocab_count: counts.vocabulary,
      comprehension_count: counts.comprehension,
    }
    if (selectedChapter) params.chapter_id = selectedChapter.id
    navigate('/session', { state: { sessionParams: params } })
  }

  function resetPicker() {
    setPickerMode(null)
    setCustomStep('book')
    setSelectedBook(null)
    setSelectedChapter(null)
    setCounts({ grammar: 5, vocabulary: 8, comprehension: 5 })
  }

  function adjustCount(key: keyof SessionCounts, delta: number) {
    const limits = { grammar: [0, 10], vocabulary: [0, 10], comprehension: [0, 7] }
    setCounts((prev) => ({
      ...prev,
      [key]: Math.max(limits[key][0], Math.min(limits[key][1], prev[key] + delta)),
    }))
  }

  return (
    <motion.div initial="hidden" animate="visible" className="space-y-4">
      {/* Header */}
      <motion.div custom={0} variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {getGreeting()},{' '}
            <span className="text-gradient">{stats?.username ?? '…'}</span>
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Ready to level up your English?</p>
        </div>
        <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold', cefr.bg, cefr.color)}>
          {cefr.emoji} {stats?.cefr_level ?? '…'}
        </div>
      </motion.div>

      {/* Study Picker */}
      <motion.div custom={1} variants={fadeUp}>
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-5 pt-5 pb-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Today's session</p>

            {/* Resume banner */}
            {canResume && (
              <motion.button
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => navigate('/session')}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.97 }}
                className="w-full mb-3 flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 hover:bg-emerald-500/12 transition-all duration-200"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <Play className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-semibold text-emerald-300">Resume session</p>
                  <p className="text-xs text-slate-500 mt-0.5">{currentIndex}/{exercises.length} exercises completed</p>
                </div>
                <ChevronRight className="w-4 h-4 text-emerald-500/50" />
              </motion.button>
            )}

            {/* Mode selector */}
            <AnimatePresence mode="wait">
              {pickerMode === null && (
                <motion.div
                  key="mode-select"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-2.5 pb-4"
                >
                  {/* Auto */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleAutoStart}
                    className="w-full flex items-start gap-4 px-4 py-4 rounded-xl border border-violet-500/25 bg-violet-500/8 hover:bg-violet-500/14 hover:border-violet-500/40 transition-all duration-200 text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-purple-500 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-4.5 h-4.5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-100">Automatic</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Based on your reading progress — current chapter, adaptive mix targeting your weak spots
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 mt-2.5" />
                  </motion.button>

                  {/* Custom */}
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setPickerMode('custom')}
                    className="w-full flex items-start gap-4 px-4 py-4 rounded-xl border border-white/[0.06] hover:border-violet-500/25 hover:bg-white/[0.03] transition-all duration-200 text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center shrink-0 mt-0.5">
                      <SlidersHorizontal className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-300">Custom</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Choose the book, chapter and number of exercises per type
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 mt-2.5" />
                  </motion.button>
                </motion.div>
              )}

              {pickerMode === 'custom' && (
                <motion.div
                  key="custom"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="pb-4"
                >
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-1.5 mb-4">
                    <button
                      onClick={resetPicker}
                      className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
                    >
                      Session
                    </button>
                    <ChevronRight className="w-2.5 h-2.5 text-slate-700" />
                    {(['book', 'chapter', 'counts'] as CustomStep[]).map((s, i) => {
                      const labels = { book: 'Book', chapter: 'Chapter', counts: 'Exercises' }
                      const reached = ['book', 'chapter', 'counts'].indexOf(customStep) >= i
                      return (
                        <span key={s} className="flex items-center gap-1.5">
                          <span className={cn(
                            'text-[10px] font-semibold uppercase tracking-wider',
                            customStep === s ? 'text-violet-400' : reached ? 'text-slate-500' : 'text-slate-700'
                          )}>
                            {labels[s]}
                          </span>
                          {i < 2 && <ChevronRight className="w-2.5 h-2.5 text-slate-700" />}
                        </span>
                      )
                    })}
                  </div>

                  {/* Step: Book */}
                  {customStep === 'book' && (
                    <BookPickerStep
                      books={parsedBooks}
                      loading={booksLoading}
                      systemStatus={systemStatus}
                      onSelect={(book) => { setSelectedBook(book); setCustomStep('chapter') }}
                    />
                  )}

                  {/* Step: Chapter */}
                  {customStep === 'chapter' && selectedBook && (
                    <ChapterPickerStep
                      book={selectedBook}
                      chapters={chapters}
                      loading={chaptersLoading}
                      selected={selectedChapter}
                      onSelect={setSelectedChapter}
                      onNext={() => setCustomStep('counts')}
                      onBack={() => setCustomStep('book')}
                    />
                  )}

                  {/* Step: Counts */}
                  {customStep === 'counts' && (
                    <CountsStep
                      book={selectedBook}
                      chapter={selectedChapter}
                      counts={counts}
                      onAdjust={adjustCount}
                      onGenerate={handleCustomGenerate}
                      onBack={() => setCustomStep('chapter')}
                    />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* Stats row */}
      {stats && (
        <motion.div custom={2} variants={fadeUp} className="grid grid-cols-3 gap-3">
          <StatCard
            icon={<Flame className="w-5 h-5 text-orange-400" />}
            value={Object.keys(stats.vocabulary_mastery).length}
            label="Words"
            sub="in vocabulary"
            bg="bg-orange-500/10"
            color="text-orange-300"
          />
          <StatCard
            icon={<TrendingUp className="w-5 h-5 text-blue-400" />}
            value={`${accuracy}%`}
            label="Grammar"
            sub="average score"
            bg="bg-blue-500/10"
            color="text-blue-300"
          />
          <StatCard
            icon={<Target className="w-5 h-5 text-violet-400" />}
            value={Object.keys(stats.grammar_scores).length}
            label="Topics"
            sub="practiced"
            bg="bg-violet-500/10"
            color="text-violet-300"
          />
        </motion.div>
      )}

      {/* Sync */}
      <motion.div custom={4} variants={fadeUp} className="space-y-2">
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="w-full glass border border-white/[0.06] rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-200 hover:border-violet-500/30 transition-all duration-200 disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', syncMutation.isPending && 'animate-spin')} />
          {syncMutation.isPending ? 'Syncing Booklore…' : 'Sync reading progress'}
        </button>

        <button
          onClick={() => absSyncMutation.mutate()}
          disabled={absSyncMutation.isPending}
          className="w-full glass border border-white/[0.06] rounded-xl px-4 py-3 flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-200 hover:border-teal-500/30 transition-all duration-200 disabled:opacity-60"
        >
          <Headphones className={cn('w-4 h-4 text-teal-500', absSyncMutation.isPending && 'animate-pulse')} />
          {absSyncMutation.isPending ? 'Syncing audiobooks…' : 'Sync Audiobookshelf'}
        </button>
      </motion.div>
    </motion.div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function BookPickerStep({ books, loading, systemStatus, onSelect }: {
  books: Book[]
  loading: boolean
  systemStatus?: SystemStatus
  onSelect: (b: Book) => void
}) {
  if (loading) return <ListSkeleton />
  if (books.length === 0) {
    return (
      <div className="py-4 space-y-3">
        <div className="flex items-center gap-2 text-slate-500">
          <BookOpen className="w-4 h-4" />
          <p className="text-sm">No parsed books yet</p>
        </div>
        {systemStatus && (
          <div className="space-y-2">
            {[
              { done: !!systemStatus.user, label: 'Account ready', hint: systemStatus.user ? `${systemStatus.user.username} · ${systemStatus.user.cefr}` : 'Auto-created on startup' },
              { done: systemStatus.books.parsed > 0, label: 'Book parsed', hint: systemStatus.books.total > 0 ? `${systemStatus.books.total} book(s) found` : 'Sync Booklore to import your book' },
            ].map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className={cn('mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold', s.done ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-600')}>
                  {s.done ? '✓' : i + 1}
                </div>
                <div>
                  <p className={cn('text-xs font-medium', s.done ? 'text-emerald-400' : 'text-slate-400')}>{s.label}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">{s.hint}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500 mb-3">Select a book</p>
      {books.map((book) => (
        <motion.button
          key={book.id}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect(book)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-150 text-left"
        >
          <BookOpen className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{book.title}</p>
            {book.author && <p className="text-xs text-slate-500 truncate">{book.author}</p>}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        </motion.button>
      ))}
    </div>
  )
}

function ChapterPickerStep({ book, chapters, loading, selected, onSelect, onNext, onBack }: {
  book: Book
  chapters: Chapter[]
  loading: boolean
  selected: Chapter | null
  onSelect: (c: Chapter) => void
  onNext: () => void
  onBack: () => void
}) {
  if (loading) return <ListSkeleton />
  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        <span className="text-slate-300 font-medium">{book.title}</span> — select a chapter
      </p>
      <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1 mb-3">
        {chapters.map((ch) => (
          <motion.button
            key={ch.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(ch)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all duration-150',
              selected?.id === ch.id
                ? 'border-violet-500/50 bg-violet-500/10'
                : 'border-white/[0.06] hover:border-violet-500/20 hover:bg-violet-500/5'
            )}
          >
            <span className={cn('text-xs font-mono shrink-0 w-6 text-center', selected?.id === ch.id ? 'text-violet-400' : 'text-slate-600')}>
              {ch.order_index + 1}
            </span>
            <span className="text-sm text-slate-200 truncate">{ch.title || `Chapter ${ch.order_index + 1}`}</span>
          </motion.button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onBack} className="px-4 py-2.5 rounded-xl text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
          Back
        </button>
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.97 }}
          onClick={onNext}
          disabled={!selected}
          className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
        >
          Next <ChevronRight className="w-4 h-4" />
        </motion.button>
      </div>
    </div>
  )
}

function CountsStep({ book, chapter, counts, onAdjust, onGenerate, onBack }: {
  book: Book | null
  chapter: Chapter | null
  counts: SessionCounts
  onAdjust: (key: keyof SessionCounts, delta: number) => void
  onGenerate: () => void
  onBack: () => void
}) {
  const totalExercises = counts.grammar + counts.vocabulary + counts.comprehension

  const rows: { key: keyof SessionCounts; label: string; max: number; color: string }[] = [
    { key: 'comprehension', label: 'Comprehension', max: 7, color: 'text-blue-300' },
    { key: 'grammar', label: 'Grammar', max: 10, color: 'text-purple-300' },
    { key: 'vocabulary', label: 'Vocabulary', max: 10, color: 'text-amber-300' },
  ]

  return (
    <div>
      {(book || chapter) && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <BookMarked className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-slate-300 truncate">{book?.title}</p>
            {chapter && <p className="text-[11px] text-slate-500 truncate">{chapter.title || `Chapter ${chapter.order_index + 1}`}</p>}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500 mb-3">Exercises per type</p>

      <div className="space-y-3 mb-4">
        {rows.map(({ key, label, max, color }) => (
          <div key={key} className="flex items-center gap-3">
            <span className={cn('text-xs font-medium w-28 shrink-0', color)}>{label}</span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => onAdjust(key, -1)}
                disabled={counts[key] === 0}
                className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-6 text-center text-sm font-semibold tabular-nums text-slate-200">
                {counts[key]}
              </span>
              <button
                onClick={() => onAdjust(key, 1)}
                disabled={counts[key] === max}
                className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 mb-4 px-1">
        <span>Total</span>
        <span className="font-semibold text-slate-300">{totalExercises} exercise{totalExercises !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex gap-2">
        <button onClick={onBack} className="px-4 py-2.5 rounded-xl text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
          Back
        </button>
        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.97 }}
          onClick={onGenerate}
          disabled={totalExercises === 0}
          className="flex-1 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed glow-purple hover:from-violet-500 hover:to-purple-500 transition-all duration-200"
        >
          <Zap className="w-4 h-4" />
          Generate session
        </motion.button>
      </div>
    </div>
  )
}

function StatCard({ icon, value, label, sub, bg, color }: {
  icon: React.ReactNode; value: string | number; label: string; sub: string; bg: string; color: string
}) {
  return (
    <div className="glass rounded-xl p-3.5 flex flex-col gap-2.5 hover:border-white/[0.1] transition-colors">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', bg)}>{icon}</div>
      <div>
        <div className={cn('text-xl font-bold tabular-nums', color)}>{value}</div>
        <div className="text-xs font-medium text-slate-300 mt-0.5">{label}</div>
        <div className="text-[10px] text-slate-600">{sub}</div>
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded-xl bg-white/[0.04]" />
      ))}
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

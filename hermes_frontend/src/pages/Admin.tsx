import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Settings, Trash2, Zap, BookOpen, Layers, Brain, RotateCcw, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'
import type { AdminBatch } from '../api/types'
import { useNotify } from '../store/notificationStore'
import { useSessionStore } from '../store/sessionStore'
import { CEFR_LEVELS } from '../lib/cefr'
import { cn } from '../lib/cn'
import AdminDB from '../components/admin/AdminDB'

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.4, ease: 'easeOut' },
  }),
}

// ── Batch type badge ──────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; cls: string }> = {
  chapter:        { label: 'Chapter',        cls: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  book_progress:  { label: 'Book Progress',  cls: 'bg-violet-500/15 text-violet-300 border-violet-500/25' },
  grammar_drill:  { label: 'Grammar Drill',  cls: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
  vocab_flashcard:{ label: 'Vocab',          cls: 'bg-teal-500/15 text-teal-300 border-teal-500/25' },
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? { label: type, cls: 'bg-slate-500/15 text-slate-300 border-slate-500/25' }
  return (
    <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium border', cfg.cls)}>
      {cfg.label}
    </span>
  )
}

// ── Grammar focus options ─────────────────────────────────────────────────────
const GRAMMAR_FOCUSES = [
  'present_simple', 'present_continuous', 'present_perfect', 'present_perfect_continuous',
  'past_simple', 'past_continuous', 'past_perfect', 'past_perfect_continuous',
  'future_simple', 'future_continuous', 'conditionals', 'passive_voice',
  'reported_speech', 'modal_verbs', 'articles', 'prepositions',
]

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number | string; icon: React.ElementType; color: string
}) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-widest">{label}</p>
        <p className="text-xl font-bold text-slate-100">{value}</p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Admin() {
  const notify = useNotify()
  const queryClient = useQueryClient()
  const resetSession = useSessionStore((s) => s.resetSession)

  const [showResetDialog, setShowResetDialog] = useState(false)
  const [resetUsername, setResetUsername] = useState('alexi')
  const [resetCefr, setResetCefr] = useState('B1')
  const [resetting, setResetting] = useState(false)

  function handleClearSession() {
    resetSession()
    notify.success('', 'Session cache cleared', 'The resume banner will no longer appear')
  }

  async function handleResetDb() {
    setResetting(true)
    const nid = notify.loading('Resetting database…', 'Truncating all tables and resetting sequences')
    try {
      const result = await api.resetDb(resetUsername, resetCefr)
      resetSession()
      queryClient.clear()
      notify.success(nid, 'Database reset', `User "${result.username}" created with id=${result.user_id}`)
      setShowResetDialog(false)
    } catch (e: unknown) {
      notify.error(nid, 'Reset failed', e instanceof Error ? e.message : String(e))
    } finally {
      setResetting(false)
    }
  }

  const { data: overview } = useQuery({ queryKey: ['admin-overview'], queryFn: api.getAdminOverview })
  const { data: batches, isLoading } = useQuery({ queryKey: ['admin-batches'], queryFn: api.getAdminBatches })
  const { data: books } = useQuery({ queryKey: ['books'], queryFn: api.getBooks })

  // Form state
  const [batchType, setBatchType] = useState('grammar_drill')
  const [grammarFocus, setGrammarFocus] = useState('past_perfect')
  const [selectedBook, setSelectedBook] = useState<number | null>(null)
  const [selectedChapters, setSelectedChapters] = useState<number[]>([])
  const [generating, setGenerating] = useState(false)

  const { data: chapters } = useQuery({
    queryKey: ['chapters', selectedBook],
    queryFn: () => api.getBookChapters(selectedBook!),
    enabled: selectedBook != null,
  })

  function toggleChapter(id: number) {
    setSelectedChapters(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  async function handleGenerate() {
    if (selectedChapters.length === 0) return
    setGenerating(true)
    const nid = notify.loading('Generating batch…', `${selectedChapters.length} chapter(s)`)
    try {
      await api.adminGenerate({
        batch_type: batchType,
        grammar_focus: batchType === 'grammar_drill' ? grammarFocus : null,
        chapter_ids: selectedChapters,
      })
      notify.success(nid, 'Batch generated!', `${batchType} · ${grammarFocus}`)
      queryClient.invalidateQueries({ queryKey: ['admin-batches'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    } catch (e: unknown) {
      notify.error(nid, 'Generation failed', e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }

  async function handleDelete(batch: AdminBatch) {
    const nid = notify.loading('Deleting batch…')
    try {
      await api.deleteAdminBatch(batch.id)
      notify.success(nid, 'Batch deleted')
      queryClient.invalidateQueries({ queryKey: ['admin-batches'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    } catch (e: unknown) {
      notify.error(nid, 'Delete failed', e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <motion.div initial="hidden" animate="visible" className="space-y-6 pb-12">
      {/* Header */}
      <motion.div custom={0} variants={fadeUp} className="flex items-center gap-3 pt-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-500 flex items-center justify-center">
          <Settings className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-slate-100">Admin</h1>
          <p className="text-xs text-slate-500">Batch monitoring & manual generation</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClearSession}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 border border-white/[0.06] hover:border-slate-500/40 transition-all duration-200"
            title="Clear frontend session cache (fixes stale resume banner)"
          >
            <RotateCcw className="w-3 h-3" />
            Clear session
          </button>
          <button
            onClick={() => setShowResetDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-red-400/70 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 transition-all duration-200"
            title="Reset the entire database and re-create user with id=1"
          >
            <AlertTriangle className="w-3 h-3" />
            Reset DB
          </button>
        </div>
      </motion.div>

      {/* ── Reset DB dialog ── */}
      {showResetDialog && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowResetDialog(false) }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass rounded-2xl p-6 w-full max-w-sm space-y-5 border border-red-500/20"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4.5 h-4.5 text-red-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-100">Reset database</h3>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Toutes les tables seront vidées et les séquences remises à 1. Un nouvel utilisateur sera créé avec id=1.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={resetUsername}
                  onChange={e => setResetUsername(e.target.value)}
                  placeholder="Username"
                  className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50 placeholder-slate-600"
                />
                <select
                  value={resetCefr}
                  onChange={e => setResetCefr(e.target.value)}
                  className="bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
                >
                  {CEFR_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowResetDialog(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetDb}
                disabled={resetting || !resetUsername.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ── Section 1: Overview ── */}
      {overview && (
        <motion.div custom={1} variants={fadeUp} className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Overview</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Total Batches" value={overview.total_batches} icon={Layers} color="bg-violet-600/20 text-violet-300" />
            <StatCard label="Today" value={overview.batches_today} icon={Zap} color="bg-amber-600/20 text-amber-300" />
            <StatCard label="Exercises" value={overview.total_exercises} icon={Brain} color="bg-emerald-600/20 text-emerald-300" />
            <StatCard label="CEFR" value={`${overview.user.cefr_level} 🔥${overview.user.cefr_streak}`} icon={BookOpen} color="bg-blue-600/20 text-blue-300" />
          </div>

          {/* Models used */}
          {Object.keys(overview.models_used).length > 0 && (
            <div className="glass rounded-xl p-4 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-widest">Models</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(overview.models_used).map(([model, count]) => (
                  <span key={model} className="px-2.5 py-1 bg-slate-700/60 border border-slate-600/40 rounded-lg text-xs text-slate-300">
                    {model} <span className="text-slate-500">({count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Batch type distribution */}
          {Object.keys(overview.batches_by_type).length > 0 && (
            <div className="glass rounded-xl p-4 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-widest">By Type</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(overview.batches_by_type).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-1.5">
                    <TypeBadge type={type} />
                    <span className="text-xs text-slate-500">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Section 2: History ── */}
      <motion.div custom={2} variants={fadeUp} className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">History</h2>
        <div className="glass rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-6 text-center text-slate-500 text-sm">Loading…</div>
          ) : !batches?.length ? (
            <div className="p-6 text-center text-slate-500 text-sm">No batches yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06]">
                    {['Date', 'Type', 'Book', 'Chapter', 'Model', 'CEFR', 'C/G/V', ''].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-slate-500 font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batches.map(batch => (
                    <tr key={batch.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                        {new Date(batch.generated_at).toLocaleDateString('fr-FR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <TypeBadge type={batch.batch_type} />
                        {batch.grammar_focus && (
                          <span className="ml-1 text-slate-500">{batch.grammar_focus.replace(/_/g, ' ')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-300 max-w-[120px] truncate">{batch.book_title}</td>
                      <td className="px-3 py-2 text-slate-400 max-w-[100px] truncate">{batch.chapter_title}</td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{batch.model_used ?? '—'}</td>
                      <td className="px-3 py-2 text-slate-400">{batch.cefr_level}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                        <span className="text-blue-400">{batch.comprehension_count}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-amber-400">{batch.grammar_count}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-teal-400">{batch.vocabulary_count}</span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => handleDelete(batch)}
                          className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded"
                          title="Delete batch"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Section 3: Manual generation ── */}
      <motion.div custom={3} variants={fadeUp} className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Generate Manually</h2>
        <div className="glass rounded-xl p-5 space-y-4">
          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Type</label>
            <select
              value={batchType}
              onChange={e => setBatchType(e.target.value)}
              className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
            >
              <option value="grammar_drill">Grammar Drill</option>
              <option value="chapter">Chapter</option>
              <option value="book_progress">Book Progress</option>
              <option value="vocab_flashcard">Vocab Flashcard</option>
            </select>
          </div>

          {/* Grammar focus (only for grammar_drill) */}
          {batchType === 'grammar_drill' && (
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">Grammar Focus</label>
              <select
                value={grammarFocus}
                onChange={e => setGrammarFocus(e.target.value)}
                className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-amber-500/50"
              >
                {GRAMMAR_FOCUSES.map(f => (
                  <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
          )}

          {/* Book */}
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Book</label>
            <select
              value={selectedBook ?? ''}
              onChange={e => {
                setSelectedBook(e.target.value ? Number(e.target.value) : null)
                setSelectedChapters([])
              }}
              className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
            >
              <option value="">Select a book…</option>
              {books?.filter(b => b.parsed).map(b => (
                <option key={b.id} value={b.id}>{b.title}</option>
              ))}
            </select>
          </div>

          {/* Chapters */}
          {chapters && chapters.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">Chapters</label>
                <button
                  onClick={() => setSelectedChapters(
                    selectedChapters.length === chapters.length ? [] : chapters.map(c => c.id)
                  )}
                  className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                >
                  {selectedChapters.length === chapters.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
                {chapters.map(ch => (
                  <label
                    key={ch.id}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors text-xs',
                      selectedChapters.includes(ch.id)
                        ? 'bg-violet-600/15 border-violet-500/30 text-violet-200'
                        : 'bg-slate-800/40 border-slate-700/40 text-slate-400 hover:border-slate-600/60'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedChapters.includes(ch.id)}
                      onChange={() => toggleChapter(ch.id)}
                      className="sr-only"
                    />
                    <span className={cn(
                      'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                      selectedChapters.includes(ch.id) ? 'bg-violet-600 border-violet-500' : 'border-slate-600'
                    )}>
                      {selectedChapters.includes(ch.id) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{ch.title || `Ch. ${ch.order_index + 1}`}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || selectedChapters.length === 0}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200',
              generating || selectedChapters.length === 0
                ? 'bg-slate-700/40 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-500 hover:to-purple-500 shadow-lg shadow-violet-500/20'
            )}
          >
            <Zap className="w-4 h-4" />
            {generating ? 'Generating…' : `Generate Now ${selectedChapters.length > 0 ? `(${selectedChapters.length} ch.)` : ''}`}
          </button>
        </div>
      </motion.div>

      {/* ── Section 4: Database ── */}
      <motion.div custom={4} variants={fadeUp} className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Database</h2>
        <AdminDB />
      </motion.div>
    </motion.div>
  )
}

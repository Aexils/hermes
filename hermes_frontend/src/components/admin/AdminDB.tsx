import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Link, RotateCcw, UserPlus, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../api/client'
import type { ExerciseRow, BookRow, ChapterRow, UserRow, AttemptRow, AbsItem } from '../../api/types'
import { useNotify } from '../../store/notificationStore'
import { cn } from '../../lib/cn'
import { CEFR_LEVELS } from '../../lib/cefr'

type Tab = 'exercises' | 'books' | 'chapters' | 'user' | 'attempts'

interface EditState {
  id: number
  field: string
  value: string
}

const JSON_FIELDS = ['options', 'grammar_scores', 'vocabulary_mastery']
const INT_FIELDS = ['order_index', 'cefr_streak']

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

// ── Score bar row ────────────────────────────────────────────────────────────

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 0.8 ? 'bg-emerald-500' : score >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
  const textColor = score >= 0.8 ? 'text-emerald-400' : score >= 0.5 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-slate-400 w-32 truncate flex-shrink-0" title={label}>
        {label.replace(/_/g, ' ')}
      </span>
      <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden min-w-0">
        <div
          className={cn('h-full rounded-full transition-all duration-300', color)}
          style={{ width: `${Math.round(score * 100)}%` }}
        />
      </div>
      <span className={cn('text-xs w-8 text-right flex-shrink-0 font-mono tabular-nums', textColor)}>
        {Math.round(score * 100)}%
      </span>
    </div>
  )
}

// ── Scores section ───────────────────────────────────────────────────────────

function ScoresSection({
  title, entries, onReset, emptyMsg,
}: {
  title: string
  entries: [string, number][]
  onReset: () => void
  emptyMsg: string
}) {
  const [expanded, setExpanded] = useState(false)
  const PAGE = 8
  const displayed = expanded ? entries : entries.slice(0, PAGE)
  const weak = entries.filter(([, v]) => v < 0.5).length
  const mastered = entries.filter(([, v]) => v >= 0.8).length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</span>
          {entries.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {mastered > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20">
                  {mastered} mastered
                </span>
              )}
              {weak > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400/80 border border-red-500/20">
                  {weak} weak
                </span>
              )}
            </div>
          )}
        </div>
        {entries.length > 0 && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-slate-600 italic">{emptyMsg}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
            {displayed.map(([key, score]) => (
              <ScoreBar key={key} label={key} score={score} />
            ))}
          </div>
          {entries.length > PAGE && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors mt-1"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Show less' : `Show ${entries.length - PAGE} more`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── User Card ────────────────────────────────────────────────────────────────

function UserCard({ user, onUpdated }: { user: UserRow; onUpdated: () => void }) {
  const notify = useNotify()
  const queryClient = useQueryClient()

  const { data: stats } = useQuery({
    queryKey: ['db-user-stats', user.id],
    queryFn: () => api.getUserStats(user.id),
  })

  async function saveCefr(level: string) {
    const nid = notify.loading('Saving CEFR…')
    try {
      await api.patchDbUser(user.id, { cefr_level: level })
      queryClient.invalidateQueries({ queryKey: ['db-users'] })
      notify.success(nid, 'CEFR updated')
    } catch (e: unknown) {
      notify.error(nid, 'Failed', e instanceof Error ? e.message : String(e))
    }
  }

  async function handleReset(type: 'grammar' | 'vocabulary' | 'all') {
    const nid = notify.loading('Resetting…')
    try {
      await api.resetUserScores(user.id, {
        grammar: type === 'grammar' || type === 'all',
        vocabulary: type === 'vocabulary' || type === 'all',
      })
      queryClient.invalidateQueries({ queryKey: ['db-users'] })
      notify.success(nid, 'Scores reset')
    } catch (e: unknown) {
      notify.error(nid, 'Failed', e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete user "${user.username}"?\nThis will permanently delete all their attempts and SRS data.`)) return
    const nid = notify.loading('Deleting user…')
    try {
      await api.deleteDbUser(user.id)
      onUpdated()
      notify.success(nid, 'User deleted')
    } catch (e: unknown) {
      notify.error(nid, 'Failed', e instanceof Error ? e.message : String(e))
    }
  }

  const grammarEntries = Object.entries(user.grammar_scores || {}).sort(([, a], [, b]) => a - b)
  const vocabEntries = Object.entries(user.vocabulary_mastery || {}).sort(([, a], [, b]) => a - b)
  const hasScores = grammarEntries.length > 0 || vocabEntries.length > 0

  return (
    <div className="glass rounded-xl p-5 space-y-5 border border-white/[0.06]">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-violet-600/20 border border-violet-500/25 flex items-center justify-center text-violet-300 font-bold text-xl flex-shrink-0">
            {user.username[0]?.toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
              {user.username}
              <span className="text-amber-400 text-sm" title="CEFR streak">
                🔥{user.cefr_streak}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {stats?.created_at
                ? `Joined ${new Date(stats.created_at).toLocaleDateString('fr-FR')}`
                : 'User #' + user.id}
              {stats && stats.active_days > 0 && (
                <span className="ml-2 text-slate-600">· {stats.active_days} active days</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={user.cefr_level}
            onChange={e => saveCefr(e.target.value)}
            className="bg-slate-800/80 border border-slate-700/50 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-200 focus:outline-none focus:border-violet-500/60 cursor-pointer appearance-none pr-7"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.35rem center', backgroundSize: '1.1em' }}
          >
            {CEFR_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <button
            onClick={handleDelete}
            className="text-slate-600 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-400/10"
            title="Delete user"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Exercise stats ── */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/[0.04]">
            <div className="text-xl font-bold text-slate-100 tabular-nums">{stats.total_exercises}</div>
            <div className="text-xs text-slate-500 mt-0.5">Exercises</div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/[0.04]">
            <div className={cn(
              'text-xl font-bold tabular-nums',
              stats.success_rate >= 0.7 ? 'text-emerald-400' : stats.success_rate >= 0.5 ? 'text-amber-400' : 'text-red-400',
            )}>
              {stats.total_exercises > 0 ? `${Math.round(stats.success_rate * 100)}%` : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Success ({stats.exercises_correct}/{stats.total_exercises})
            </div>
          </div>
          <div className="bg-slate-800/40 rounded-lg p-3 text-center border border-white/[0.04]">
            <div className="text-sm font-bold text-slate-200">
              {stats.last_active ? timeAgo(stats.last_active) : '—'}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Last active</div>
          </div>
        </div>
      )}

      {/* ── Grammar scores ── */}
      <ScoresSection
        title="Grammar Scores"
        entries={grammarEntries}
        onReset={() => handleReset('grammar')}
        emptyMsg="No grammar data yet."
      />

      {/* ── Vocabulary mastery ── */}
      <ScoresSection
        title="Vocabulary Mastery"
        entries={vocabEntries}
        onReset={() => handleReset('vocabulary')}
        emptyMsg="No vocabulary data yet."
      />

      {/* ── Reset all ── */}
      {hasScores && (
        <div className="pt-1 border-t border-white/[0.05]">
          <button
            onClick={() => handleReset('all')}
            className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset all scores
          </button>
        </div>
      )}
    </div>
  )
}

// ── Users panel ──────────────────────────────────────────────────────────────

function UsersPanel() {
  const notify = useNotify()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newCefr, setNewCefr] = useState('B1')
  const [creating, setCreating] = useState(false)

  const { data: users, isLoading } = useQuery({
    queryKey: ['db-users'],
    queryFn: api.getDbUsers,
  })

  async function handleCreate() {
    if (!newUsername.trim()) return
    setCreating(true)
    const nid = notify.loading('Creating user…')
    try {
      await api.createDbUser({ username: newUsername.trim(), cefr_level: newCefr })
      queryClient.invalidateQueries({ queryKey: ['db-users'] })
      notify.success(nid, 'User created')
      setShowCreate(false)
      setNewUsername('')
    } catch (e: unknown) {
      notify.error(nid, 'Failed', e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  function onUpdated() {
    queryClient.invalidateQueries({ queryKey: ['db-users'] })
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{users?.length ?? 0} user(s)</span>
        <button
          onClick={() => setShowCreate(v => !v)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
            showCreate
              ? 'bg-violet-600/15 text-violet-300 border-violet-500/30'
              : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-slate-300',
          )}
        >
          <UserPlus className="w-3.5 h-3.5" />
          New user
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="glass rounded-xl p-4 space-y-3 border border-violet-500/20">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Create user</p>
          <div className="flex gap-2">
            <input
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Username"
              className="flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50 placeholder-slate-600"
            />
            <select
              value={newCefr}
              onChange={e => setNewCefr(e.target.value)}
              className="bg-slate-800/60 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
            >
              {CEFR_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <button
              onClick={handleCreate}
              disabled={creating || !newUsername.trim()}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                creating || !newUsername.trim()
                  ? 'bg-slate-700/40 text-slate-500 cursor-not-allowed'
                  : 'bg-violet-600 hover:bg-violet-500 text-white',
              )}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* User cards */}
      {isLoading ? (
        <div className="py-8 text-center text-slate-500 text-sm">Loading…</div>
      ) : !users?.length ? (
        <div className="py-8 text-center text-slate-500 text-sm">No users found.</div>
      ) : (
        users.map(user => <UserCard key={user.id} user={user} onUpdated={onUpdated} />)
      )}
    </div>
  )
}

// ── Inline editable cell ─────────────────────────────────────────────────────

function EditCell({
  id, field, value, editing, setEditing, onCommit, multiline = false,
}: {
  id: number
  field: string
  value: string | null | undefined
  editing: EditState | null
  setEditing: (e: EditState | null) => void
  onCommit: (id: number, field: string, value: string) => Promise<void>
  multiline?: boolean
}) {
  const isEditing = editing?.id === id && editing?.field === field
  const displayVal = value != null && value !== '' ? value : '—'

  if (isEditing) {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) { e.preventDefault(); onCommit(id, field, editing!.value) }
      if (e.key === 'Escape') setEditing(null)
    }
    if (multiline) {
      return (
        <textarea
          autoFocus
          value={editing!.value}
          onChange={e => setEditing({ ...editing!, value: e.target.value })}
          onBlur={() => onCommit(id, field, editing!.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full min-w-[200px] bg-slate-900 border border-violet-500/50 rounded px-2 py-1 text-xs text-slate-100 resize-y focus:outline-none font-mono"
        />
      )
    }
    return (
      <input
        autoFocus
        value={editing!.value}
        onChange={e => setEditing({ ...editing!, value: e.target.value })}
        onBlur={() => onCommit(id, field, editing!.value)}
        onKeyDown={handleKeyDown}
        className="w-full min-w-[120px] bg-slate-900 border border-violet-500/50 rounded px-2 py-1 text-xs text-slate-100 focus:outline-none"
      />
    )
  }

  return (
    <span
      onClick={() => setEditing({ id, field, value: value ?? '' })}
      className="cursor-pointer hover:text-violet-300 hover:underline decoration-dotted underline-offset-2 transition-colors block truncate max-w-full"
      title={`${displayVal} — click to edit`}
    >
      {displayVal}
    </span>
  )
}

// ── Delete button ────────────────────────────────────────────────────────────

function DeleteBtn({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      onClick={onDelete}
      className="text-slate-600 hover:text-red-400 transition-colors p-1 rounded"
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  )
}

// ── Loading / empty states ───────────────────────────────────────────────────

function LoadingRow() {
  return <div className="p-8 text-center text-slate-500 text-sm">Loading…</div>
}
function EmptyRow({ msg }: { msg: string }) {
  return <div className="p-8 text-center text-slate-500 text-sm">{msg}</div>
}

// ── Table header cell ────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-left text-slate-500 font-medium whitespace-nowrap text-xs">
      {children}
    </th>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

const STATUS_CLASS: Record<string, string> = {
  none: 'text-slate-500',
  pending: 'text-amber-400',
  running: 'text-blue-400',
  done: 'text-emerald-400',
  failed: 'text-red-400',
}

export default function AdminDB() {
  const notify = useNotify()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('exercises')
  const [editing, setEditing] = useState<EditState | null>(null)
  const [filterBookId, setFilterBookId] = useState<string>('')
  const [showAbs, setShowAbs] = useState(false)
  const [transcribing, setTranscribing] = useState<Set<number>>(new Set())
  const [syncing, setSyncing] = useState(false)

  const { data: exercises, isLoading: loadingEx } = useQuery({
    queryKey: ['db-exercises'],
    queryFn: () => api.getDbExercises({ limit: 50 }),
    enabled: tab === 'exercises',
  })

  const { data: dbBooks, isLoading: loadingBooks } = useQuery({
    queryKey: ['db-books'],
    queryFn: api.getDbBooks,
    enabled: tab === 'books' || tab === 'chapters',
  })

  const { data: chapters, isLoading: loadingChapters } = useQuery({
    queryKey: ['db-chapters', filterBookId],
    queryFn: () => api.getDbChapters(filterBookId ? Number(filterBookId) : undefined),
    enabled: tab === 'chapters',
  })

  const { data: attempts, isLoading: loadingAttempts } = useQuery({
    queryKey: ['db-attempts'],
    queryFn: () => api.getDbAttempts({ limit: 50 }),
    enabled: tab === 'attempts',
  })

  const { data: absItems, isLoading: loadingAbs } = useQuery({
    queryKey: ['abs-items'],
    queryFn: api.getAbsItems,
    enabled: showAbs && tab === 'books',
  })

  // ── Commit inline edit ────────────────────────────────────────────────────

  async function commitEdit(id: number, field: string, rawValue: string) {
    let value: unknown = rawValue
    if (JSON_FIELDS.includes(field)) {
      try { value = rawValue.trim() ? JSON.parse(rawValue) : null } catch {
        const nid = notify.loading('Validating…')
        notify.error(nid, 'Invalid JSON', `Cannot parse "${field}"`)
        return
      }
    } else if (INT_FIELDS.includes(field)) {
      value = parseInt(rawValue) || 0
    }

    const data = { [field]: value }
    const nid = notify.loading('Saving…')
    try {
      if (tab === 'exercises') {
        await api.patchDbExercise(id, data as Parameters<typeof api.patchDbExercise>[1])
        queryClient.invalidateQueries({ queryKey: ['db-exercises'] })
      } else if (tab === 'books') {
        await api.patchDbBook(id, data as Parameters<typeof api.patchDbBook>[1])
        queryClient.invalidateQueries({ queryKey: ['db-books'] })
      } else if (tab === 'chapters') {
        await api.patchDbChapter(id, data as Parameters<typeof api.patchDbChapter>[1])
        queryClient.invalidateQueries({ queryKey: ['db-chapters', filterBookId] })
      }
      notify.success(nid, 'Saved')
      setEditing(null)
    } catch (e: unknown) {
      notify.error(nid, 'Save failed', e instanceof Error ? e.message : String(e))
    }
  }

  // ── Delete helpers ────────────────────────────────────────────────────────

  async function del(label: string, fn: () => Promise<unknown>, queryKeys: unknown[][]) {
    const nid = notify.loading(`Deleting ${label}…`)
    try {
      await fn()
      queryKeys.forEach(k => queryClient.invalidateQueries({ queryKey: k }))
      notify.success(nid, `${label} deleted`)
    } catch (e: unknown) {
      notify.error(nid, 'Delete failed', e instanceof Error ? e.message : String(e))
    }
  }

  // ── Audio helpers ─────────────────────────────────────────────────────────

  async function handleTranscribe(bookId: number) {
    setTranscribing(prev => new Set(prev).add(bookId))
    const nid = notify.loading('Queuing transcription…')
    try {
      await api.startTranscription(bookId)
      queryClient.invalidateQueries({ queryKey: ['db-books'] })
      notify.success(nid, 'Transcription queued — check status in a few minutes')
    } catch (e: unknown) {
      notify.error(nid, 'Failed', e instanceof Error ? e.message : String(e))
    } finally {
      setTranscribing(prev => { const s = new Set(prev); s.delete(bookId); return s })
    }
  }

  async function handleSyncAbs() {
    setSyncing(true)
    const nid = notify.loading('Syncing Audiobookshelf…')
    try {
      const res = await api.syncAudiobookshelf()
      queryClient.invalidateQueries({ queryKey: ['db-books'] })
      queryClient.invalidateQueries({ queryKey: ['abs-items'] })
      notify.success(nid, `Synced — ${res.new} new, ${res.updated} updated`)
    } catch (e: unknown) {
      notify.error(nid, 'Sync failed', e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  // ── Tab definitions ───────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string }[] = [
    { id: 'exercises', label: 'Exercises' },
    { id: 'books', label: 'Books' },
    { id: 'chapters', label: 'Chapters' },
    { id: 'user', label: 'Users' },
    { id: 'attempts', label: 'Attempts' },
  ]

  // ── Table content (non-user tabs) ─────────────────────────────────────────

  function renderTable() {
    if (tab === 'exercises') {
      if (loadingEx) return <LoadingRow />
      if (!exercises?.length) return <EmptyRow msg="No exercises." />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {['ID', 'Batch', 'Type', 'Question', 'Answer', 'Options', 'GramCat', 'VocabItem', 'Book / Chapter', ''].map(h => <Th key={h}>{h}</Th>)}
            </tr>
          </thead>
          <tbody>
            {exercises.map((ex: ExerciseRow) => (
              <tr key={ex.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-2 text-slate-500">{ex.id}</td>
                <td className="px-3 py-2 text-slate-400">{ex.batch_id ?? '—'}</td>
                <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{ex.type}</td>
                <td className="px-3 py-2 text-slate-300 max-w-[200px]">
                  <EditCell id={ex.id} field="question" value={ex.question} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                </td>
                <td className="px-3 py-2 text-slate-300 max-w-[160px]">
                  <EditCell id={ex.id} field="correct_answer" value={ex.correct_answer} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                </td>
                <td className="px-3 py-2 text-slate-400 max-w-[120px]">
                  <EditCell id={ex.id} field="options" value={ex.options ? JSON.stringify(ex.options) : null} editing={editing} setEditing={setEditing} onCommit={commitEdit} multiline />
                </td>
                <td className="px-3 py-2 text-slate-400 max-w-[110px]">
                  <EditCell id={ex.id} field="grammar_category" value={ex.grammar_category} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                </td>
                <td className="px-3 py-2 text-slate-400 max-w-[110px]">
                  <EditCell id={ex.id} field="vocabulary_item" value={ex.vocabulary_item} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                </td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap max-w-[160px]">
                  <span className="truncate block">{ex.book_title} / {ex.chapter_title}</span>
                </td>
                <td className="px-3 py-2">
                  <DeleteBtn onDelete={() => del('exercise', () => api.deleteDbExercise(ex.id), [['db-exercises']])} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    if (tab === 'books') {
      if (loadingBooks) return <LoadingRow />
      if (!dbBooks?.length) return <EmptyRow msg="No books." />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {['ID', 'Title', 'Author', 'Parsed', 'Status', 'ABS ID', 'Audio Path', ''].map(h => <Th key={h}>{h}</Th>)}
            </tr>
          </thead>
          <tbody>
            {dbBooks.map((book: BookRow) => {
              const canTranscribe = book.audio_path && ['none', 'failed'].includes(book.transcription_status)
              const isRunning = ['running', 'pending'].includes(book.transcription_status)
              return (
                <tr key={book.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-slate-500">{book.id}</td>
                  <td className="px-3 py-2 text-slate-300 max-w-[180px]">
                    <EditCell id={book.id} field="title" value={book.title} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                  </td>
                  <td className="px-3 py-2 text-slate-400 max-w-[120px]">
                    <EditCell id={book.id} field="author" value={book.author} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('font-medium', book.parsed ? 'text-emerald-400' : 'text-slate-500')}>
                      {book.parsed ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={cn('font-medium', STATUS_CLASS[book.transcription_status] ?? 'text-slate-500')}>
                      {book.transcription_status}
                    </span>
                    {isRunning && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                  </td>
                  <td className="px-3 py-2 text-slate-400 max-w-[140px]">
                    <EditCell id={book.id} field="audio_item_id" value={book.audio_item_id} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                  </td>
                  <td className="px-3 py-2 text-slate-400 max-w-[200px]">
                    <EditCell id={book.id} field="audio_path" value={book.audio_path} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {(canTranscribe || isRunning) && (
                        <button
                          onClick={() => canTranscribe && handleTranscribe(book.id)}
                          disabled={!canTranscribe || transcribing.has(book.id)}
                          title={isRunning ? 'Transcription in progress' : 'Start Whisper transcription'}
                          className={cn(
                            'px-2 py-1 rounded text-xs font-medium transition-colors border',
                            isRunning || transcribing.has(book.id)
                              ? 'text-slate-500 border-slate-700/40 cursor-not-allowed'
                              : 'text-violet-300 border-violet-500/30 hover:bg-violet-500/10 cursor-pointer',
                          )}
                        >
                          {isRunning ? '⏳' : '🎙 Transcribe'}
                        </button>
                      )}
                      <DeleteBtn onDelete={() => del('book', () => api.deleteDbBook(book.id), [['db-books'], ['books']])} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )
    }

    if (tab === 'chapters') {
      if (loadingChapters) return <LoadingRow />
      if (!chapters?.length) return <EmptyRow msg="No chapters." />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {['ID', 'Book', 'Title', 'Order', ''].map(h => <Th key={h}>{h}</Th>)}
            </tr>
          </thead>
          <tbody>
            {chapters.map((ch: ChapterRow) => (
              <tr key={ch.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-2 text-slate-500">{ch.id}</td>
                <td className="px-3 py-2 text-slate-400 max-w-[140px]">
                  <span className="truncate block">{ch.book_title}</span>
                </td>
                <td className="px-3 py-2 text-slate-300 max-w-[220px]">
                  <EditCell id={ch.id} field="title" value={ch.title} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                </td>
                <td className="px-3 py-2 text-slate-400 w-16">
                  <EditCell id={ch.id} field="order_index" value={String(ch.order_index)} editing={editing} setEditing={setEditing} onCommit={commitEdit} />
                </td>
                <td className="px-3 py-2">
                  <DeleteBtn onDelete={() => del('chapter', () => api.deleteDbChapter(ch.id), [['db-chapters', filterBookId]])} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    if (tab === 'attempts') {
      if (loadingAttempts) return <LoadingRow />
      if (!attempts?.length) return <EmptyRow msg="No attempts." />
      return (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {['ID', 'ExId', 'Question', 'Answer', '✓', 'Date', ''].map(h => <Th key={h}>{h}</Th>)}
            </tr>
          </thead>
          <tbody>
            {attempts.map((a: AttemptRow) => (
              <tr key={a.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-3 py-2 text-slate-500">{a.id}</td>
                <td className="px-3 py-2 text-slate-400">{a.exercise_id}</td>
                <td className="px-3 py-2 text-slate-400 max-w-[200px]">
                  <span className="truncate block">{a.question}</span>
                </td>
                <td className="px-3 py-2 text-slate-300 max-w-[160px]">
                  <span className="truncate block">{a.user_answer ?? '—'}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('font-bold', a.is_correct ? 'text-emerald-400' : 'text-red-400')}>
                    {a.is_correct ? '✓' : '✗'}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                  {new Date(a.attempted_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2">
                  <DeleteBtn onDelete={() => del('attempt', () => api.deleteDbAttempt(a.id), [['db-attempts']])} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    return null
  }

  return (
    <div className="glass rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setEditing(null) }}
            className={cn(
              'px-4 py-2.5 text-xs font-medium transition-colors whitespace-nowrap',
              tab === t.id
                ? 'text-violet-300 border-b-2 border-violet-400 -mb-px'
                : 'text-slate-500 hover:text-slate-400',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Books: toolbar */}
      {tab === 'books' && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
          <button
            onClick={() => setShowAbs(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors border',
              showAbs ? 'bg-violet-500/20 text-violet-300 border-violet-500/30' : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-slate-300',
            )}
          >
            <Link className="w-3.5 h-3.5" />
            ABS Items
          </button>
          <button
            onClick={handleSyncAbs}
            disabled={syncing}
            title="Sync audiobooks from Audiobookshelf and auto-match to EPUBs"
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors border',
              syncing
                ? 'text-slate-500 border-slate-700/40 cursor-not-allowed'
                : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-slate-300',
            )}
          >
            <RotateCcw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync ABS'}
          </button>
        </div>
      )}

      {/* ABS Items panel */}
      {tab === 'books' && showAbs && (
        <div className="border-b border-white/[0.06] overflow-x-auto">
          {loadingAbs ? (
            <div className="px-4 py-3 text-xs text-slate-500">Loading ABS items…</div>
          ) : !absItems?.length ? (
            <div className="px-4 py-3 text-xs text-slate-500">No ABS items found.</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">ABS ID</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Title</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Duration</th>
                  <th className="px-3 py-2 text-left text-slate-500 font-medium">Linked</th>
                </tr>
              </thead>
              <tbody>
                {absItems.map((item: AbsItem) => (
                  <tr key={item.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-slate-400 font-mono select-all">{item.id}</td>
                    <td className="px-3 py-2 text-slate-300 max-w-[280px]">
                      <span className="truncate block">{item.title}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {item.duration != null
                        ? `${Math.floor(item.duration / 3600)}h${Math.floor((item.duration % 3600) / 60)}m`
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {item.matched_book_id != null
                        ? <span className="text-emerald-400 font-medium">Book #{item.matched_book_id}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Chapter book filter */}
      {tab === 'chapters' && (
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
          <span className="text-xs text-slate-500">Filter:</span>
          <select
            value={filterBookId}
            onChange={e => setFilterBookId(e.target.value)}
            className="bg-slate-800/60 border border-slate-700/60 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none"
          >
            <option value="">All books</option>
            {dbBooks?.map(b => (
              <option key={b.id} value={b.id}>{b.title}</option>
            ))}
          </select>
        </div>
      )}

      {/* Users tab — card layout (no overflow-x-auto) */}
      {tab === 'user' && <UsersPanel />}

      {/* Table for other tabs */}
      {tab !== 'user' && (
        <div className="overflow-x-auto">
          {renderTable()}
        </div>
      )}
    </div>
  )
}

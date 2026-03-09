import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from 'recharts'
import { Brain, BookMarked, AlertTriangle, Sparkles, Activity } from 'lucide-react'
import { api, USER_ID } from '../api/client'
import { getCEFRConfig, getNextCEFR } from '../lib/cefr'
import { cn } from '../lib/cn'
import type { ActivityDay } from '../api/types'

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.07, duration: 0.35, ease: 'easeOut' },
  }),
}

// ── Activity heatmap ─────────────────────────────────────────────────────────

function ActivityHeatmap({ data }: { data?: ActivityDay[] }) {
  const activityMap = useMemo(() => {
    const m: Record<string, number> = {}
    data?.forEach(d => { m[d.date] = d.count })
    return m
  }, [data])

  // 5 complete weeks aligned to Mon, ending on the Sunday following today
  const { weeks, todayStr } = useMemo(() => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const dow = (today.getDay() + 6) % 7 // 0=Mon … 6=Sun
    const start = new Date(today)
    start.setDate(today.getDate() - dow - 28) // Monday 5 weeks ago
    const weeks = Array.from({ length: 5 }, (_, wi) =>
      Array.from({ length: 7 }, (_, di) => {
        const d = new Date(start)
        d.setDate(start.getDate() + wi * 7 + di)
        return d
      })
    )
    return { weeks, todayStr }
  }, [])

  const totalEx = Object.values(activityMap).reduce((a, b) => a + b, 0)
  const activeDays = Object.keys(activityMap).length

  function cellColor(count: number) {
    if (count === 0) return 'bg-slate-800/70'
    if (count < 5)  return 'bg-violet-900/80 border border-violet-700/30'
    if (count < 12) return 'bg-violet-700/60 border border-violet-600/30'
    if (count < 20) return 'bg-violet-500/70 border border-violet-400/30'
    return 'bg-violet-400/80 border border-violet-300/30'
  }

  return (
    <div className="glass rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Activity className="w-4 h-4 text-violet-400" />
          Your Journey
        </h3>
        <div className="text-xs text-slate-500 tabular-nums">
          {activeDays} active days · {totalEx} exercises
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1.5 px-0.5">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
          <span key={d} className="text-center text-[9px] text-slate-600 font-medium tracking-wide">{d}</span>
        ))}
      </div>

      {/* Weeks */}
      <div className="space-y-1.5 px-0.5">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1.5">
            {week.map((day, di) => {
              const key = day.toISOString().split('T')[0]
              const count = activityMap[key] ?? 0
              const isFuture = day > new Date()
              const isToday = key === todayStr
              return (
                <div
                  key={di}
                  title={count > 0 ? `${key} · ${count} exercises` : key}
                  className={cn(
                    'aspect-square rounded transition-all duration-200',
                    isFuture ? 'opacity-0 pointer-events-none' : cellColor(count),
                    isToday && !isFuture && 'ring-2 ring-violet-400/60 ring-offset-1 ring-offset-[#0f0f1c]',
                  )}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5 pt-1">
        <span className="text-[10px] text-slate-600">Less</span>
        {[0, 3, 8, 15, 25].map(v => (
          <div key={v} className={cn('w-2.5 h-2.5 rounded-sm', cellColor(v))} />
        ))}
        <span className="text-[10px] text-slate-600">More</span>
      </div>
    </div>
  )
}

// ── Grammar bar ──────────────────────────────────────────────────────────────

function GrammarBar({ subject, score, delay }: { subject: string; score: number; delay: number }) {
  const color = score >= 75 ? 'from-emerald-600 to-emerald-400' : score >= 45 ? 'from-amber-600 to-amber-400' : 'from-red-700 to-red-500'
  const textColor = score >= 75 ? 'text-emerald-400' : score >= 45 ? 'text-amber-400' : 'text-red-400'
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.3 }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-300 capitalize">{subject}</span>
        <span className={cn('text-xs font-bold tabular-nums', textColor)}>{score}%</span>
      </div>
      <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
        <motion.div
          className={cn('h-full rounded-full bg-gradient-to-r', color)}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: delay + 0.1 }}
        />
      </div>
    </motion.div>
  )
}

// ── Vocab tiles ──────────────────────────────────────────────────────────────

function VocabTiles({ entries }: { entries: [string, number][] }) {
  const mastered = entries.filter(([, v]) => v >= 0.8).length
  const learning = entries.filter(([, v]) => v >= 0.5 && v < 0.8).length
  const weak = entries.filter(([, v]) => v < 0.5).length

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center text-slate-600 text-sm">
        Complete vocabulary exercises to build your word bank.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Summary pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {mastered > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            ✓ {mastered} mastered
          </span>
        )}
        {learning > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            ⟳ {learning} learning
          </span>
        )}
        {weak > 0 && (
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
            ✕ {weak} struggling
          </span>
        )}
      </div>

      {/* Word tiles */}
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([word, score]) => (
          <motion.div
            key={word}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            title={`${Math.round(score * 100)}% mastery`}
            className={cn(
              'px-2.5 py-1 rounded-lg text-xs font-medium border cursor-default select-none transition-all duration-200 hover:scale-105',
              score >= 0.8
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15'
                : score >= 0.5
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-300 hover:bg-amber-500/15'
                  : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/15',
            )}
          >
            {word}
            <span className="ml-1.5 opacity-50 text-[10px] tabular-nums">{Math.round(score * 100)}%</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Stats() {
  const { data: stats, isLoading } = useQuery({ queryKey: ['stats'], queryFn: api.getStats })
  const { data: weaknesses } = useQuery({ queryKey: ['weaknesses'], queryFn: api.getWeaknesses })
  const { data: activity } = useQuery({ queryKey: ['activity'], queryFn: () => api.getActivity(USER_ID) })

  const cefr = getCEFRConfig(stats?.cefr_level ?? 'B1')
  const nextLevel = getNextCEFR(stats?.cefr_level ?? 'B1')

  const grammarData = Object.entries(stats?.grammar_scores ?? {})
    .map(([cat, score]) => ({ subject: cat.replace(/_/g, ' '), score: Math.round(score * 100), fullMark: 100 }))
    .sort((a, b) => b.score - a.score)

  const vocabEntries = Object.entries(stats?.vocabulary_mastery ?? {})
    .sort(([, a], [, b]) => b - a) as [string, number][]

  const grammarAvg = getScoreAverage(stats?.grammar_scores ?? {})

  if (isLoading) return <StatsLoading />

  return (
    <motion.div initial="hidden" animate="visible" className="space-y-4 pb-4">

      {/* ── 1. CEFR card ── */}
      <motion.div custom={0} variants={fadeUp}>
        <div className="glass rounded-2xl p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[11px] text-slate-500 uppercase tracking-widest mb-1.5">Current Level</p>
              <div className="flex items-center gap-3">
                <div className={cn('text-4xl font-black tracking-tight', cefr.color)}>{stats?.cefr_level ?? 'B1'}</div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{cefr.label}</p>
                  {nextLevel && <p className="text-xs text-slate-500 mt-0.5">Next: <span className="text-slate-400">{nextLevel}</span></p>}
                </div>
              </div>
            </div>
            <div className="text-5xl select-none">{cefr.emoji}</div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-violet-600 via-purple-500 to-pink-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${grammarAvg}%` }}
                transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Grammar average</span>
              <span className="font-semibold text-slate-300 tabular-nums">{grammarAvg}%</span>
            </div>
          </div>

          {/* Mini stats row */}
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/[0.05]">
            <MiniStat value={Object.keys(stats?.grammar_scores ?? {}).length} label="Categories" />
            <MiniStat value={Object.keys(stats?.vocabulary_mastery ?? {}).length} label="Words" />
            <MiniStat value={`🔥 ${stats?.cefr_level ?? '—'}`} label="Level" />
          </div>
        </div>
      </motion.div>

      {/* ── 2. Activity heatmap ── */}
      <motion.div custom={1} variants={fadeUp}>
        <ActivityHeatmap data={activity} />
      </motion.div>

      {/* ── 3. Grammar ── */}
      {grammarData.length > 0 && (
        <motion.div custom={2} variants={fadeUp}>
          <div className="glass rounded-2xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              Grammar
            </h3>

            {/* Radar chart */}
            {grammarData.length >= 3 && (
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={grammarData} margin={{ top: 16, right: 32, bottom: 16, left: 32 }}>
                  <PolarGrid stroke="rgba(255,255,255,0.06)" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: 'rgba(148,163,184,0.65)', fontSize: 9 }}
                  />
                  <Radar
                    dataKey="score"
                    stroke="#a855f7"
                    fill="#a855f7"
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}

            {/* Bars */}
            <div className="space-y-3 pt-1">
              {grammarData.map((item, i) => (
                <GrammarBar
                  key={item.subject}
                  subject={item.subject}
                  score={item.score}
                  delay={i * 0.03}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── 4. Vocabulary ── */}
      <motion.div custom={3} variants={fadeUp}>
        <div className="glass rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-amber-400" />
            Vocabulary
            {vocabEntries.length > 0 && (
              <span className="ml-auto text-xs font-normal text-slate-500 tabular-nums">
                {vocabEntries.length} words
              </span>
            )}
          </h3>
          <VocabTiles entries={vocabEntries} />
        </div>
      </motion.div>

      {/* ── 5. Focus areas ── */}
      {weaknesses && (weaknesses.weakest_grammar.length > 0 || weaknesses.recommended_focus.length > 0) && (
        <motion.div custom={4} variants={fadeUp}>
          <div className="glass rounded-2xl p-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              Focus Areas
            </h3>
            <p className="text-xs text-slate-500">These categories need the most practice.</p>
            <div className="space-y-2">
              {weaknesses.recommended_focus.map((cat, i) => {
                const score = Math.round((weaknesses.weakest_grammar.find(g => g.category === cat)?.score ?? 0) * 100)
                return (
                  <motion.div
                    key={cat}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center justify-between px-4 py-3 glass rounded-xl border border-orange-500/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-6 rounded-full bg-gradient-to-b from-orange-500 to-red-600" />
                      <span className="text-sm text-slate-200 capitalize">{cat.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-orange-600 to-red-500"
                          style={{ width: `${score}%` }}
                        />
                      </div>
                      <span className="text-xs text-orange-400 font-semibold tabular-nums w-8 text-right">{score}%</span>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* Empty grammar state */}
      {grammarData.length === 0 && (
        <motion.div custom={2} variants={fadeUp}>
          <EmptySection icon={<Brain className="w-8 h-8 text-violet-400/30" />} text="Complete grammar exercises to see your progress here" />
        </motion.div>
      )}

    </motion.div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function EmptySection({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="glass rounded-2xl p-8 flex flex-col items-center gap-3 text-center">
      {icon}
      <p className="text-slate-500 text-sm max-w-xs">{text}</p>
    </div>
  )
}

function StatsLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {[160, 200, 240, 200].map((h, i) => (
        <div key={i} className="glass rounded-2xl" style={{ height: h }} />
      ))}
    </div>
  )
}

function getScoreAverage(scores: Record<string, number>): number {
  const vals = Object.values(scores)
  if (!vals.length) return 0
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100)
}

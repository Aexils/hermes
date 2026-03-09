import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, CheckCircle2, XCircle, ChevronRight,
  BookOpen, PenLine, Lightbulb, Zap, Trophy, RotateCcw, Flag,
} from 'lucide-react'
import { api, USER_ID } from '../api/client'
import { useSessionStore } from '../store/sessionStore'
import AudioPlayer from '../components/AudioPlayer'
import { triggerConfetti, triggerCompletion } from '../lib/confetti'
import { cn } from '../lib/cn'
import type { Exercise, AnswerResult, Anecdote, AudioContextResult } from '../api/types'

type Phase = 'question' | 'submitting' | 'feedback'


const TYPE_CONFIG = {
  comprehension: {
    label: 'Comprehension', color: 'text-blue-300',
    bg: 'bg-blue-500/10 border-blue-500/20',
    icon: <BookOpen className="w-3.5 h-3.5" />,
  },
  grammar: {
    label: 'Grammar', color: 'text-purple-300',
    bg: 'bg-purple-500/10 border-purple-500/20',
    icon: <PenLine className="w-3.5 h-3.5" />,
  },
  vocabulary: {
    label: 'Vocabulary', color: 'text-amber-300',
    bg: 'bg-amber-500/10 border-amber-500/20',
    icon: <Lightbulb className="w-3.5 h-3.5" />,
  },
}

export default function Session() {
  const navigate = useNavigate()
  const location = useLocation()
  const sessionParams = (location.state as { sessionParams?: Record<string, unknown> } | null)?.sessionParams
  const queryClient = useQueryClient()
  const {
    exercises, currentIndex, answers, xpTotal, batchId,
    bookTitle: storedBookTitle, chapterTitle: storedChapterTitle, anecdotes: storedAnecdotes,
    initSession, recordAnswer, nextExercise, resetSession, sessionActive,
  } = useSessionStore()

  const [phase, setPhase] = useState<Phase>('question')
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [textAnswer, setTextAnswer] = useState('')
  const [lastResult, setLastResult] = useState<AnswerResult | null>(null)
  const [showXP, setShowXP] = useState(false)
  const [levelUpCefr, setLevelUpCefr] = useState<string | null>(null)
  const [anecdote, setAnecdote] = useState<Anecdote | null>(null)
  const [audioContexts, setAudioContexts] = useState<Record<string, AudioContextResult>>({})
  const [wrongFlash, setWrongFlash] = useState(false)
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now())
  const [sessionSummary, setSessionSummary] = useState<{ text: string; focusArea?: string | null } | null>(null)
  const [flaggedIds, setFlaggedIds] = useState<Set<number>>(new Set())

  // Ne pas refetch si une session est déjà active en mémoire (résistance au refresh)
  const hasActiveSession = sessionActive && exercises.length > 0 && batchId != null

  const { data: dailyBatch, isLoading, isError: dailyError, error: fetchError } = useQuery({
    queryKey: ['daily-batch', sessionParams ?? null],
    queryFn: () => api.getDailyBatch(sessionParams as Parameters<typeof api.getDailyBatch>[0]),
    staleTime: 1000 * 60 * 60,
    retry: false,
    enabled: !hasActiveSession,
  })

  const batch = dailyBatch
  const isError = dailyError && !hasActiveSession

  const bookId = (sessionParams as { book_id?: number } | undefined)?.book_id
  const [audioTimestamps, setAudioTimestamps] = useState<Record<string, { file_index: number; start: number; end: number }>>({})

  // Lookup audio timestamp for vocab exercises on demand
  const lookupAudioTimestamp = async (exerciseId: number, bookId: number, sourcePassage: string) => {
    const key = String(exerciseId)
    if (audioTimestamps[key] || !sourcePassage) return
    try {
      const result = await api.getAudioTimestamp(bookId, sourcePassage)
      if (result.found && result.audio_start != null) {
        setAudioTimestamps(prev => ({
          ...prev,
          [key]: { file_index: result.file_index ?? 0, start: result.audio_start!, end: result.audio_end! },
        }))
      }
    } catch { /* pas d'audio = pas grave */ }
  }
  const { data: anecdotesData } = useQuery({
    queryKey: ['anecdotes', bookId ?? null],
    queryFn: () => api.getBookAnecdotes(bookId!),
    enabled: bookId != null && !hasActiveSession,
    staleTime: Infinity,
  })

  // Anecdotes : store persisté > batch API > fetch parallèle
  const anecdotePool: Anecdote[] = storedAnecdotes.length
    ? storedAnecdotes
    : batch?.anecdotes?.length
      ? batch.anecdotes
      : (anecdotesData?.anecdotes ?? [])

  useEffect(() => {
    if (!batch || hasActiveSession) return
    if (exercises.length === 0 || batchId !== batch.batch_id) initSession(batch)
  }, [batch, batchId, exercises.length, initSession, hasActiveSession])

  const pickAnecdote = useCallback(() => {
    if (anecdotePool.length > 0)
      setAnecdote(anecdotePool[Math.floor(Math.random() * anecdotePool.length)])
  }, [anecdotePool])

  const submitMutation = useMutation({
    mutationFn: ({ exerciseId, answer, timeTakenMs, isLast }: { exerciseId: number; answer: string; timeTakenMs: number; isLast: boolean }) =>
      api.submitAnswer(exerciseId, answer, timeTakenMs, isLast),
    onSuccess: (result, { exerciseId }) => {
      recordAnswer(exerciseId, result)
      setLastResult(result)
      setPhase('feedback')
      if (result.correct) {
        triggerConfetti()
        setShowXP(true)
        setTimeout(() => setShowXP(false), 2000)
      } else {
        setWrongFlash(true)
        setTimeout(() => setWrongFlash(false), 600)
      }
      if (result.cefr_changed) {
        setLevelUpCefr(result.cefr_changed)
        triggerCompletion()
        setTimeout(() => setLevelUpCefr(null), 4000)
      }
      if (result.session_summary) {
        setSessionSummary({ text: result.session_summary, focusArea: result.session_focus_area })
      }
      // Fetch audio context for any exercise with a source_passage
      const exercise = exercises.find(e => e.id === exerciseId)
      if (bookId && exercise?.source_passage) {
        api.getAudioContext(bookId, exercise.source_passage)
          .then(ctx => { if (ctx.found) setAudioContexts(prev => ({ ...prev, [String(exerciseId)]: ctx })) })
          .catch(() => {})
      }
    },
  })

  const currentExercise = exercises[currentIndex]
  const isComplete = currentIndex >= exercises.length && exercises.length > 0
  const progress = exercises.length > 0 ? currentIndex / exercises.length : 0

  const handleSubmit = useCallback(() => {
    if (!currentExercise || phase !== 'question') return
    const answer = currentExercise.options ? selectedOption ?? '' : textAnswer
    if (!answer.trim()) return
    const timeTakenMs = Date.now() - questionStartTime
    const isLast = currentIndex === exercises.length - 1
    pickAnecdote()
    setPhase('submitting')
    submitMutation.mutate({ exerciseId: currentExercise.id, answer, timeTakenMs, isLast })
  }, [currentExercise, phase, selectedOption, textAnswer, questionStartTime, currentIndex, exercises.length, submitMutation, pickAnecdote])

  const handleNext = useCallback(() => {
    nextExercise()
    setPhase('question')
    setSelectedOption(null)
    setTextAnswer('')
    setLastResult(null)
    setQuestionStartTime(Date.now())
  }, [nextExercise])


  // Keyboard shortcut: Enter to submit / Next
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey) {
        if (phase === 'question') handleSubmit()
        else if (phase === 'feedback') handleNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [phase, handleSubmit, handleNext])

  if (isError) return <SessionError error={fetchError} onBack={() => navigate('/')} />
  if (isLoading && !hasActiveSession) return <SessionLoading anecdotes={anecdotePool} />
  if (!hasActiveSession && exercises.length === 0) return <SessionLoading anecdotes={anecdotePool} />

  // Métadonnées : store en priorité, sinon batch API
  const bookTitleDisplay = storedBookTitle || batch?.book_title || ''
  const chapterTitleDisplay = storedChapterTitle || batch?.chapter_title || ''
  const summaryBatch = { book_title: bookTitleDisplay, chapter_title: chapterTitleDisplay, total_exercises: exercises.length }

  if (isComplete) return <SessionSummary batch={summaryBatch} xpTotal={xpTotal} answers={answers} onRestart={() => {
    resetSession()
    queryClient.invalidateQueries({ queryKey: ['daily-batch'] })
    navigate('/')
  }} aiSummary={sessionSummary} />

  const cfg = TYPE_CONFIG[currentExercise.type]
  const isMCQ = Boolean(currentExercise.options?.length)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-4"
    >
      {/* Level-up overlay */}
      <AnimatePresence>
        {levelUpCefr && (
          <motion.div
            key="level-up"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="text-center"
            >
              <div className="text-8xl font-black text-gradient mb-4">{levelUpCefr}</div>
              <p className="text-2xl font-bold text-white">Level Up!</p>
              <p className="text-slate-300 mt-2">You reached {levelUpCefr}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress dots */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex items-center gap-0.5 flex-wrap py-1">
          <ExerciseDots exercises={exercises} currentIndex={currentIndex} answers={answers} />
        </div>
        <span className="text-xs text-slate-500 tabular-nums shrink-0">
          {currentIndex + 1}/{exercises.length}
        </span>
      </div>

      {/* XP float animation */}
      <AnimatePresence>
        {showXP && (
          <motion.div
            key="xp"
            initial={{ y: 0, opacity: 1, scale: 0.8 }}
            animate={{ y: -50, opacity: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className="flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-full font-bold text-sm backdrop-blur-sm">
              <Zap className="w-3.5 h-3.5" /> +10 XP
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Exercise card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentExercise.id}
          initial={{ x: 40, opacity: 0, scale: 0.97 }}
          animate={wrongFlash
            ? { x: [0, -9, 9, -6, 6, -3, 3, 0], scale: 1, opacity: 1 }
            : { x: 0, opacity: 1, scale: 1 }
          }
          exit={{ x: -40, opacity: 0, scale: 0.97 }}
          transition={{ duration: wrongFlash ? 0.45 : 0.3, ease: 'easeOut' }}
          className={cn(
            'glass rounded-2xl overflow-hidden transition-colors duration-300',
            wrongFlash && 'border-red-500/40 shadow-[0_0_32px_rgba(239,68,68,0.15)]',
          )}
        >
          {/* Type badge */}
          <div className="px-6 pt-6 pb-0">
            <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold mb-4', cfg.bg, cfg.color)}>
              {cfg.icon}
              {cfg.label}
              {currentExercise.grammar_category && (
                <span className="opacity-60">· {currentExercise.grammar_category.replace(/_/g, ' ')}</span>
              )}
            </div>

            {/* Book context for vocabulary exercises — shown in question phase */}
            {currentExercise.type === 'vocabulary' && currentExercise.source_passage && (() => {
              const ts = audioTimestamps[String(currentExercise.id)]
              // Déclenche le lookup audio la première fois qu'on voit cet exercice
              if (bookId && !ts) {
                lookupAudioTimestamp(currentExercise.id, bookId, currentExercise.source_passage)
              }
              return (
                <div className="mb-4 rounded-lg border border-teal-500/20 bg-teal-500/5 px-4 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] text-teal-400/60 font-semibold uppercase tracking-wider">
                      📖 From your book
                    </p>
                    {ts && bookId && (
                      <AudioPlayer
                        src={api.getAudioUrl(bookId, ts.file_index)}
                        startTime={ts.start}
                        endTime={ts.end}
                        label="Hear it"
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-300 italic leading-relaxed">
                    "
                    {currentExercise.vocabulary_item
                      ? highlightWord(currentExercise.source_passage, currentExercise.vocabulary_item)
                      : currentExercise.source_passage}
                    "
                  </p>
                </div>
              )
            })()}

            {/* Question */}
            <p className="text-base font-medium text-slate-100 leading-relaxed mb-6">
              {currentExercise.question}
            </p>
          </div>

          {/* Answer area */}
          <div className="px-6 pb-6">
            {isMCQ ? (
              <MCQOptions
                options={currentExercise.options!}
                selected={selectedOption}
                onSelect={phase === 'question' ? setSelectedOption : undefined}
                result={lastResult}
                phase={phase}
              />
            ) : (
              <TextAnswerInput
                value={textAnswer}
                onChange={setTextAnswer}
                disabled={phase !== 'question'}
                placeholder={currentExercise.subtype === 'fill_blank'
                  ? 'Fill in the blank…'
                  : 'Type your answer…'}
              />
            )}

            {/* Feedback banner */}
            <AnimatePresence>
              {phase === 'feedback' && lastResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    'mt-4 rounded-xl px-4 py-3 flex items-start gap-3',
                    lastResult.correct
                      ? 'bg-emerald-500/10 border border-emerald-500/30'
                      : 'bg-red-500/10 border border-red-500/30'
                  )}
                >
                  {lastResult.correct
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    : <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                  }
                  <div>
                    <p className={cn('text-sm font-semibold', lastResult.correct ? 'text-emerald-300' : 'text-red-300')}>
                      {lastResult.correct ? 'Correct! 🎉' : 'Not quite'}
                    </p>
                    {!lastResult.correct && (
                      <p className="text-xs text-slate-400 mt-1">
                        Correct answer: <span className="text-slate-200 font-medium font-mono">{lastResult.correct_answer}</span>
                      </p>
                    )}
                    {lastResult.explanation && (
                      <p className="text-xs text-slate-400 mt-2 italic border-l-2 border-slate-600 pl-2">{lastResult.explanation}</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Spelling errors */}
            <AnimatePresence>
              {phase === 'feedback' && lastResult && lastResult.spelling_errors?.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, delay: 0.05 }}
                  className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3"
                >
                  <p className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider mb-2">
                    ✏️ Spelling
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {lastResult.spelling_errors.map((e) => (
                      <span key={e.word} className="text-xs">
                        <span className="line-through text-red-400">{e.word}</span>
                        <span className="text-slate-500 mx-1">→</span>
                        <span className="text-emerald-400 font-medium">{e.suggestion}</span>
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Audio context card — shown in feedback phase for any exercise with source_passage */}
            <AnimatePresence>
              {currentExercise.source_passage && phase === 'feedback' && (() => {
                const ctx = audioContexts[String(currentExercise.id)]
                if (ctx?.found && ctx.sentences && bookId != null) {
                  return (
                    <motion.div
                      key="audio-ctx"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, delay: 0.1 }}
                      className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-violet-400/60 font-semibold uppercase tracking-wider">
                          🔊 Contexte audio
                        </p>
                        <AudioPlayer
                          src={api.getAudioUrl(bookId, ctx.file_index ?? 0)}
                          startTime={ctx.audio_start!}
                          endTime={ctx.audio_end!}
                          label="Écouter"
                        />
                      </div>
                      <p className="text-xs leading-relaxed">
                        {ctx.sentences.map((seg, i) => (
                          <span key={i} className={
                            seg.role === 'match'
                              ? 'text-slate-100 font-medium'
                              : 'text-slate-400 italic'
                          }>
                            {i > 0 ? ' ' : ''}{seg.text}
                          </span>
                        ))}
                      </p>
                    </motion.div>
                  )
                }
                // Fallback: static source passage
                return (
                  <motion.div
                    key="source-passage"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, delay: 0.1 }}
                    className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 px-4 py-3"
                  >
                    <p className="text-[10px] text-violet-400/60 font-semibold uppercase tracking-wider mb-1.5">
                      📖 Source passage
                    </p>
                    <p className="text-xs text-slate-300 italic leading-relaxed">
                      "{currentExercise.source_passage}"
                    </p>
                  </motion.div>
                )
              })()}
            </AnimatePresence>

            {/* Anecdote while waiting for answer check */}
            <AnimatePresence>
              {phase === 'submitting' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex items-start gap-3"
                >
                  <div className="mt-0.5 shrink-0 w-4 h-4 border-2 border-violet-500/40 border-t-violet-400 rounded-full animate-spin" />
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Checking your answer…</p>
                    {anecdote && (
                      <>
                        <p className="text-xs text-slate-300 italic leading-relaxed">{anecdote.text}</p>
                        {anecdote.source && (
                          <p className="text-[10px] text-slate-600 mt-1">— {anecdote.source}</p>
                        )}
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit / Next buttons */}
            <div className="mt-4 flex gap-3">
              {phase === 'question' && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending || (!selectedOption && !textAnswer.trim())}
                  className="flex-1 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed hover:from-violet-500 hover:to-purple-500"
                >
                  {submitMutation.isPending ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      Submit
                      <kbd className="ml-1 px-1.5 py-0.5 text-[10px] bg-white/10 text-white/40 rounded font-mono border border-white/10 leading-none hidden sm:inline">⌘↵</kbd>
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </motion.button>
              )}
              {phase === 'feedback' && (
                <>
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleNext}
                    className="flex-1 py-3 rounded-xl font-semibold text-sm bg-white/8 border border-white/10 text-slate-200 flex items-center justify-center gap-2 hover:bg-white/12 transition-all duration-200"
                  >
                    {currentIndex + 1 >= exercises.length ? 'See Results' : 'Next'} <ChevronRight className="w-4 h-4" />
                  </motion.button>
                  {currentExercise.type === 'comprehension' && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={async () => {
                        if (flaggedIds.has(currentExercise.id)) return
                        try {
                          await api.flagQuestion(currentExercise.id)
                          setFlaggedIds(prev => new Set(prev).add(currentExercise.id))
                        } catch { /* silencieux */ }
                      }}
                      title="Signaler cette question comme ambiguë"
                      className={cn(
                        'px-3 py-3 rounded-xl border text-sm transition-all duration-200 flex items-center gap-1.5',
                        flaggedIds.has(currentExercise.id)
                          ? 'text-orange-300 border-orange-500/30 bg-orange-500/10 cursor-default'
                          : 'text-slate-500 border-white/[0.08] hover:text-orange-400 hover:border-orange-500/30 hover:bg-orange-500/5',
                      )}
                    >
                      <Flag className="w-3.5 h-3.5" />
                      {flaggedIds.has(currentExercise.id) ? 'Flagged' : ''}
                    </motion.button>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* XP counter */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center gap-2 text-xs text-slate-500"
      >
        <Zap className="w-3 h-3 text-violet-400" />
        <span><span className="text-violet-300 font-semibold">{xpTotal}</span> XP earned this session</span>
      </motion.div>
    </motion.div>
  )
}

// ---- Sub-components ----

// ── Exercise progress dots ────────────────────────────────────────────────────

const TYPE_DOT: Record<string, { empty: string; current: string }> = {
  comprehension: { empty: 'bg-blue-900/60',   current: 'bg-blue-400'   },
  grammar:       { empty: 'bg-violet-900/60', current: 'bg-violet-400' },
  vocabulary:    { empty: 'bg-amber-900/60',  current: 'bg-amber-400'  },
}

function ExerciseDots({
  exercises, currentIndex, answers,
}: {
  exercises: Exercise[]
  currentIndex: number
  answers: Record<number, AnswerResult>
}) {
  return (
    <>
      {exercises.map((ex, i) => {
        const done = i < currentIndex
        const current = i === currentIndex
        const correct = answers[ex.id]?.correct
        const dot = TYPE_DOT[ex.type] ?? TYPE_DOT.comprehension
        return (
          <motion.div
            key={ex.id}
            className={cn(
              'rounded-full transition-colors duration-300',
              done
                ? correct ? 'bg-emerald-500' : 'bg-red-500/70'
                : current
                  ? dot.current
                  : dot.empty,
              current ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5',
            )}
            animate={current ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      })}
    </>
  )
}

function MCQOptions({
  options, selected, onSelect, result, phase,
}: {
  options: string[]
  selected: string | null
  onSelect?: (opt: string) => void
  result: AnswerResult | null
  phase: Phase
}) {
  return (
    <div className="space-y-2.5">
      {options.map((opt, i) => {
        const letter = String.fromCharCode(65 + i)
        const isSelected = selected === opt
        const isCorrect = result && opt.toLowerCase().replace(/^[a-d]\)\s*/i, '') === result.correct_answer.toLowerCase().replace(/^[a-d]\)\s*/i, '')
        const isWrongSelected = phase === 'feedback' && isSelected && !result?.correct

        let stateClass = 'border-white/[0.08] hover:border-violet-500/30 hover:bg-violet-500/5'
        if (phase === 'question' && isSelected) {
          stateClass = 'border-violet-500/50 bg-violet-500/10'
        } else if (phase === 'feedback') {
          if (isCorrect) stateClass = 'border-emerald-500/60 bg-emerald-500/10 glow-green'
          else if (isWrongSelected) stateClass = 'border-red-500/60 bg-red-500/10 glow-red'
          else stateClass = 'border-white/[0.04] opacity-40'
        }

        return (
          <motion.button
            key={opt}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => { if (onSelect && !isSelected) onSelect(opt); }}
            disabled={!onSelect}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all duration-200',
              stateClass,
              onSelect && 'cursor-pointer',
              !onSelect && 'cursor-default'
            )}
          >
            <span className={cn(
              'w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
              phase === 'question' && isSelected ? 'bg-violet-500 text-white' : 'bg-white/8 text-slate-400',
              phase === 'feedback' && isCorrect ? 'bg-emerald-500 text-white' : '',
              phase === 'feedback' && isWrongSelected ? 'bg-red-500 text-white' : '',
            )}>
              {letter}
            </span>
            <span className="text-sm text-slate-200 flex-1">{opt}</span>
            {phase === 'feedback' && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {phase === 'feedback' && isWrongSelected && <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
          </motion.button>
        )
      })}
    </div>
  )
}

function TextAnswerInput({
  value, onChange, disabled, placeholder,
}: {
  value: string; onChange: (v: string) => void; disabled: boolean; placeholder: string
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      rows={3}
      className={cn(
        'w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-100 placeholder-slate-600',
        'font-mono text-sm resize-none outline-none transition-all duration-200',
        'focus:border-violet-500/50 focus:bg-violet-500/5',
        disabled && 'opacity-60 cursor-not-allowed'
      )}
    />
  )
}

function SessionError({ error, onBack }: { error: Error | null; onBack: () => void }) {
  const msg = error?.message ?? 'Unknown error'
  const is404 = msg.startsWith('404')

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-5 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/25 flex items-center justify-center">
        <XCircle className="w-7 h-7 text-red-400" />
      </div>

      <div>
        <p className="text-slate-100 font-semibold text-base">
          {is404 ? 'Session unavailable' : 'Generation failed'}
        </p>
        <p className="text-slate-500 text-sm mt-1 max-w-xs leading-relaxed">
          {is404
            ? 'No reading progress found. Sync your books from Booklore first, then come back.'
            : msg}
        </p>
      </div>

      <div className="w-full max-w-xs px-4 py-3 rounded-xl bg-slate-800/60 border border-white/[0.06] text-left">
        <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Error detail</p>
        <p className="text-xs text-red-400/80 font-mono break-all">{msg}</p>
      </div>

      <button
        onClick={onBack}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm text-slate-300 hover:text-slate-100 hover:bg-white/[0.1] transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </button>
    </div>
  )
}

function SessionLoading({ anecdotes = [] }: { anecdotes?: Anecdote[] }) {
  const ESTIMATED = 75
  const [elapsed, setElapsed] = useState(0)
  const [anecdoteIdx, setAnecdoteIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Rotate anecdote every 8 seconds
  useEffect(() => {
    if (anecdotes.length < 2) return
    const id = setInterval(() => setAnecdoteIdx((i) => (i + 1) % anecdotes.length), 8000)
    return () => clearInterval(id)
  }, [anecdotes.length])

  const progress = Math.min((elapsed / ESTIMATED) * 100, 95)
  const remaining = Math.max(ESTIMATED - elapsed, 0)
  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const current = anecdotes[anecdoteIdx] ?? null

  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 px-4">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-500 flex items-center justify-center animate-float">
        <Zap className="w-7 h-7 text-white" />
      </div>

      <div className="text-center">
        <p className="text-slate-200 font-semibold text-base">Generating your session…</p>
        <p className="text-slate-500 text-sm mt-1">The AI is crafting your questions</p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-xs space-y-2">
        <div className="flex justify-between text-xs text-slate-500 tabular-nums">
          <span>{Math.round(progress)}%</span>
          <span>{formatTime(elapsed)}</span>
        </div>
        <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-violet-600 to-purple-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
        <p className="text-center text-xs text-slate-600">
          {remaining > 0 ? `~${remaining}s remaining` : 'Almost done…'}
        </p>
      </div>

      {/* Anecdote card */}
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={anecdoteIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-xs glass rounded-xl border border-white/[0.06] px-4 py-3"
          >
            <p className="text-[10px] text-violet-400/60 font-semibold uppercase tracking-wider mb-2">
              Did you know?
            </p>
            <p className="text-xs text-slate-300 italic leading-relaxed">{current.text}</p>
            {current.source && (
              <p className="text-[10px] text-slate-600 mt-2">— {current.source}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function highlightWord(passage: string, word: string): React.ReactNode[] {
  const parts = passage.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === word.toLowerCase()
      ? <strong key={i} className="text-teal-300 font-semibold not-italic">{part}</strong>
      : part as unknown as React.ReactNode
  )
}

function SessionSummary({
  batch, xpTotal, answers, onRestart, aiSummary,
}: {
  batch: { book_title: string; chapter_title: string; total_exercises: number }
  xpTotal: number
  answers: Record<number, AnswerResult>
  onRestart: () => void
  aiSummary: { text: string; focusArea?: string | null } | null
}) {
  const total = Object.keys(answers).length
  const correct = Object.values(answers).filter((r) => r.correct).length
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0

  useEffect(() => { triggerCompletion() }, [])

  const grade = accuracy >= 90 ? '🏆' : accuracy >= 70 ? '⭐' : accuracy >= 50 ? '💪' : '📚'
  const gradeLabel = accuracy >= 90 ? 'Excellent!' : accuracy >= 70 ? 'Great job!' : accuracy >= 50 ? 'Keep going!' : 'Keep practicing!'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-4"
    >
      <div className="glass rounded-2xl p-8 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
          className="text-6xl mb-4"
        >
          {grade}
        </motion.div>
        <h2 className="text-2xl font-bold text-gradient mb-1">{gradeLabel}</h2>
        <p className="text-slate-400 text-sm">
          {batch.book_title} · {batch.chapter_title}
        </p>

        <div className="grid grid-cols-3 gap-4 mt-8">
          <ResultStat value={`${accuracy}%`} label="Accuracy" color="text-violet-300" />
          <ResultStat value={`${correct}/${total}`} label="Correct" color="text-emerald-300" />
          <ResultStat value={`+${xpTotal}`} label="XP gained" color="text-amber-300" />
        </div>
      </div>

      {/* Feedback IA personnalisé */}
      {aiSummary && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="glass rounded-2xl px-6 py-5 border border-violet-500/15"
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-600 to-purple-500 flex items-center justify-center shrink-0">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">AI Feedback</p>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{aiSummary.text}</p>
          {aiSummary.focusArea && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <span className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wider">Focus next</span>
              <span className="text-xs text-amber-300 font-medium">{aiSummary.focusArea.replace(/_/g, ' ')}</span>
            </div>
          )}
        </motion.div>
      )}

      <div className="flex gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={onRestart}
          className="flex-1 py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white flex items-center justify-center gap-2"
        >
          <Trophy className="w-4 h-4" /> Back to Home
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={onRestart}
          className="py-3 px-4 rounded-xl font-semibold text-sm glass border border-white/10 text-slate-300 flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  )
}

function ResultStat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="glass rounded-xl p-3 text-center"
    >
      <div className={cn('text-2xl font-bold', color)}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </motion.div>
  )
}

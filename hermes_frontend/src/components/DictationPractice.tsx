import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Headphones, CheckCircle2, XCircle, RotateCcw, ChevronRight } from 'lucide-react'
import { api, USER_ID } from '../api/client'
import AudioPlayer from './AudioPlayer'
import { cn } from '../lib/cn'

interface Props {
  bookId: number
}

type Phase = 'listen' | 'typing' | 'result'

export default function DictationPractice({ bookId }: Props) {
  const [phase, setPhase] = useState<Phase>('listen')
  const [userText, setUserText] = useState('')
  const [round, setRound] = useState(0)

  const { data: challenge, isLoading, refetch } = useQuery({
    queryKey: ['dictation-challenge', bookId, round],
    queryFn: () => api.getDictationChallenge(bookId),
    staleTime: Infinity,
  })

  const checkMutation = useMutation({
    mutationFn: ({ sentenceId, text }: { sentenceId: number; text: string }) =>
      api.checkDictation(bookId, sentenceId, text),
  })

  const handleSubmit = () => {
    if (!challenge || !userText.trim()) return
    checkMutation.mutate({ sentenceId: challenge.sentence_id, text: userText })
    setPhase('result')
  }

  const handleNext = () => {
    setPhase('listen')
    setUserText('')
    checkMutation.reset()
    setRound((r) => r + 1)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-8">
      <div className="w-5 h-5 border-2 border-teal-500/40 border-t-teal-400 rounded-full animate-spin" />
    </div>
  )

  if (!challenge) return (
    <div className="text-center py-6 text-slate-500 text-sm">No transcribed audio available</div>
  )

  const result = checkMutation.data

  return (
    <div className="space-y-4">
      {/* Instruction */}
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Headphones className="w-4 h-4 text-teal-400 shrink-0" />
        <span>
          {phase === 'listen' && 'Listen carefully, then type what you hear'}
          {phase === 'typing' && `Type the ${challenge.word_count}-word sentence`}
          {phase === 'result' && (result?.passed ? 'Well done! 🎉' : 'Keep practicing!')}
        </span>
      </div>

      {/* Player */}
      <div className="glass rounded-xl px-4 py-4 border border-teal-500/15">
        <AudioPlayer
          src={api.getAudioUrl(bookId, challenge.file_index)}
          startTime={challenge.audio_start}
          endTime={challenge.audio_end}
          label="Play sentence"
          showSpeed
          wordTimestamps={phase !== 'result' ? null : challenge.word_timestamps}
        />
        <p className="text-[10px] text-slate-600 mt-2 tabular-nums">
          {challenge.word_count} words · {(challenge.audio_end - challenge.audio_start).toFixed(1)}s
        </p>
      </div>

      {/* Input */}
      <AnimatePresence mode="wait">
        {phase !== 'result' && (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <textarea
              value={userText}
              onChange={(e) => { setUserText(e.target.value); setPhase('typing') }}
              placeholder="Type what you heard…"
              rows={3}
              className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-100 placeholder-slate-600 font-mono text-sm resize-none outline-none transition-all focus:border-teal-500/40 focus:bg-teal-500/5"
            />
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={handleSubmit}
              disabled={!userText.trim() || checkMutation.isPending}
              className="mt-2 w-full py-2.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-teal-600 to-cyan-600 text-white disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Check <ChevronRight className="w-4 h-4" />
            </motion.button>
          </motion.div>
        )}

        {phase === 'result' && result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Score */}
            <div className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border',
              result.passed
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            )}>
              {result.passed
                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                : <XCircle className="w-5 h-5 text-amber-400 shrink-0" />
              }
              <div>
                <p className={cn('text-sm font-semibold', result.passed ? 'text-emerald-300' : 'text-amber-300')}>
                  {Math.round(result.similarity * 100)}% accuracy
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Threshold: 80% to pass</p>
              </div>
            </div>

            {/* Word diff */}
            <div className="glass rounded-xl px-4 py-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">Correct sentence</p>
              <div className="flex flex-wrap gap-1">
                {result.word_results.map((wr, i) => (
                  <span key={i} className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-mono',
                    wr.correct
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-red-500/15 text-red-300 line-through decoration-red-500/50',
                  )}>
                    {wr.word}
                    {!wr.correct && wr.user_word && (
                      <span className="ml-1 no-underline text-amber-400 line-through-none" style={{ textDecoration: 'none' }}>
                        →{wr.user_word}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={handleNext}
              className="w-full py-2.5 rounded-xl font-semibold text-sm glass border border-white/10 text-slate-300 flex items-center justify-center gap-2 hover:bg-white/5 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Next sentence
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

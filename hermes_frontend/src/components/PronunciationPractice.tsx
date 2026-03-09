import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, RotateCcw, Volume2 } from 'lucide-react'
import { api, USER_ID } from '../api/client'
import AudioPlayer from './AudioPlayer'
import { cn } from '../lib/cn'

interface Props {
  bookId: number
}

type RecordState = 'idle' | 'recording' | 'uploading' | 'result'

export default function PronunciationPractice({ bookId }: Props) {
  const [recordState, setRecordState] = useState<RecordState>('idle')
  const [round, setRound] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: sentence, isLoading, refetch } = useQuery({
    queryKey: ['pronunciation-sentence', bookId, round],
    queryFn: () => api.getPronunciationSentence(bookId),
    staleTime: Infinity,
  })

  const checkMutation = useMutation({
    mutationFn: ({ expectedText, audioBlob }: { expectedText: string; audioBlob: Blob }) =>
      api.checkPronunciation(bookId, expectedText, audioBlob),
  })

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        if (sentence) {
          setRecordState('uploading')
          checkMutation.mutate({ expectedText: sentence.text, audioBlob: blob })
        }
      }

      mr.start()
      setRecordState('recording')
      setRecordingSeconds(0)
      timerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    } catch {
      alert('Microphone access denied')
    }
  }, [sentence, checkMutation])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setRecordState('uploading')
  }, [])

  const handleNext = () => {
    setRecordState('idle')
    setRecordingSeconds(0)
    checkMutation.reset()
    setRound((r) => r + 1)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-8">
      <div className="w-5 h-5 border-2 border-violet-500/40 border-t-violet-400 rounded-full animate-spin" />
    </div>
  )

  if (!sentence) return (
    <div className="text-center py-6 text-slate-500 text-sm">No audio available</div>
  )

  const result = checkMutation.data

  return (
    <div className="space-y-4">
      {/* Phrase à lire */}
      <div className="glass rounded-xl px-5 py-4 border border-violet-500/15">
        <p className="text-[10px] text-violet-400/60 font-semibold uppercase tracking-wider mb-2">Read aloud</p>
        <p className="text-base text-slate-100 leading-relaxed font-medium">{sentence.text}</p>

        {/* Référence audio */}
        {sentence.audio_start != null && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Reference:</span>
            <AudioPlayer
              src={api.getAudioUrl(bookId, sentence.file_index)}
              startTime={sentence.audio_start}
              endTime={sentence.audio_end ?? undefined}
              label="Hear native"
              showSpeed
              wordTimestamps={sentence.word_timestamps}
            />
          </div>
        )}
      </div>

      {/* Bouton enregistrement */}
      <AnimatePresence mode="wait">
        {recordState === 'idle' && (
          <motion.button
            key="start"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={startRecording}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white flex items-center justify-center gap-2"
          >
            <Mic className="w-4 h-4" /> Start Recording
          </motion.button>
        )}

        {recordState === 'recording' && (
          <motion.div key="recording" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <div className="flex items-center justify-center gap-3 py-3">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-slate-300 font-mono tabular-nums">
                {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:{String(recordingSeconds % 60).padStart(2, '0')}
              </span>
              <span className="text-xs text-slate-500">recording…</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              onClick={stopRecording}
              className="w-full py-3 rounded-xl font-semibold text-sm bg-red-500/20 border border-red-500/30 text-red-300 flex items-center justify-center gap-2"
            >
              <MicOff className="w-4 h-4" /> Stop & Analyze
            </motion.button>
          </motion.div>
        )}

        {recordState === 'uploading' && (
          <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-3 py-4 text-slate-400 text-sm"
          >
            <div className="w-4 h-4 border-2 border-violet-500/40 border-t-violet-400 rounded-full animate-spin" />
            Analyzing your pronunciation…
          </motion.div>
        )}

        {recordState !== 'recording' && recordState !== 'uploading' && result && (
          <motion.div key="result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {/* Score bar */}
            <div className="glass rounded-xl px-4 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-200">Pronunciation score</span>
                <span className={cn(
                  'text-lg font-bold tabular-nums',
                  result.similarity >= 0.85 ? 'text-emerald-400' :
                  result.similarity >= 0.65 ? 'text-amber-400' : 'text-red-400'
                )}>
                  {Math.round(result.similarity * 100)}%
                </span>
              </div>
              <div className="h-2 w-full bg-white/[0.06] rounded-full overflow-hidden">
                <motion.div
                  className={cn(
                    'h-full rounded-full',
                    result.similarity >= 0.85 ? 'bg-emerald-500' :
                    result.similarity >= 0.65 ? 'bg-amber-500' : 'bg-red-500'
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${result.similarity * 100}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
            </div>

            {/* Feedback IA */}
            <div className="glass rounded-xl px-4 py-3 border border-violet-500/15">
              <p className="text-xs text-slate-400 italic">{result.feedback}</p>
            </div>

            {/* Transcription */}
            <div className="glass rounded-xl px-4 py-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Whisper heard</p>
              <div className="flex flex-wrap gap-1">
                {result.word_results.map((wr, i) => (
                  <span key={i} className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-mono',
                    wr.correct ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300',
                  )}>
                    {wr.word}
                    {!wr.correct && wr.user_word && (
                      <span className="text-amber-400 ml-1">←{wr.user_word}</span>
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

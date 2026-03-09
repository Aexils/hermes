import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Volume2, Loader2, AlertCircle, Pause } from 'lucide-react'
import { cn } from '../lib/cn'

interface WordTimestamp {
  word: string
  start: number
  end: number
}

interface AudioPlayerProps {
  src: string
  startTime?: number
  endTime?: number
  label?: string
  className?: string
  showSpeed?: boolean
  wordTimestamps?: WordTimestamp[] | null
}

type State = 'idle' | 'loading' | 'playing' | 'done' | 'error'

const SPEEDS = [0.75, 1, 1.25] as const

export default function AudioPlayer({
  src, startTime, endTime, label, className, showSpeed = false, wordTimestamps,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<State>('idle')
  const [speed, setSpeed] = useState<number>(1)
  const [activeWordIdx, setActiveWordIdx] = useState<number>(-1)

  useEffect(() => {
    return () => { audioRef.current?.pause() }
  }, [])

  const handlePlay = useCallback(() => {
    if (state === 'playing') {
      audioRef.current?.pause()
      setState('done')
      setActiveWordIdx(-1)
      return
    }

    setState('loading')
    setActiveWordIdx(-1)
    const audio = new Audio(src)
    audio.playbackRate = speed
    audioRef.current = audio

    audio.addEventListener('canplay', () => {
      if (startTime != null) audio.currentTime = startTime
      setState('playing')
      audio.play().catch(() => setState('error'))
    })

    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime

      // Highlight du mot actif
      if (wordTimestamps?.length) {
        const offset = startTime ?? 0
        const relT = t - offset
        const idx = wordTimestamps.findIndex(
          (w) => relT >= w.start && relT <= w.end
        )
        setActiveWordIdx(idx)
      }

      if (endTime != null && t >= endTime) {
        audio.pause()
        setState('done')
        setActiveWordIdx(-1)
      }
    })

    audio.addEventListener('ended', () => { setState('done'); setActiveWordIdx(-1) })
    audio.addEventListener('error', () => setState('error'))
    audio.load()
  }, [state, src, speed, startTime, endTime, wordTimestamps])

  // Mise à jour de la vitesse si changée pendant la lecture
  const handleSpeed = useCallback((s: number) => {
    setSpeed(s)
    if (audioRef.current) audioRef.current.playbackRate = s
  }, [])

  const icon =
    state === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> :
    state === 'error'   ? <AlertCircle className="w-3 h-3" /> :
    state === 'playing' ? <Pause className="w-3 h-3" /> :
    <Volume2 className="w-3 h-3" />

  const label_ =
    state === 'loading' ? 'Loading…' :
    state === 'playing' ? 'Pause' :
    state === 'error'   ? 'Error' :
    state === 'done'    ? 'Replay' :
    (label ?? 'Hear it')

  return (
    <div className={cn('inline-flex items-center gap-1.5 flex-wrap', className)}>
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.96 }}
        onClick={handlePlay}
        disabled={state === 'loading'}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-200',
          state === 'playing'
            ? 'bg-teal-500/20 border border-teal-500/40 text-teal-300'
            : state === 'error'
              ? 'bg-red-500/10 border border-red-500/30 text-red-400'
              : 'bg-teal-500/10 border border-teal-500/20 text-teal-400 hover:bg-teal-500/15',
        )}
      >
        {icon}
        {label_}
      </motion.button>

      {showSpeed && (
        <div className="inline-flex items-center gap-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => handleSpeed(s)}
              className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors',
                speed === s
                  ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
              )}
            >
              {s}×
            </button>
          ))}
        </div>
      )}

      {/* Highlight mot par mot (si word_timestamps disponibles) */}
      {wordTimestamps && wordTimestamps.length > 0 && (state === 'playing' || state === 'done') && (
        <div className="w-full mt-2 flex flex-wrap gap-1">
          {wordTimestamps.map((w, i) => (
            <span
              key={i}
              className={cn(
                'text-xs px-1 py-0.5 rounded transition-all duration-100',
                i === activeWordIdx
                  ? 'bg-teal-500/30 text-teal-200 font-semibold scale-105'
                  : i < activeWordIdx
                    ? 'text-slate-400'
                    : 'text-slate-500',
              )}
            >
              {w.word}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

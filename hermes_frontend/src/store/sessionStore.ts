import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Exercise, AnswerResult, DailyBatch, Anecdote } from '../api/types'

interface SessionStore {
  exercises: Exercise[]
  currentIndex: number
  answers: Record<number, AnswerResult>
  xpTotal: number
  sessionActive: boolean
  batchId: number | null
  // Métadonnées persistées pour éviter un refetch au refresh
  bookTitle: string
  chapterTitle: string
  anecdotes: Anecdote[]

  initSession: (batch: DailyBatch) => void
  recordAnswer: (exerciseId: number, result: AnswerResult) => void
  nextExercise: () => void
  resetSession: () => void
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      exercises: [],
      currentIndex: 0,
      answers: {},
      xpTotal: 0,
      sessionActive: false,
      batchId: null,
      bookTitle: '',
      chapterTitle: '',
      anecdotes: [],

      initSession: (batch) => set({
        exercises: [...batch.comprehension, ...batch.grammar, ...batch.vocabulary],
        currentIndex: 0,
        answers: {},
        xpTotal: 0,
        sessionActive: true,
        batchId: batch.batch_id,
        bookTitle: batch.book_title,
        chapterTitle: batch.chapter_title,
        anecdotes: batch.anecdotes ?? [],
      }),

      recordAnswer: (exerciseId, result) => set((state) => {
        if (state.answers[exerciseId]) return {}
        return {
          answers: { ...state.answers, [exerciseId]: result },
          xpTotal: state.xpTotal + (result.correct ? 10 : 2),
        }
      }),

      nextExercise: () => set((state) => ({
        currentIndex: state.currentIndex + 1,
      })),

      resetSession: () => set({
        exercises: [],
        currentIndex: 0,
        answers: {},
        xpTotal: 0,
        sessionActive: false,
        batchId: null,
        bookTitle: '',
        chapterTitle: '',
        anecdotes: [],
      }),
    }),
    { name: 'hermes-session' }
  )
)

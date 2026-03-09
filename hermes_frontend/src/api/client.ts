import type {
  DailyBatch, AnswerResult, UserStats,
  WeaknessReport, SyncResult, Book, Chapter, Anecdote, AudioTimestamp, SystemStatus,
  AdminBatch, AdminOverview,
  ExerciseRow, BookRow, ChapterRow, UserRow, AttemptRow,
  AudioContextResult, AbsItem, UserDetailStats, UserCreate, ActivityDay,
  DictationChallenge, DictationResult, PronunciationSentence, PronunciationResult,
} from './types'

const BASE = '/api'
export const USER_ID = 1

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getDailyBatch: (params?: { book_id?: number; scope?: string; chapter_id?: number; grammar_count?: number; vocab_count?: number; comprehension_count?: number }) => {
    const qs = new URLSearchParams()
    if (params?.book_id != null) qs.set('book_id', String(params.book_id))
    if (params?.scope) qs.set('scope', params.scope)
    if (params?.chapter_id != null) qs.set('chapter_id', String(params.chapter_id))
    if (params?.grammar_count != null) qs.set('grammar_count', String(params.grammar_count))
    if (params?.vocab_count != null) qs.set('vocab_count', String(params.vocab_count))
    if (params?.comprehension_count != null) qs.set('comprehension_count', String(params.comprehension_count))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<DailyBatch>(`/daily/${USER_ID}${query}`)
  },

  submitAnswer: (exerciseId: number, answer: string, timeTakenMs?: number, isLast?: boolean) =>
    apiFetch<AnswerResult>(`/submit/${USER_ID}/${exerciseId}`, {
      method: 'POST',
      body: JSON.stringify({ answer, time_taken_ms: timeTakenMs ?? null, is_last: isLast ?? false }),
    }),

  getStats: () =>
    apiFetch<UserStats>(`/stats/${USER_ID}`),

  getWeaknesses: () =>
    apiFetch<WeaknessReport>(`/stats/${USER_ID}/weaknesses`),

  getActivity: (userId = USER_ID, days = 35) =>
    apiFetch<ActivityDay[]>(`/stats/${userId}/activity?days=${days}`),

  syncBooklore: () =>
    apiFetch<SyncResult>('/progress/sync/booklore', { method: 'POST' }),

  getBooks: () =>
    apiFetch<Book[]>('/books/'),

  getBookChapters: (bookId: number) =>
    apiFetch<Chapter[]>(`/books/${bookId}/chapters`),

  getBookAnecdotes: (bookId: number) =>
    apiFetch<{ anecdotes: Anecdote[] }>(`/books/${bookId}/anecdotes`),

  syncAudiobookshelf: () =>
    apiFetch<{ synced: boolean; found: number; new: number; updated: number }>(
      '/books/sync/audiobookshelf', { method: 'POST' }
    ),

  startTranscription: (bookId: number) =>
    apiFetch<{ message: string }>(`/books/${bookId}/transcribe`, { method: 'POST' }),

  getTranscriptionStatus: (bookId: number) =>
    apiFetch<{ book_id: number; transcribed: boolean; status: string }>(`/books/${bookId}/transcription/status`),

  getAudioTimestamp: (bookId: number, text: string) =>
    apiFetch<AudioTimestamp>(`/books/${bookId}/audio/lookup?text=${encodeURIComponent(text)}`),

  getAudioUrl: (bookId: number, fileIndex = 0) =>
    `${BASE}/books/${bookId}/audio/${fileIndex}`,

  getStatus: () => apiFetch<SystemStatus>('/status'),

  getAdminBatches: () => apiFetch<AdminBatch[]>('/admin/batches'),
  getAdminOverview: () => apiFetch<AdminOverview>('/admin/overview'),
  adminGenerate: (payload: { batch_type: string; grammar_focus?: string | null; chapter_ids: number[] }) =>
    apiFetch<AdminBatch>('/admin/generate', { method: 'POST', body: JSON.stringify(payload) }),
  deleteAdminBatch: (id: number) => apiFetch<{ deleted: number }>(`/admin/batches/${id}`, { method: 'DELETE' }),

  // DB CRUD
  getDbExercises: (params?: { batch_id?: number; type?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.batch_id != null) qs.set('batch_id', String(params.batch_id))
    if (params?.type) qs.set('type', params.type)
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<ExerciseRow[]>(`/admin/db/exercises${query}`)
  },
  patchDbExercise: (id: number, data: Partial<{ question: string; correct_answer: string; options: string[] | null; grammar_category: string | null; vocabulary_item: string | null }>) =>
    apiFetch<{ updated: number }>(`/admin/db/exercises/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDbExercise: (id: number) =>
    apiFetch<{ deleted: number }>(`/admin/db/exercises/${id}`, { method: 'DELETE' }),

  getAudioContext: (bookId: number, text: string) =>
    apiFetch<AudioContextResult>(`/books/${bookId}/audio/context?text=${encodeURIComponent(text)}`),

  getAbsItems: () => apiFetch<AbsItem[]>('/books/abs/items'),

  getDbBooks: () => apiFetch<BookRow[]>('/admin/db/books'),
  patchDbBook: (id: number, data: Partial<{ title: string; author: string | null; parsed: boolean; audio_item_id: string | null; audio_path: string | null }>) =>
    apiFetch<{ updated: number }>(`/admin/db/books/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDbBook: (id: number) =>
    apiFetch<{ deleted: number }>(`/admin/db/books/${id}`, { method: 'DELETE' }),

  getDbChapters: (book_id?: number) => {
    const qs = book_id != null ? `?book_id=${book_id}` : ''
    return apiFetch<ChapterRow[]>(`/admin/db/chapters${qs}`)
  },
  patchDbChapter: (id: number, data: Partial<{ title: string; order_index: number }>) =>
    apiFetch<{ updated: number }>(`/admin/db/chapters/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDbChapter: (id: number) =>
    apiFetch<{ deleted: number }>(`/admin/db/chapters/${id}`, { method: 'DELETE' }),

  getDbUsers: () => apiFetch<UserRow[]>('/admin/db/users'),
  createDbUser: (data: UserCreate) =>
    apiFetch<UserRow>('/admin/db/users', { method: 'POST', body: JSON.stringify(data) }),
  getUserStats: (userId: number) =>
    apiFetch<UserDetailStats>(`/admin/db/users/${userId}/stats`),
  resetUserScores: (userId: number, data: { grammar?: boolean; vocabulary?: boolean }) =>
    apiFetch<{ reset: boolean }>(`/admin/db/users/${userId}/reset-scores`, { method: 'POST', body: JSON.stringify(data) }),
  patchDbUser: (id: number, data: Partial<{ cefr_level: string; cefr_streak: number; grammar_scores: Record<string, number>; vocabulary_mastery: Record<string, number> }>) =>
    apiFetch<{ updated: number }>(`/admin/db/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDbUser: (id: number) =>
    apiFetch<{ deleted: number }>(`/admin/db/users/${id}`, { method: 'DELETE' }),

  getDbAttempts: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.limit != null) qs.set('limit', String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const query = qs.toString() ? `?${qs.toString()}` : ''
    return apiFetch<AttemptRow[]>(`/admin/db/attempts${query}`)
  },
  deleteDbAttempt: (id: number) =>
    apiFetch<{ deleted: number }>(`/admin/db/attempts/${id}`, { method: 'DELETE' }),

  flagQuestion: (exerciseId: number, reason?: string) =>
    apiFetch<{ flagged: number; question: string }>(`/admin/flag-question/${exerciseId}`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason ?? 'Ambiguous: multiple valid answers reported by user' }),
    }),

  resetDb: (username: string, cefr_level: string) =>
    apiFetch<{ reset: boolean; user_id: number; username: string }>('/admin/db/reset', {
      method: 'POST',
      body: JSON.stringify({ username, cefr_level }),
    }),

  // Audio practice
  getDictationChallenge: (bookId: number) =>
    apiFetch<DictationChallenge>(`/audio-practice/${bookId}/dictation`),

  checkDictation: (bookId: number, sentenceId: number, userText: string) =>
    apiFetch<DictationResult>(`/audio-practice/${bookId}/dictation/check`, {
      method: 'POST',
      body: JSON.stringify({ sentence_id: sentenceId, user_text: userText }),
    }),

  getPronunciationSentence: (bookId: number) =>
    apiFetch<PronunciationSentence>(`/audio-practice/${bookId}/pronunciation/sentence`),

  checkPronunciation: async (bookId: number, expectedText: string, audioBlob: Blob): Promise<PronunciationResult> => {
    const form = new FormData()
    form.append('expected_text', expectedText)
    form.append('audio', audioBlob, 'recording.webm')
    const res = await fetch(`${BASE}/audio-practice/${bookId}/pronunciation/check`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText)
      throw new Error(`${res.status}: ${text}`)
    }
    return res.json() as Promise<PronunciationResult>
  },
}

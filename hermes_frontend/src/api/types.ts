export type ExerciseType = 'comprehension' | 'grammar' | 'vocabulary'

export interface Exercise {
  id: number
  type: ExerciseType
  subtype: string
  question: string
  options: string[] | null
  grammar_category: string | null
  vocabulary_item: string | null
  source_passage: string | null
}

export interface Chapter {
  id: number
  title: string
  order_index: number
}

export interface Anecdote {
  text: string
  source: string
}

export interface DailyBatch {
  batch_id: number
  chapter_title: string
  book_title: string
  comprehension: Exercise[]
  grammar: Exercise[]
  vocabulary: Exercise[]
  total_exercises: number
  scope: string
  anecdotes: Anecdote[]
}

export interface SpellingError {
  word: string
  suggestion: string
}

export interface AnswerResult {
  correct: boolean
  correct_answer: string
  explanation?: string | null
  new_grammar_score?: number | null
  new_vocab_score?: number | null
  cefr_changed?: string | null
  spelling_errors: SpellingError[]
  // Post-session (uniquement sur le dernier exercice)
  session_summary?: string | null
  session_focus_area?: string | null
  learner_profile?: string | null
}

export interface UserStats {
  id: number
  username: string
  cefr_level: string
  grammar_scores: Record<string, number>
  vocabulary_mastery: Record<string, number>
}

export interface WeaknessReport {
  weakest_grammar: Array<{ category: string; score: number }>
  weakest_vocabulary: Array<{ word: string; score: number }>
  recommended_focus: string[]
}

export interface SyncResult {
  synced_from: string
  new_chapters_detected: number
  batches_queued: number
  parsing_books: string[]
}

export interface Book {
  id: number
  title: string
  author: string
  file_path: string
  format: string
  parsed: boolean
  audio_item_id: string | null
  audio_path: string | null
  transcribed: boolean
  transcription_status: 'none' | 'pending' | 'running' | 'done' | 'failed'
}

export interface WordTimestamp {
  word: string
  start: number
  end: number
}

export interface DictationChallenge {
  sentence_id: number
  audio_start: number
  audio_end: number
  file_index: number
  word_count: number
  book_id: number
  word_timestamps: WordTimestamp[] | null
}

export interface WordResult {
  word: string
  correct: boolean
  user_word: string | null
}

export interface DictationResult {
  correct_text: string
  user_text: string
  similarity: number
  word_results: WordResult[]
  passed: boolean
}

export interface PronunciationSentence {
  sentence_id: number
  text: string
  audio_start: number | null
  audio_end: number | null
  file_index: number
  word_timestamps: WordTimestamp[] | null
}

export interface PronunciationResult {
  expected_text: string
  user_text: string
  similarity: number
  word_results: WordResult[]
  feedback: string
}

export interface AudioTimestamp {
  found: boolean
  file_index?: number
  audio_start?: number
  audio_end?: number
}

export interface AudioContextSentence {
  role: 'before' | 'match' | 'after'
  text: string
  audio_start: number
  audio_end: number
  file_index: number
}

export interface AudioContextResult {
  found: boolean
  sentences?: AudioContextSentence[]
  audio_start?: number
  audio_end?: number
  file_index?: number
}

export interface AbsItem {
  id: string
  title: string
  duration: number | null
  matched_book_id: number | null
}


export interface AdminBatch {
  id: number
  generated_at: string
  batch_type: string
  grammar_focus: string | null
  model_used: string | null
  book_title: string
  chapter_title: string
  cefr_level: string
  exercise_count: number
  comprehension_count: number
  grammar_count: number
  vocabulary_count: number
  pre_generated: boolean
  valid_for_date: string | null
}

export interface AdminOverview {
  total_batches: number
  batches_today: number
  total_exercises: number
  models_used: Record<string, number>
  batches_by_type: Record<string, number>
  user: { cefr_level: string; cefr_streak: number }
}

export interface SystemStatus {
  user: { id: number; username: string; cefr: string } | null
  books: { total: number; parsed: number }
  reading_progress_entries: number
  ready: boolean
}

export interface ExerciseRow {
  id: number
  batch_id: number | null
  type: string
  subtype: string | null
  question: string
  correct_answer: string
  options: string[] | null
  grammar_category: string | null
  vocabulary_item: string | null
  book_title: string
  chapter_title: string
}

export interface BookRow {
  id: number
  title: string
  author: string | null
  parsed: boolean
  transcribed: boolean
  transcription_status: string
  audio_item_id: string | null
  audio_path: string | null
}

export interface ChapterRow {
  id: number
  book_id: number
  book_title: string
  title: string | null
  order_index: number
}

export interface UserRow {
  id: number
  username: string
  cefr_level: string
  cefr_streak: number
  grammar_scores: Record<string, number>
  vocabulary_mastery: Record<string, number>
  created_at?: string | null
}

export interface UserDetailStats {
  total_exercises: number
  exercises_correct: number
  success_rate: number
  last_active: string | null
  active_days: number
  created_at: string | null
}

export interface UserCreate {
  username: string
  cefr_level?: string
}

export interface ActivityDay {
  date: string   // "YYYY-MM-DD"
  count: number
}

export interface AttemptRow {
  id: number
  exercise_id: number
  question: string
  user_answer: string | null
  is_correct: boolean
  attempted_at: string
}

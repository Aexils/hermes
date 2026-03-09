import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { X, BookOpen, ChevronRight, BookMarked } from 'lucide-react'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import type { Book, Chapter } from '../api/types'

interface Props {
  onClose: () => void
}

type Step = 'book' | 'scope' | 'chapter'

export default function BookSelectorModal({ onClose }: Props) {
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('book')
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [selectedScope, setSelectedScope] = useState<'chapter' | 'book'>('chapter')
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null)

  const { data: books = [], isLoading: booksLoading } = useQuery({
    queryKey: ['books'],
    queryFn: api.getBooks,
  })

  const { data: chapters = [], isLoading: chaptersLoading } = useQuery({
    queryKey: ['chapters', selectedBook?.id],
    queryFn: () => api.getBookChapters(selectedBook!.id),
    enabled: !!selectedBook && step === 'chapter',
  })

  const parsedBooks = books.filter((b) => b.parsed)

  function handleStart() {
    if (!selectedBook) return
    const params: { book_id: number; scope: string; chapter_id?: number } = {
      book_id: selectedBook.id,
      scope: selectedScope,
    }
    if (selectedScope === 'chapter' && selectedChapter) {
      params.chapter_id = selectedChapter.id
    }
    navigate('/session', { state: { sessionParams: params } })
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="modal"
          initial={{ opacity: 0, y: 40, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.97 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full max-w-sm glass rounded-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Practice a Book</h2>
              <div className="flex items-center gap-1.5 mt-1">
                {(['book', 'scope', selectedScope === 'chapter' ? 'chapter' : null] as const)
                  .filter(Boolean)
                  .map((s, i, arr) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className={cn(
                        'text-[10px] font-semibold uppercase tracking-wider',
                        step === s ? 'text-violet-400' : 'text-slate-600'
                      )}>
                        {s === 'book' ? 'Book' : s === 'scope' ? 'Mode' : 'Chapter'}
                      </span>
                      {i < arr.length - 1 && <ChevronRight className="w-2.5 h-2.5 text-slate-700" />}
                    </span>
                  ))}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 min-h-[200px]">
            {step === 'book' && (
              <BookStep
                books={parsedBooks}
                loading={booksLoading}
                onSelect={(book) => { setSelectedBook(book); setStep('scope') }}
              />
            )}
            {step === 'scope' && selectedBook && (
              <ScopeStep
                book={selectedBook}
                onSelect={(scope) => {
                  setSelectedScope(scope)
                  if (scope === 'chapter') {
                    setStep('chapter')
                  } else {
                    // Navigate immediately for whole-book (no chapter to pick)
                    if (!selectedBook) return
                    navigate('/session', {
                      state: { sessionParams: { book_id: selectedBook.id, scope: 'book' } },
                    })
                  }
                }}
              />
            )}
            {step === 'chapter' && selectedBook && (
              <ChapterStep
                chapters={chapters}
                loading={chaptersLoading}
                selected={selectedChapter}
                onSelect={setSelectedChapter}
              />
            )}
          </div>

          {/* Footer */}
          {step === 'chapter' && (
            <div className="px-5 pb-5">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleStart}
                disabled={!selectedChapter && chapters.length > 0}
                className="w-full py-3 rounded-xl font-semibold text-sm bg-gradient-to-r from-violet-600 to-purple-600 text-white flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:from-violet-500 hover:to-purple-500 transition-all duration-200"
              >
                Start Session <ChevronRight className="w-4 h-4" />
              </motion.button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function BookStep({ books, loading, onSelect }: {
  books: Book[]; loading: boolean; onSelect: (b: Book) => void
}) {
  if (loading) return <ListSkeleton />
  if (books.length === 0) return (
    <div className="text-center py-8">
      <BookOpen className="w-8 h-8 text-slate-600 mx-auto mb-2" />
      <p className="text-slate-500 text-sm">No parsed books yet</p>
      <p className="text-slate-600 text-xs mt-1">Parse a book via POST /books/parse</p>
    </div>
  )
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 mb-3">Select a book</p>
      {books.map((book) => (
        <motion.button
          key={book.id}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onSelect(book)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-150 text-left"
        >
          <BookOpen className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{book.title}</p>
            {book.author && <p className="text-xs text-slate-500 truncate">{book.author}</p>}
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
        </motion.button>
      ))}
    </div>
  )
}

function ScopeStep({ book, onSelect }: { book: Book; onSelect: (s: 'chapter' | 'book') => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 mb-3">
        <span className="text-slate-300 font-medium">{book.title}</span> — choose mode
      </p>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onSelect('chapter')}
        className="w-full flex items-start gap-3 px-4 py-4 rounded-xl border border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-150 text-left"
      >
        <BookOpen className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-slate-200">By Chapter</p>
          <p className="text-xs text-slate-500 mt-0.5">5 comprehension + grammar + vocabulary questions from a single chapter</p>
        </div>
      </motion.button>
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => onSelect('book')}
        className="w-full flex items-start gap-3 px-4 py-4 rounded-xl border border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-150 text-left"
      >
        <BookMarked className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-slate-200">Whole Book</p>
          <p className="text-xs text-slate-500 mt-0.5">8 cross-chapter questions — character arcs, motifs, timeline</p>
        </div>
      </motion.button>
    </div>
  )
}

function ChapterStep({ chapters, loading, selected, onSelect }: {
  chapters: Chapter[]; loading: boolean; selected: Chapter | null; onSelect: (c: Chapter) => void
}) {
  if (loading) return <ListSkeleton />
  if (chapters.length === 0) return (
    <p className="text-slate-500 text-sm text-center py-8">No chapters found</p>
  )
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 mb-3">Select a chapter</p>
      <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
        {chapters.map((ch) => (
          <motion.button
            key={ch.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(ch)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all duration-150',
              selected?.id === ch.id
                ? 'border-violet-500/50 bg-violet-500/10'
                : 'border-white/[0.06] hover:border-violet-500/20 hover:bg-violet-500/5'
            )}
          >
            <span className={cn(
              'text-xs font-mono shrink-0 w-6 text-center',
              selected?.id === ch.id ? 'text-violet-400' : 'text-slate-600'
            )}>
              {ch.order_index + 1}
            </span>
            <span className="text-sm text-slate-200 truncate">{ch.title || `Chapter ${ch.order_index + 1}`}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded-xl bg-white/[0.04]" />
      ))}
    </div>
  )
}

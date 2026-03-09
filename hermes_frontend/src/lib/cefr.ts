export const CEFR_LEVELS = [
  'A1', 'A1+',
  'A2-', 'A2', 'A2+',
  'B1-', 'B1', 'B1+',
  'B2-', 'B2', 'B2+',
  'C1-', 'C1', 'C1+',
  'C2',
] as const

export type CEFRLevel = typeof CEFR_LEVELS[number]

type CEFRConfig = { color: string; bg: string; label: string; emoji: string }

const CEFR_CONFIG: Record<string, CEFRConfig> = {
  'A1':  { color: 'text-slate-300',  bg: 'bg-slate-600/30 border-slate-500/50',   label: 'Beginner',        emoji: '🌱' },
  'A1+': { color: 'text-slate-300',  bg: 'bg-slate-600/30 border-slate-500/50',   label: 'Beginner+',       emoji: '🌱' },
  'A2-': { color: 'text-green-300',  bg: 'bg-green-800/30 border-green-600/50',   label: 'Elementary',      emoji: '🌿' },
  'A2':  { color: 'text-green-300',  bg: 'bg-green-700/30 border-green-600/50',   label: 'Elementary',      emoji: '🌿' },
  'A2+': { color: 'text-green-200',  bg: 'bg-green-700/30 border-green-500/50',   label: 'Elementary+',     emoji: '🌿' },
  'B1-': { color: 'text-blue-300',   bg: 'bg-blue-800/30 border-blue-600/50',     label: 'Intermediate',    emoji: '💧' },
  'B1':  { color: 'text-blue-300',   bg: 'bg-blue-700/30 border-blue-600/50',     label: 'Intermediate',    emoji: '💧' },
  'B1+': { color: 'text-blue-200',   bg: 'bg-blue-700/30 border-blue-500/50',     label: 'Intermediate+',   emoji: '💧' },
  'B2-': { color: 'text-indigo-300', bg: 'bg-indigo-800/30 border-indigo-600/50', label: 'Upper-Inter.',    emoji: '⚡' },
  'B2':  { color: 'text-indigo-300', bg: 'bg-indigo-700/30 border-indigo-600/50', label: 'Upper-Inter.',    emoji: '⚡' },
  'B2+': { color: 'text-indigo-200', bg: 'bg-indigo-700/30 border-indigo-500/50', label: 'Upper-Inter.+',   emoji: '⚡' },
  'C1-': { color: 'text-purple-300', bg: 'bg-purple-800/30 border-purple-600/50', label: 'Advanced',        emoji: '🔮' },
  'C1':  { color: 'text-purple-300', bg: 'bg-purple-700/30 border-purple-600/50', label: 'Advanced',        emoji: '🔮' },
  'C1+': { color: 'text-purple-200', bg: 'bg-purple-700/30 border-purple-500/50', label: 'Advanced+',       emoji: '🔮' },
  'C2':  { color: 'text-amber-300',  bg: 'bg-amber-700/30 border-amber-500/50',   label: 'Proficiency',     emoji: '👑' },
}

export function getCEFRConfig(level: string): CEFRConfig {
  return CEFR_CONFIG[level] ?? CEFR_CONFIG['B1']
}

export function getNextCEFR(level: string): string | null {
  const idx = CEFR_LEVELS.indexOf(level as CEFRLevel)
  return idx >= 0 && idx < CEFR_LEVELS.length - 1 ? CEFR_LEVELS[idx + 1] : null
}

export function getCEFRProgress(level: string): number {
  const idx = CEFR_LEVELS.indexOf(level as CEFRLevel)
  return idx >= 0 ? ((idx + 1) / CEFR_LEVELS.length) * 100 : 0
}

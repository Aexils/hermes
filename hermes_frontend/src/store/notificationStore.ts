import { create } from 'zustand'

export type NotifStatus = 'loading' | 'success' | 'error'

export interface Notification {
  id: string
  title: string
  detail?: string
  progress: number | null  // null = indeterminate, 0-100 = determinate
  status: NotifStatus
}

interface NotificationStore {
  items: Notification[]
  push: (n: Omit<Notification, 'id'>) => string
  update: (id: string, patch: Partial<Omit<Notification, 'id'>>) => void
  dismiss: (id: string) => void
}

let _seq = 0

export const useNotificationStore = create<NotificationStore>((set) => ({
  items: [],

  push: (n) => {
    const id = `notif-${++_seq}`
    set((s) => ({ items: [...s.items, { ...n, id }] }))
    return id
  },

  update: (id, patch) =>
    set((s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),

  dismiss: (id) =>
    set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
}))

/** Utilitaire : push loading → auto-update success/error, auto-dismiss */
export function useNotify() {
  const { push, update, dismiss } = useNotificationStore()

  const notify = {
    loading: (title: string, detail?: string) =>
      push({ title, detail, progress: null, status: 'loading' }),

    progress: (id: string, pct: number, detail?: string) =>
      update(id, { progress: pct, ...(detail ? { detail } : {}) }),

    success: (id: string, title: string, detail?: string, autoDismissMs = 4000) => {
      update(id, { title, detail, status: 'success', progress: 100 })
      setTimeout(() => dismiss(id), autoDismissMs)
    },

    error: (id: string, title: string, detail?: string, autoDismissMs = 6000) => {
      update(id, { title, detail, status: 'error', progress: null })
      setTimeout(() => dismiss(id), autoDismissMs)
    },
  }

  return notify
}

import { type ReactNode } from 'react'
import NavBar from './NavBar'

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#06060f] text-slate-100 overflow-x-hidden">
      {/* Aurora background */}
      <div className="fixed inset-0 pointer-events-none z-0 animate-aurora">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-violet-600/8 blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] rounded-full bg-blue-600/6 blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 w-[400px] h-[400px] rounded-full bg-emerald-600/5 blur-[100px]" />
      </div>

      {/* Grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-0 opacity-[0.025]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(168,85,247,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(168,85,247,0.5) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 flex flex-col min-h-screen">
        <NavBar />
        <main className="flex-1 pt-8 pb-24 container mx-auto max-w-4xl px-5 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}

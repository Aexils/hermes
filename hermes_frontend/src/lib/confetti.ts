import confetti from 'canvas-confetti'

export function triggerConfetti() {
  confetti({
    particleCount: 90,
    spread: 65,
    origin: { y: 0.65 },
    colors: ['#a855f7', '#ec4899', '#06b6d4', '#10b981', '#f59e0b'],
    gravity: 1.2,
    scalar: 0.9,
  })
}

export function triggerMiniConfetti(x: number, y: number) {
  confetti({
    particleCount: 30,
    spread: 40,
    origin: {
      x: x / window.innerWidth,
      y: y / window.innerHeight,
    },
    colors: ['#a855f7', '#10b981'],
    scalar: 0.7,
    gravity: 1.5,
  })
}

export function triggerCompletion() {
  const end = Date.now() + 2500
  const interval = setInterval(() => {
    if (Date.now() > end) return clearInterval(interval)
    confetti({
      particleCount: 4,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#a855f7', '#ec4899', '#06b6d4'],
    })
    confetti({
      particleCount: 4,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#10b981', '#f59e0b', '#a855f7'],
    })
  }, 120)
}

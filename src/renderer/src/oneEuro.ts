// Compact 1€ filter (Casiez et al.) — smooths noisy signals while staying
// responsive: low lag when moving fast, strong smoothing when nearly still.

class LowPass {
  private y: number | null = null
  private s: number | null = null

  filter(value: number, alpha: number): number {
    this.s = this.y === null ? value : alpha * value + (1 - alpha) * (this.s as number)
    this.y = value
    return this.s
  }

  hasLast(): boolean {
    return this.y !== null
  }

  last(): number {
    return this.s ?? 0
  }
}

export class OneEuroFilter {
  private xFilter = new LowPass()
  private dxFilter = new LowPass()
  private lastTime: number | null = null
  private prev = 0

  constructor(
    private minCutoff = 1.0,
    private beta = 0.007,
    private dCutoff = 1.0
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, timestamp: number): number {
    let dt = this.lastTime === null ? 1 / 60 : (timestamp - this.lastTime) / 1000
    if (dt <= 0) dt = 1 / 60
    this.lastTime = timestamp

    const dx = this.xFilter.hasLast() ? (value - this.prev) / dt : 0
    this.prev = value
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    return this.xFilter.filter(value, this.alpha(cutoff, dt))
  }

  reset(): void {
    this.xFilter = new LowPass()
    this.dxFilter = new LowPass()
    this.lastTime = null
    this.prev = 0
  }
}

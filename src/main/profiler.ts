import { profiler } from '@qvac/sdk'

export function initProfiler(): void {
  profiler.enable({ mode: 'verbose' })
}

let sampleCount = 0

/** Logs a profiler table snapshot every `everyN` calls. */
export function logProfilerSample(everyN = 5): void {
  sampleCount += 1
  if (sampleCount % everyN === 0) {
    console.log(profiler.exportTable())
  }
}

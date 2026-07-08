import { writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

/** Writes a captured JPEG buffer to a fixed temp path, overwriting each call. */
export async function saveFrame(buffer: ArrayBuffer): Promise<string> {
  const framePath = join(tmpdir(), 'frame.jpg')
  await writeFile(framePath, Buffer.from(buffer))
  return framePath
}

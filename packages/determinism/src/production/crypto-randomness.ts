import type { Randomness } from '../types'

/** Production Randomness backed by the platform CSPRNG (`crypto.getRandomValues`). */
export class CryptoRandomness implements Randomness {
  next(): number {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return (buf[0] ?? 0) / 0x1_0000_0000
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
}

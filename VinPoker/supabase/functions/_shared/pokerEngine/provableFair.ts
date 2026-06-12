// supabase/functions/_shared/pokerEngine/provableFair.ts
//
// OPTIONAL provable-fairness (roadmap GE-5 / Phase-3). NOT wired into Phase-1
// dealing — production deals use shuffle.ts:cryptoRng32 (a full CSPRNG).
//
// FIX for review finding SC-1/SC-2: the prior scaffold seeded a 32-bit splitmix
// state from only 32 bits of the seed (≤2^32 possible decks, brute-forceable).
// This derives the shuffle randomness from an HMAC-SHA256 keystream KEYED BY THE
// ENTIRE 256-bit serverSeed and MIXED with a player-supplied clientSeed + per-hand
// nonce — full key space (>2^225.6 needed for a uniform 52! shuffle), and players
// can contribute entropy and verify after the reveal.
//
// Commit–reveal: server publishes commit = sha256(serverSeed) BEFORE the hand,
// reveals serverSeed AFTER; anyone runs verifyShuffle(...) to confirm.

import type { Card } from './types.ts';
import { makeDeck } from './deck.ts';
import { shuffle, type Rng32 } from './shuffle.ts';

const enc = new TextEncoder();

function bytesToHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return bytesToHex(new Uint8Array(d));
}

/** Cryptographically-random 256-bit server seed (hex). */
export function randomServerSeed(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

/** The value published BEFORE the hand. */
export const commit = (serverSeedHex: string): Promise<string> => sha256Hex(serverSeedHex);

async function hmacKey(serverSeedHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', hexToBytes(serverSeedHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * Full-entropy keystream RNG. HMAC-SHA256(serverSeed, "clientSeed:nonce:counter")
 * yields 8 big-endian uint32 words per block. Pre-generates `words` words (a
 * 52-card shuffle needs ≤51 draws; rejection prob ≈ 1e-8) so the returned rng is sync.
 */
async function keystreamRng32(serverSeedHex: string, clientSeed: string, nonce: number, words = 64): Promise<Rng32> {
  const key = await hmacKey(serverSeedHex);
  const out: number[] = [];
  let counter = 0;
  while (out.length < words) {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${clientSeed}:${nonce}:${counter}`)));
    const dv = new DataView(sig.buffer);
    for (let i = 0; i < sig.length; i += 4) out.push(dv.getUint32(i, false));
    counter++;
  }
  let idx = 0;
  return () => {
    if (idx >= out.length) throw new Error('provableFair keystream exhausted — raise words budget');
    return out[idx++];
  };
}

export async function provablyFairDeck(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
): Promise<{ deck: Card[]; commit: string }> {
  const rng = await keystreamRng32(serverSeedHex, clientSeed, nonce);
  return { deck: shuffle(makeDeck(), rng), commit: await commit(serverSeedHex) };
}

/** Recompute the deck from a revealed seed and confirm it matches the prior commit. */
export async function verifyShuffle(
  serverSeedHex: string,
  clientSeed: string,
  nonce: number,
  expectedCommit: string,
): Promise<{ commitOk: boolean; deck: Card[] }> {
  const c = await commit(serverSeedHex);
  const rng = await keystreamRng32(serverSeedHex, clientSeed, nonce);
  return { commitOk: c === expectedCommit, deck: shuffle(makeDeck(), rng) };
}

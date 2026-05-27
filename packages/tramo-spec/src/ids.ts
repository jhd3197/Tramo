import { customAlphabet } from 'nanoid';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const makeId = customAlphabet(ALPHABET, 10);

export function newNodeId(): string {
  return `n_${makeId()}`;
}

export function newEdgeId(): string {
  return `e_${makeId()}`;
}

/** Quick visual check that an id looks tramo-shaped. */
export function isTramoId(s: string): boolean {
  return /^[ne]_[0-9a-z]{6,}$/.test(s);
}

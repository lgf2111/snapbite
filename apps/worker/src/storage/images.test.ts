import { describe, expect, it } from 'vitest';
import { base64Bytes, base64FromBytes, base64ToBytes } from './images.js';

describe('base64FromBytes / base64ToBytes', () => {
  it('round-trips every byte value through the fast latin1 path', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;

    const encoded = base64FromBytes(bytes);
    expect(encoded).toBe(btoa(String.fromCharCode(...bytes)));
    expect(base64Bytes(encoded)).toBe(bytes.length);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('round-trips a buffer larger than the old chunk size', () => {
    const bytes = new Uint8Array(200 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;

    const encoded = base64FromBytes(bytes);
    expect(base64Bytes(encoded)).toBe(bytes.length);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('accepts an ArrayBuffer as well as a view', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x80]);
    expect(base64FromBytes(bytes.buffer)).toBe(base64FromBytes(bytes));
  });
});

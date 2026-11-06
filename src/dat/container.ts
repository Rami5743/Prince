/**
 * Reader for the Prince of Persia 1 `.DAT` resource archive.
 *
 * Layout (see docs/file-inventory.md for how this was established):
 *
 *   uint32 indexOffset
 *   uint16 indexSize
 *   ... resource payloads ...
 *   at indexOffset:
 *     uint16 itemCount
 *     itemCount * { uint16 id; uint32 offset; uint16 size }
 *
 * Each resource is stored as one checksum byte at `offset`, followed by
 * `size` payload bytes. The next resource begins at `offset + size + 1`.
 * The checksum satisfies  (checksum + sum(payload)) mod 256 === 0xFF.
 */

export interface DatEntry {
  readonly id: number;
  /** Offset of the checksum byte within the file. */
  readonly offset: number;
  /** Length of the payload, excluding the checksum byte. */
  readonly size: number;
}

export class DatFile {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly indexOffset: number;
  readonly indexSize: number;
  readonly entries: readonly DatEntry[];
  private readonly byId: Map<number, DatEntry>;

  constructor(bytes: Uint8Array, name = '<dat>') {
    this.bytes = bytes;
    this.name = name;
    if (bytes.length < 6) throw new Error(`${name}: too short to be a DAT file`);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.indexOffset = dv.getUint32(0, true);
    this.indexSize = dv.getUint16(4, true);
    if (this.indexOffset + 2 > bytes.length) {
      throw new Error(`${name}: index offset ${this.indexOffset} is past end of file`);
    }
    const count = dv.getUint16(this.indexOffset, true);
    if (this.indexSize !== 2 + 8 * count) {
      throw new Error(
        `${name}: index size ${this.indexSize} does not match ${count} entries`,
      );
    }
    const entries: DatEntry[] = [];
    const byId = new Map<number, DatEntry>();
    let p = this.indexOffset + 2;
    for (let i = 0; i < count; i++, p += 8) {
      const e: DatEntry = {
        id: dv.getUint16(p, true),
        offset: dv.getUint32(p + 2, true),
        size: dv.getUint16(p + 6, true),
      };
      if (e.offset + 1 + e.size > bytes.length) {
        throw new Error(`${name}: resource ${e.id} runs past end of file`);
      }
      entries.push(e);
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    this.entries = entries;
    this.byId = byId;
  }

  has(id: number): boolean {
    return this.byId.has(id);
  }

  ids(): number[] {
    return this.entries.map((e) => e.id);
  }

  /** Payload of a resource, as a view into the underlying buffer. */
  get(id: number): Uint8Array {
    const e = this.byId.get(id);
    if (!e) throw new Error(`${this.name}: no resource with id ${id}`);
    return this.bytes.subarray(e.offset + 1, e.offset + 1 + e.size);
  }

  /** The stored checksum byte of a resource. */
  checksumOf(id: number): number {
    const e = this.byId.get(id);
    if (!e) throw new Error(`${this.name}: no resource with id ${id}`);
    return this.bytes[e.offset];
  }

  /** True when the stored checksum matches the payload. */
  verify(id: number): boolean {
    const payload = this.get(id);
    let sum = this.checksumOf(id);
    for (let i = 0; i < payload.length; i++) sum += payload[i];
    return (sum & 0xff) === 0xff;
  }
}

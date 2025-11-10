/**
 * UniqueIDHelper - Generate and manage unique identifiers
 * Adapted from lr_webgpu_rendering_library
 */

export class UniqueIDHelper {
  private static _ObjById: Record<string, any> = {};
  private static _Lut: string[] | undefined = undefined;

  private static get Lut(): string[] {
    if (this._Lut === undefined) {
      const res: string[] = [];
      for (let i = 0; i < 256; i++) {
        res[i] = (i < 16 ? '0' : '') + i.toString(16);
      }
      this._Lut = res;
    }
    return this._Lut;
  }

  /**
   * Generate a RFC4122 v4 compliant UUID
   * @returns A UUID string (e.g., "A3F2B9C1-D4E5-46F7-8A9B-0C1D2E3F4A5B")
   */
  public static GenerateUUID(): string {
    const lut = this.Lut;

    // Generate four random 32-bit numbers
    const d0 = (Math.random() * 0xffffffff) | 0;
    const d1 = (Math.random() * 0xffffffff) | 0;
    const d2 = (Math.random() * 0xffffffff) | 0;
    const d3 = (Math.random() * 0xffffffff) | 0;

    // Build UUID string from bytes
    const uuid =
      lut[d0 & 0xff] +
      lut[(d0 >> 8) & 0xff] +
      lut[(d0 >> 16) & 0xff] +
      lut[(d0 >> 24) & 0xff] +
      '-' +
      lut[d1 & 0xff] +
      lut[(d1 >> 8) & 0xff] +
      '-' +
      lut[((d1 >> 16) & 0x0f) | 0x40] +
      lut[(d1 >> 24) & 0xff] +
      '-' +
      lut[(d2 & 0x3f) | 0x80] +
      lut[(d2 >> 8) & 0xff] +
      '-' +
      lut[(d2 >> 16) & 0xff] +
      lut[(d2 >> 24) & 0xff] +
      lut[d3 & 0xff] +
      lut[(d3 >> 8) & 0xff] +
      lut[(d3 >> 16) & 0xff] +
      lut[(d3 >> 24) & 0xff];

    return uuid.toUpperCase();
  }

  /**
   * Get or create a UUID for an object
   * @param obj Object to get/assign UUID to
   * @returns The object's UUID
   */
  public static GetUUID(obj: any): string {
    if (obj.uuid === undefined) {
      let uuid = this.GenerateUUID();
      while (this._ObjById[uuid] !== undefined) {
        uuid = this.GenerateUUID();
      }
      obj.uuid = uuid;
      this._ObjById[uuid] = obj;
    }
    return obj.uuid;
  }

  /**
   * Get object by UUID
   * @param uuid UUID to look up
   * @returns The object associated with this UUID, or undefined
   */
  public static GetObjectById(uuid: string): any {
    return this._ObjById[uuid];
  }

  /**
   * Clear the UUID registry (useful for testing)
   */
  public static Clear(): void {
    this._ObjById = {};
  }
}

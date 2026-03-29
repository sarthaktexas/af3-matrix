/**
 * Decode structure file bytes to text for mmCIF / PDB parsing.
 * AlphaFold zips often ship gzip-compressed .cif; reading those as utf8 breaks parsing.
 */

import { gunzipSync } from "zlib";

/**
 * @param {Buffer} buf
 * @returns {string}
 */
export function decodeStructureBytesToText(buf) {
  if (!buf || buf.length === 0) {
    throw new Error("Structure file is empty.");
  }

  let body = buf;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      body = gunzipSync(buf);
    } catch (e) {
      throw new Error(
        `Gzip decompression failed (${e instanceof Error ? e.message : String(e)}).`
      );
    }
  }

  let text = body.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const probe = text.trimStart().slice(0, 400);
  if (/data_|loop_|_atom_site|^ATOM|^HETATM/m.test(probe)) {
    return text;
  }

  let nonTextish = 0;
  for (let i = 0; i < Math.min(body.length, 4096); i++) {
    const b = body[i];
    if (b === 9 || b === 10 || b === 13) continue;
    if (b < 32 || b === 127) nonTextish++;
  }
  const sampleLen = Math.min(body.length, 4096);
  if (sampleLen > 0 && nonTextish / sampleLen > 0.12) {
    throw new Error(
      "Structure file is binary or not text mmCIF/PDB (e.g. BinaryCIF .bcif). Export a text .cif from AlphaFold output, or use an uncompressed file."
    );
  }

  return text;
}

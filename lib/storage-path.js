import path from "path";

const DATA_DIR = path.join(process.cwd(), "data", "af3-matrix");

/**
 * Local data root (ignored when cloud storage is active for persistence).
 */
export function getDataRoot() {
  if (process.env.AF3_DATA_DIR && String(process.env.AF3_DATA_DIR).trim()) {
    return path.resolve(process.cwd(), String(process.env.AF3_DATA_DIR).trim());
  }
  return DATA_DIR;
}

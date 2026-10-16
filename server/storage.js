import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

// Storage adapters keep document bytes out of the database and out of the static web root.
// Development uses a local folder; other environments get object storage once ADR-004 is decided.

export function createLocalStorage(rootDir) {
  const root = resolve(rootDir);

  function pathFor(storageKey) {
    const target = resolve(join(root, storageKey));
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new Error("Storage key escapes the storage root.");
    }
    return target;
  }

  return {
    provider: "local",
    async put(storageKey, bytes) {
      const target = pathFor(storageKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
    async get(storageKey) {
      return readFile(pathFor(storageKey));
    },
    async remove(storageKey) {
      await rm(pathFor(storageKey), { force: true });
    }
  };
}

const signatures = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/jpeg": [[0xff, 0xd8, 0xff]]
};

// True when the first bytes match the declared type (the file "signature" or magic number).
export function matchesFileSignature(contentType, bytes) {
  const candidates = signatures[contentType] || [];
  return candidates.some((magic) => magic.every((byte, index) => bytes[index] === byte));
}

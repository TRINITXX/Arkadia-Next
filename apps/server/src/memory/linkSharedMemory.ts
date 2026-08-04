// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class SharedMemoryLinkError extends Schema.TaggedErrorClass<SharedMemoryLinkError>()(
  "SharedMemoryLinkError",
  { linkPath: Schema.String, reason: Schema.String },
) {}

const linkType = NodeOS.platform() === "win32" ? "junction" : "dir";

export const ensureSharedMemoryLink = (linkPath: string, targetDir: string) =>
  Effect.tryPromise({
    try: async () => {
      const current = await NodeFSP.readlink(linkPath).catch(() => null);
      if (current !== null) {
        const resolved = await NodeFSP.realpath(linkPath).catch(() => null);
        const wanted = await NodeFSP.realpath(targetDir).catch(() => targetDir);
        if (resolved === wanted) return; // already correct
        await NodeFSP.rm(linkPath, { recursive: false, force: true });
      } else {
        // If a REAL directory/file sits there, never clobber it.
        const stat = await NodeFSP.lstat(linkPath).catch(() => null);
        if (stat) throw new Error("path exists and is not our link");
      }
      await NodeFSP.mkdir(targetDir, { recursive: true });
      await NodeFSP.mkdir(NodePath.dirname(linkPath), { recursive: true });
      await NodeFSP.symlink(targetDir, linkPath, linkType);
    },
    catch: (cause) => new SharedMemoryLinkError({ linkPath, reason: String(cause) }),
  });

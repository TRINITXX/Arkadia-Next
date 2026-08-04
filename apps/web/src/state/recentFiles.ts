import { createRecentFilesEnvironmentAtoms } from "@t3tools/client-runtime/state/recent-files";

import { connectionAtomRuntime } from "../connection/runtime";

export const recentFilesEnvironment = createRecentFilesEnvironmentAtoms(connectionAtomRuntime);

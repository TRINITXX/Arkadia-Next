import { createProjectMemoryEnvironmentAtoms } from "@t3tools/client-runtime/state/project-memory";

import { connectionAtomRuntime } from "../connection/runtime";

export const projectMemoryEnvironment = createProjectMemoryEnvironmentAtoms(connectionAtomRuntime);

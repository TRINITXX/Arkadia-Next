import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandExecutionOptions,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback, useContext } from "react";

export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W, executionOptions?: AtomCommandExecutionOptions) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const label = typeof options === "string" ? options : (options?.label ?? command.label);
  const reportFailure = typeof options === "string" ? true : (options?.reportFailure ?? true);
  const reportDefect = typeof options === "string" ? true : (options?.reportDefect ?? true);

  return useCallback(
    (value: W, executionOptions?: AtomCommandExecutionOptions) =>
      runAtomCommand(
        registry,
        command,
        value,
        { label, reportFailure, reportDefect },
        console,
        executionOptions,
      ),
    [command, label, registry, reportDefect, reportFailure],
  );
}

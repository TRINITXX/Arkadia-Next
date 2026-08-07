import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../../app/DesktopObservability.ts";
import { DICTATION_HOTKEY, systemHotkeyCommand } from "../../shell/systemHotkey.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const { logWarning } = makeComponentLogger("desktop-dictation");

/**
 * Fires the user's global dictation shortcut. The composer's microphone button
 * hands the gesture over to whatever tool listens on that shortcut instead of
 * running the built-in dictation. Returns whether the keystroke was actually
 * injected, so the renderer can keep its button state honest.
 */
export const pressDictationHotkey = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRESS_DICTATION_HOTKEY_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.dictation.pressDictationHotkey")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const hotkey = systemHotkeyCommand(environment.platform, DICTATION_HOTKEY);
    if (hotkey === null) {
      yield* logWarning("no keystroke injection path on this platform", {
        platform: environment.platform,
      });
      return false;
    }

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(hotkey.command, [...hotkey.args], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
          }),
        );
        return Number(yield* handle.exitCode) === 0;
      }),
    ).pipe(
      // A missing scripting host (xdotool, a locked-down PowerShell) must
      // surface as "nothing happened", never as a rejected IPC call.
      Effect.catchCause((cause) =>
        logWarning("could not press the dictation shortcut", {
          command: hotkey.command,
          cause,
        }).pipe(Effect.as(false)),
      ),
    );
  }),
});

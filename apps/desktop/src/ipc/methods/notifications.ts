import { DesktopNotificationInputSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopWindow from "../../window/DesktopWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

// Shown by the main-window renderer when an agent event fires while the window
// is not focused. The renderer resolves the theme colours and bakes them into
// the payload so the popup matches the live app.
export const showNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.NOTIFICATION_SHOW_CHANNEL,
  payload: DesktopNotificationInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.notifications.showNotification")(function* (payload) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.showNotification(payload);
  }),
});

// Called from a popup window itself: reveal the app on its thread, then close it.
export const activateNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.NOTIFICATION_ACTIVATE_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.notifications.activateNotification")(function* (id) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.activateNotification(id);
  }),
});

// Called from a popup's ✕ button: close it without opening its thread.
export const dismissNotification = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.NOTIFICATION_DISMISS_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.notifications.dismissNotification")(function* (id) {
    const desktopWindow = yield* DesktopWindow.DesktopWindow;
    yield* desktopWindow.dismissNotification(id);
  }),
});

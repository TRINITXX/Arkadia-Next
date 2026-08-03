import * as Schema from "effect/Schema";

/**
 * A folder at `MAX_TOOLBAR_FOLDER_DEPTH - 1` cannot contain folders (only
 * actions). Root depth is 0.
 */
export const MAX_TOOLBAR_FOLDER_DEPTH = 3;

export const ToolbarActionButton = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("action"),
  label: Schema.String,
  icon: Schema.String,
  command: Schema.String,
  order: Schema.Number,
  /**
   * Prompt-bar only: when true, the button's text is submitted with a
   * trailing Enter after insertion; when false/undefined it is only typed
   * into the field for the user to edit. Ignored by the top toolbar (which
   * always runs its command with a trailing Enter in a fresh tab).
   */
  submit: Schema.optionalKey(Schema.Boolean),
});
export type ToolbarActionButton = typeof ToolbarActionButton.Type;

export interface ToolbarFolderButton {
  id: string;
  kind: "folder";
  label: string;
  icon: string;
  children: readonly ToolbarButton[];
  order: number;
}

export type ToolbarButton = ToolbarActionButton | ToolbarFolderButton;

export const ToolbarFolderButton: Schema.Codec<ToolbarFolderButton> = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("folder"),
  label: Schema.String,
  icon: Schema.String,
  children: Schema.Array(Schema.suspend((): Schema.Codec<ToolbarButton> => ToolbarButton)),
  order: Schema.Number,
});

export const ToolbarButton: Schema.Codec<ToolbarButton> = Schema.Union([
  ToolbarActionButton,
  ToolbarFolderButton,
]);

// ── Defaults ────────────────────────────────────────────────────────
//
// Reproduces the user's real Arkadia toolbar configuration. Ids are stable
// literals (never `crypto.randomUUID()`, which would mint a new tree on every
// module load and break persistence comparisons across restarts).

export const DEFAULT_TOOLBAR_BUTTONS: ToolbarButton[] = [
  {
    id: "toolbar-ccd",
    kind: "action",
    label: "ccd",
    icon: "terminal",
    command: "ccd",
    order: 0,
  },
  {
    id: "toolbar-ccdr",
    kind: "action",
    label: "ccdr",
    icon: "terminal",
    command: "ccdr",
    order: 1,
  },
  {
    id: "toolbar-expo-start",
    kind: "action",
    label: "npx expo start",
    icon: "play",
    command: "npx expo start --clear",
    order: 2,
  },
  {
    id: "toolbar-eas-update-all",
    kind: "action",
    label: "EAS Update all",
    icon: "upload",
    command: "eas update --channel production --environment production --non-interactive --auto",
    order: 3,
  },
  {
    id: "toolbar-development",
    kind: "folder",
    label: "Development",
    icon: "folder",
    order: 4,
    children: [
      {
        id: "toolbar-development-ios",
        kind: "folder",
        label: "iOS",
        icon: "folder",
        order: 0,
        children: [
          {
            id: "toolbar-development-ios-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command: "eas update --platform ios --environment development --auto",
            order: 0,
          },
          {
            id: "toolbar-development-ios-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --platform ios --profile development",
            order: 1,
          },
        ],
      },
      {
        id: "toolbar-development-android",
        kind: "folder",
        label: "Android",
        icon: "folder",
        order: 1,
        children: [
          {
            id: "toolbar-development-android-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command: "eas update --platform android --profile development --auto",
            order: 0,
          },
          {
            id: "toolbar-development-android-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --platform android --profile development",
            order: 1,
          },
        ],
      },
      {
        id: "toolbar-development-both",
        kind: "folder",
        label: "Les 2",
        icon: "folder",
        order: 2,
        children: [
          {
            id: "toolbar-development-both-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command: "eas update --platform all --profile development --auto",
            order: 0,
          },
          {
            id: "toolbar-development-both-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --platform all --profile development",
            order: 1,
          },
        ],
      },
    ],
  },
  {
    id: "toolbar-preview",
    kind: "folder",
    label: "Preview",
    icon: "folder",
    order: 5,
    children: [
      {
        id: "toolbar-preview-ios",
        kind: "folder",
        label: "iOS",
        icon: "folder",
        order: 0,
        children: [
          {
            id: "toolbar-preview-ios-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command:
              "eas update --channel preview --environment preview --platform ios --non-interactive --auto",
            order: 0,
          },
          {
            id: "toolbar-preview-ios-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --platform ios --profile preview",
            order: 1,
          },
        ],
      },
      {
        id: "toolbar-preview-android",
        kind: "folder",
        label: "Android",
        icon: "folder",
        order: 1,
        children: [
          {
            id: "toolbar-preview-android-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command:
              "eas update --channel preview --environment preview --platform android --non-interactive --auto",
            order: 0,
          },
          {
            id: "toolbar-preview-android-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --platform android --profile preview",
            order: 1,
          },
        ],
      },
      {
        id: "toolbar-preview-both",
        kind: "folder",
        label: "Les 2",
        icon: "folder",
        order: 2,
        children: [
          {
            id: "toolbar-preview-both-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command: "eas update --channel preview --environment preview --non-interactive --auto",
            order: 0,
          },
          {
            id: "toolbar-preview-both-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --platform all --profile preview",
            order: 1,
          },
        ],
      },
    ],
  },
  {
    id: "toolbar-prod",
    kind: "folder",
    label: "Prod",
    icon: "folder",
    order: 6,
    children: [
      {
        id: "toolbar-prod-ios",
        kind: "folder",
        label: "iOS",
        icon: "folder",
        order: 0,
        children: [
          {
            id: "toolbar-prod-ios-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command:
              "eas update --channel production --environment production --platform ios --non-interactive --auto",
            order: 0,
          },
          {
            id: "toolbar-prod-ios-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --channel production --environment production --platform ios",
            order: 1,
          },
        ],
      },
      {
        id: "toolbar-prod-android",
        kind: "folder",
        label: "Android",
        icon: "folder",
        order: 1,
        children: [
          {
            id: "toolbar-prod-android-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command:
              "eas update --channel production --environment production --platform android --non-interactive --auto",
            order: 0,
          },
          {
            id: "toolbar-prod-android-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --channel production --environment production --platform android",
            order: 1,
          },
        ],
      },
      {
        id: "toolbar-prod-both",
        kind: "folder",
        label: "Les 2",
        icon: "folder",
        order: 2,
        children: [
          {
            id: "toolbar-prod-both-update",
            kind: "action",
            label: "eas update",
            icon: "play",
            command:
              "eas update --channel production --environment production --non-interactive --auto",
            order: 0,
          },
          {
            id: "toolbar-prod-both-build",
            kind: "action",
            label: "eas build",
            icon: "play",
            command: "eas build --channel production --environment production",
            order: 1,
          },
        ],
      },
    ],
  },
  {
    id: "toolbar-npm-run-dev",
    kind: "action",
    label: "npm run dev",
    icon: "play",
    command: "npm run dev",
    order: 7,
  },
];

export const DEFAULT_PROMPT_BUTTONS: ToolbarButton[] = [
  {
    id: "prompt-commit",
    kind: "action",
    label: "/ commit",
    icon: "check",
    command: "/commit",
    order: 0,
  },
  {
    id: "prompt-clear",
    kind: "action",
    label: "/ clear",
    icon: "x",
    command: "/clear",
    order: 1,
  },
  {
    id: "prompt-compact",
    kind: "action",
    label: "/ compact",
    icon: "database",
    command: "/compact",
    order: 2,
  },
  {
    id: "prompt-resume",
    kind: "action",
    label: "/ resume",
    icon: "play",
    command: "/resume",
    order: 3,
  },
];

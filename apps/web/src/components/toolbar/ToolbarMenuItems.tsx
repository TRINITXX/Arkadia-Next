import type {
  ToolbarActionButton as ToolbarActionButtonModel,
  ToolbarButton as ToolbarButtonModel,
} from "@t3tools/contracts";

import { MenuItem, MenuSub, MenuSubPopup, MenuSubTrigger } from "~/components/ui/menu";
import { preventPointerFocus } from "./toolbarDom";
import { sortedToolbarChildren } from "./toolbarFolderNav";
import { getToolbarIcon } from "./toolbarIcons";

interface ToolbarMenuItemsProps {
  items: ReadonlyArray<ToolbarButtonModel>;
  onRunAction: (button: ToolbarActionButtonModel) => void;
  preserveFocusOnPointerDown?: boolean;
}

/** Renders toolbar actions and folders as menu items, preserving nesting. */
export function ToolbarMenuItems({
  items,
  onRunAction,
  preserveFocusOnPointerDown = false,
}: ToolbarMenuItemsProps) {
  const onPointerDown = preserveFocusOnPointerDown ? preventPointerFocus : undefined;

  return items.map((item) => {
    const Icon = getToolbarIcon(item.icon);

    if (item.kind === "folder") {
      const label = item.label || "dossier";
      const children = sortedToolbarChildren(item.children);
      return (
        <MenuSub key={item.id}>
          <MenuSubTrigger onPointerDown={onPointerDown}>
            {Icon && <Icon />}
            <span className="truncate">{label}</span>
          </MenuSubTrigger>
          <MenuSubPopup className="max-w-90">
            {children.length === 0 ? (
              <div className="px-2 py-1.5 text-muted-foreground text-sm">Dossier vide</div>
            ) : (
              <ToolbarMenuItems
                items={children}
                onRunAction={onRunAction}
                preserveFocusOnPointerDown={preserveFocusOnPointerDown}
              />
            )}
          </MenuSubPopup>
        </MenuSub>
      );
    }

    const label = item.label || item.command || "sans nom";
    return (
      <MenuItem
        key={item.id}
        onClick={() => onRunAction(item)}
        onPointerDown={onPointerDown}
        title={item.command || label}
      >
        {Icon && <Icon />}
        <span className="truncate">{label}</span>
      </MenuItem>
    );
  });
}

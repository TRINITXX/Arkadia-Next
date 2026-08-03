import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { getToolbarIcon, TOOLBAR_ICON_NAMES } from "./toolbarIcons";

/**
 * The toolbar editor's icon picker: a trigger showing the current icon (or a
 * placeholder), and a popover with a search field, a grid of every icon in
 * the registry, and a clear button. Ported from Arkadia's `IconPicker.tsx`,
 * rebuilt on this repo's Base UI `~/components/ui/popover` instead of its
 * manual mousedown/Escape listeners.
 */
interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
}

export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const Current = getToolbarIcon(value);
  const filtered = filter
    ? TOOLBAR_ICON_NAMES.filter((name) => name.toLowerCase().includes(filter.toLowerCase()))
    : TOOLBAR_ICON_NAMES;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setFilter("");
      }}
    >
      <PopoverTrigger
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-foreground hover:bg-accent"
        title={value || "Aucune icône"}
        aria-label="Choisir une icône"
      >
        {Current ? (
          <Current className="size-4" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-64 p-2">
        <div className="mb-2 flex items-center gap-1.5">
          <Input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Rechercher…"
            aria-label="Rechercher une icône"
            className="h-8 text-xs"
          />
          {value && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Effacer
            </Button>
          )}
        </div>
        <div className="grid max-h-56 grid-cols-7 gap-1 overflow-y-auto">
          {filtered.map((name) => {
            const Icon = getToolbarIcon(name);
            if (!Icon) return null;
            const selected = name === value;
            return (
              <button
                key={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md",
                  selected
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title={name}
                type="button"
              >
                <Icon className="size-4" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-7 py-3 text-center text-xs text-muted-foreground">
              Aucun résultat
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

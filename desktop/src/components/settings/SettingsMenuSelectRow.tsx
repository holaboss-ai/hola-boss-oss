import type { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsRow } from "./SettingsRow";

export interface SettingsMenuOption {
  value: string;
  label: ReactNode;
  /** Optional secondary line shown under the label inside the menu. */
  description?: ReactNode;
  disabled?: boolean;
}

interface SettingsMenuSelectRowProps {
  label: ReactNode;
  description?: ReactNode;
  /** Optional leading visual (icon). */
  leading?: ReactNode;
  /** Currently selected value. */
  value: string;
  onValueChange: (value: string) => void;
  options: SettingsMenuOption[];
  /** Trigger width override — defaults to a comfortable 200px. */
  triggerWidth?: string;
  /** Disable the whole control (read-only display). */
  disabled?: boolean;
  /** Empty-state placeholder shown when no value matches an option. */
  placeholder?: string;
}

/**
 * SettingsMenuSelectRow
 *
 * SettingsRow + a select control on the right. The select trigger shows
 * the label of the currently selected option; the menu shows label +
 * optional description per option.
 *
 * Single source of truth for "default model", "default provider",
 * "thinking level" pickers across the settings panels.
 */
export function SettingsMenuSelectRow({
  label,
  description,
  leading,
  value,
  onValueChange,
  options,
  triggerWidth = "w-[200px]",
  disabled,
  placeholder,
}: SettingsMenuSelectRowProps) {
  return (
    <SettingsRow label={label} description={description} leading={leading}>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) {
            onValueChange(next);
          }
        }}
        disabled={disabled}
      >
        <SelectTrigger
          // Force foreground for selected value: Base UI marks the
          // trigger data-placeholder until the items list is registered
          // (lazy on first open), which would otherwise mute its colour.
          className={`${triggerWidth} data-placeholder:text-foreground`}
        >
          <SelectValue placeholder={placeholder}>
            {(currentValue) => {
              // Base UI's auto text-extraction falls back to the raw
              // `value` string when the option label is JSX (e.g. swatch +
              // text). Resolve the label ourselves so the trigger matches
              // what's shown in the menu.
              const match = options.find((o) => o.value === currentValue);
              if (match) return match.label;
              return placeholder ?? currentValue;
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm">{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

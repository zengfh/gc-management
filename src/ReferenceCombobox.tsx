import { useId, useMemo, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import type { ReferenceValue } from '../shared/domain';
import { HelpHint } from './formUi';
import { filterReferenceOptions } from './referenceValues';

export function ReferenceCombobox({
  label,
  value,
  onChange,
  options,
  required = false,
  placeholder = '',
  helpText = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReferenceValue[];
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}) {
  const generatedId = useId();
  const inputId = `reference-combobox-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const matches = useMemo(() => filterReferenceOptions(options, value), [options, value]);

  function selectOption(option: ReferenceValue) {
    onChange(option.value);
    setOpen(false);
    setHighlightedIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter' && open && matches[highlightedIndex]) {
      event.preventDefault();
      selectOption(matches[highlightedIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      className="combobox-field"
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <label htmlFor={inputId}>
        <span className="label-with-help">
          {label}
          {helpText ? <HelpHint text={helpText} /> : null}
        </span>
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={open && matches[highlightedIndex] ? `${listboxId}-${highlightedIndex}` : undefined}
        value={value}
        placeholder={placeholder}
        required={required}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
      />
      {open && matches.length > 0 ? (
        <ul id={listboxId} className="combobox-menu" role="listbox">
          {matches.map((option, index) => (
            <li
              id={`${listboxId}-${index}`}
              key={`${option.type}-${option.id || option.value}`}
              className={index === highlightedIndex ? 'combobox-option highlighted' : 'combobox-option'}
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span>{option.value}</span>
              {option.usageCount ? <small>{option.usageCount} uses</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

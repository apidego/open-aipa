import { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import './ModelSelect.css';
export function ModelSelect({
  label,
  name,
  defaultValue,
  models,
}: {
  label: string;
  name: string;
  defaultValue: string;
  models: string[];
}) {
  const id = useId();
  const [value, setValue] = useState(defaultValue),
    [query, setQuery] = useState(''),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1);
  useEffect(() => {
    setValue(defaultValue);
    setQuery('');
  }, [defaultValue]);
  const options = models.filter((m) => m.toLowerCase().includes(query.toLowerCase()));
  const select = (model: string) => {
    setValue(model);
    setQuery('');
    setOpen(false);
    setActive(-1);
  };
  return (
    <div
      className="field model-select"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="model-select-input">
        <input
          id={id}
          name={name}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && active >= 0 && options[active] ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          required
          maxLength={100}
          value={value}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setValue(e.target.value);
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              setActive((i) =>
                Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))),
              );
            }
            if (e.key === 'Escape') {
              setOpen(false);
              setActive(-1);
            }
            if (e.key === 'Enter' && open) {
              e.preventDefault();
              if (active >= 0 && options[active]) select(options[active]);
              else setOpen(false);
            }
          }}
        />
        <button
          type="button"
          aria-label={`${label}: Modellliste öffnen`}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setOpen(!open);
            setQuery('');
            document.getElementById(id)?.focus();
          }}
        >
          <ChevronDown size={17} />
        </button>
      </div>
      {open && (
        <div className="model-select-menu">
          <ul id={`${id}-options`} role="listbox" aria-label={label}>
            {options.map((model, i) => (
              <li
                id={`${id}-option-${i}`}
                key={model}
                role="option"
                aria-selected={model === value}
                className={active === i ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(model)}
                ref={(el) => {
                  if (active === i) el?.scrollIntoView({ block: 'nearest' });
                }}
              >
                {model}
              </li>
            ))}
          </ul>
          {!options.length && (
            <p role="status">Keine Treffer. Du kannst eine Modell-ID direkt eingeben.</p>
          )}
        </div>
      )}
    </div>
  );
}

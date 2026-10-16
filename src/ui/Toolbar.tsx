import { Fragment } from 'react';
import type { ToolbarConfig, ToolbarItem } from './config';
import { useER } from './config';

/** Apply host toolbar configuration to the default item list. */
export function resolveToolbar(defaults: ToolbarItem[], config: ToolbarConfig | undefined): ToolbarItem[] {
  if (config === false) return [];
  if (!config) return defaults;
  if (Array.isArray(config)) {
    return config.map((id) => defaults.find((d) => d.id === id)).filter((x): x is ToolbarItem => !!x);
  }
  return config(defaults);
}

export function Toolbar({ items, className, ariaLabel }: { items: ToolbarItem[]; className?: string; ariaLabel?: string }) {
  const { components } = useER();
  const { Button } = components;
  if (!items.length) return null;
  return (
    <div className={`er-toolbar ${className ?? ''}`} role="toolbar" aria-label={ariaLabel}>
      {items.map((it) => (
        <Fragment key={it.id}>
          {it.spacer && <div className="er-toolbar__spacer" />}
          {it.separator && <div className="er-toolbar__sep" />}
          {it.render ? (
            <div className="er-toolbar__custom">{it.render()}</div>
          ) : (
            <Button
              variant="ghost"
              icon={it.icon}
              title={it.title ?? it.label}
              onClick={it.onClick}
              disabled={it.disabled}
              active={it.active}
            >
              {it.icon ? undefined : it.label}
            </Button>
          )}
        </Fragment>
      ))}
    </div>
  );
}

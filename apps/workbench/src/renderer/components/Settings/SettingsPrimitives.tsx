import React from 'react';

export function SettingsSectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-titlebar-bg/35 p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-editor-fg">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-secondary-text">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
export function SettingsLoading({ message = 'Loading…' }: { message?: string }) {
  return <div className="py-8 text-center text-sm text-secondary-text">{message}</div>;
}

export function SettingsError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-500">
      <div>{message}</div>
      {onRetry ? (
        <button type="button" className="mt-2 underline" onClick={onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

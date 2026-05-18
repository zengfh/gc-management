export function FieldError({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p className="field-error" role="alert">
      {message}
    </p>
  );
}

export function HelpHint({ text }: { text: string }) {
  return (
    <span className="help-hint" aria-hidden="true" data-help={text} />
  );
}

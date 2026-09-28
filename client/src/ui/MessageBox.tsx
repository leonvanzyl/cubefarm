import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

// The message box shared by the phone's CEO chat and the agent terminal: Enter sends,
// Shift+Enter adds a line. It starts one line tall, grows to about six, then scrolls.
// Put it in a <form> next to its Send button; Enter submits the form the same way
// pressing Enter in a single-line input did, so a disabled Send button still blocks it.

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'rows'> & {
  value: string;
  onChange: (value: string) => void;
};

export function MessageBox({ value, onChange, className, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Fit the height to the text; CSS max-height caps it at about six lines, after which it scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      enterKeyHint="send"
      className={`msg-box ${className ?? ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey) return;
        // Enter that confirms an IME composition (Japanese, Chinese, …) must not send.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        const form = e.currentTarget.form;
        const send = form?.querySelector<HTMLButtonElement>('button:not([type="button"])');
        if (form && !send?.disabled) form.requestSubmit();
      }}
    />
  );
}

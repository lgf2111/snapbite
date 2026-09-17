import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** App toaster. Uses the dark theme to match the Telegram-style dark palette. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      toastOptions={{
        style: {
          background: 'var(--card)',
          color: 'var(--foreground)',
          border: '1px solid var(--border)',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };

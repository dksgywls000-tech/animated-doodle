import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const Ctx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  const show = useCallback((text: string) => {
    const id = Date.now();
    setMsg({ text, id });
    setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), 2600);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">{msg?.text}</div>
      {msg && <div className="toast" role="status">{msg.text}</div>}
    </Ctx.Provider>
  );
}

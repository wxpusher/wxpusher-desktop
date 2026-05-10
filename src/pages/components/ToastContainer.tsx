import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

interface ToastItem {
  id: number;
  type: 'success' | 'warning' | 'error' | 'info';
  message: string;
  duration?: number;
}

let toastId = 0;
let addToastFn: ((toast: Omit<ToastItem, 'id'>) => void) | null = null;

export function showToast(type: ToastItem['type'], message: string, duration = 2000) {
  addToastFn?.({ type, message, duration });
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, toast.duration);
  }, []);

  useEffect(() => {
    addToastFn = addToast;

    // 监听主进程 toast
    const handler = (_: any, msg: string) => {
      addToast({ type: 'info', message: msg });
    };
    // 注：需要通过 IPC 监听
    return () => {
      addToastFn = null;
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.type}`}>
          {toast.type === 'success' && <CheckCircle2 size={16} />}
          {toast.type === 'warning' && <AlertTriangle size={16} />}
          {toast.type === 'error' && <XCircle size={16} />}
          {toast.type === 'info' && <CheckCircle2 size={16} />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

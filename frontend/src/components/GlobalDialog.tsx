import React, { useEffect, useSyncExternalStore } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';

export type DialogKind = 'info' | 'success' | 'error' | 'warning' | 'confirm';

export interface DialogRequest {
  message: string;
  title?: string;
  kind: DialogKind;
  confirmText?: string;
  cancelText?: string;
  onResolve?: (confirmed: boolean) => void;
}

let _dialog: DialogRequest | null = null;
const _listeners = new Set<() => void>();

function emit() {
  _listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

export function subscribeDialog(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

export function getDialog(): DialogRequest | null {
  return _dialog;
}

/** Non-blocking informational / error / success dialog (replaces window.alert). */
export function showDialog(message: string, opts?: { title?: string; kind?: DialogKind }) {
  _dialog = {
    message: String(message ?? ''),
    title: opts?.title,
    kind: opts?.kind || 'info'
  };
  emit();
}

/** Awaitable confirmation dialog (replaces window.confirm). Resolves true/false. */
export function confirmDialog(
  message: string,
  opts?: { title?: string; confirmText?: string; cancelText?: string }
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    _dialog = {
      message: String(message ?? ''),
      title: opts?.title || 'Please Confirm',
      kind: 'confirm',
      confirmText: opts?.confirmText,
      cancelText: opts?.cancelText,
      onResolve: resolve
    };
    emit();
  });
}

export function closeDialog(confirmed = false) {
  const resolve = _dialog?.onResolve;
  _dialog = null;
  emit();
  if (resolve) resolve(confirmed);
}

/** Mount once at the app root. */
export const GlobalDialog: React.FC = () => {
  const dialog = useSyncExternalStore(subscribeDialog, getDialog);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  if (!dialog) return null;

  const isConfirm = dialog.kind === 'confirm';
  const Icon =
    dialog.kind === 'success' ? CheckCircle2 :
    dialog.kind === 'error' ? XCircle :
    dialog.kind === 'warning' ? AlertTriangle : Info;
  const iconColor =
    dialog.kind === 'success' ? 'text-emerald-600' :
    dialog.kind === 'error' ? 'text-rose-600' :
    dialog.kind === 'warning' ? 'text-amber-600' :
    dialog.kind === 'confirm' ? 'text-blue-600' : 'text-indigo-600';
  const btnColor =
    dialog.kind === 'error' ? 'bg-rose-600 hover:bg-rose-700' :
    dialog.kind === 'success' ? 'bg-emerald-600 hover:bg-emerald-700' :
    dialog.kind === 'warning' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700';

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={!isConfirm ? () => closeDialog(false) : undefined}
    >
      <div
        className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200 overflow-hidden cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <Icon className={`w-6 h-6 mt-0.5 shrink-0 ${iconColor}`} />
            <div className="min-w-0 flex-1">
              {dialog.title && <h3 className="font-bold text-sm text-slate-900 mb-1">{dialog.title}</h3>}
              <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap break-words">{dialog.message}</p>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          {isConfirm && (
            <button
              type="button"
              onClick={() => closeDialog(false)}
              className="px-3 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 cursor-pointer"
            >
              {dialog.cancelText || 'Cancel'}
            </button>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => closeDialog(isConfirm)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white shadow-xs cursor-pointer ${btnColor}`}
          >
            {isConfirm ? (dialog.confirmText || 'Confirm') : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GlobalDialog;
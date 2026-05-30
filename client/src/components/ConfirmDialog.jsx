import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const ConfirmContext = createContext(null);

export const useConfirm = () => {
  const value = useContext(ConfirmContext);
  if (!value) {
    throw new Error('useConfirm must be used inside ConfirmProvider');
  }
  return value;
};

export const ConfirmProvider = ({ children }) => {
  const [dialog, setDialog] = useState(null);
  const [draft, setDraft] = useState('');
  const resolverRef = useRef(null);
  const sequenceRef = useRef(0);

  const close = useCallback((result) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    resolver?.(result);
  }, []);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    sequenceRef.current += 1;
    resolverRef.current = resolve;
    setDialog({
      id: sequenceRef.current,
      type: 'confirm',
      title: 'Подтвердите действие',
      message: '',
      confirmText: 'Подтвердить',
      cancelText: 'Отмена',
      danger: false,
      ...options,
    });
  }), []);

  const prompt = useCallback((options = {}) => new Promise((resolve) => {
    sequenceRef.current += 1;
    resolverRef.current = resolve;
    setDialog({
      id: sequenceRef.current,
      type: 'prompt',
      title: 'Введите значение',
      message: '',
      confirmText: 'Готово',
      cancelText: 'Отмена',
      placeholder: '',
      defaultValue: '',
      maxLength: 240,
      danger: false,
      ...options,
    });
  }), []);

  useEffect(() => {
    if (!dialog) return;
    setDraft(dialog.defaultValue || '');
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(dialog.type === 'prompt' ? null : false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close, dialog]);

  const value = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      {dialog && (
        <div className="confirm-layer" role="presentation" onMouseDown={() => close(dialog.type === 'prompt' ? null : false)}>
          <section
            className={`confirm-card ${dialog.danger ? 'confirm-card--danger' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="confirm-copy">
              <h2 id="confirm-title">{dialog.title}</h2>
              {dialog.message && <p>{dialog.message}</p>}
            </div>

            {dialog.type === 'prompt' && (
              <label className="confirm-input">
                <span>{dialog.label || 'Причина'}</span>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value.slice(0, dialog.maxLength))}
                  placeholder={dialog.placeholder}
                  maxLength={dialog.maxLength}
                  rows={4}
                />
                <em>{draft.length}/{dialog.maxLength}</em>
              </label>
            )}

            <div className="confirm-actions">
              <button type="button" className="ghost-button" onClick={() => close(dialog.type === 'prompt' ? null : false)}>
                {dialog.cancelText}
              </button>
              <button
                type="button"
                className={`review-button ${dialog.danger ? 'review-button--delete' : 'review-button--approve'}`}
                onClick={() => close(dialog.type === 'prompt' ? draft.trim() : true)}
              >
                {dialog.confirmText}
              </button>
            </div>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

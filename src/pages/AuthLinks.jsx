import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Loader2, KeyRound, MailCheck } from 'lucide-react';
import { api } from '../api';
import { navigate } from '../router';
import { t } from '../i18n';
import './pay.css';

// Те же правила, что на сервере (zod в routes/auth.js)
const pwError = (v) => {
  if (v.length < 8) return t('Минимум 8 символов');
  if (!/[A-Z]/.test(v)) return t('Нужна заглавная буква');
  if (!/[a-z]/.test(v)) return t('Нужна строчная буква');
  if (!/[0-9]/.test(v)) return t('Нужна цифра');
  return '';
};

function Card({ icon: Icon, tone, title, children }) {
  return (
    <div className={`ztx-pay-card ${tone}`}>
      <div className="ztx-pay-icon"><Icon size={40} className={tone === 'info' && Icon === Loader2 ? 'ztx-auth-spin' : undefined} /></div>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export function ResetPassword({ token, onOpenAuth }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!token) {
    return (
      <Card icon={XCircle} tone="danger" title={t('Ссылка недействительна')}>
        <p role="alert">{t('В ссылке нет токена. Запросите восстановление пароля ещё раз.')}</p>
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => navigate('/')}>{t('На главную')}</button>
      </Card>
    );
  }

  if (done) {
    return (
      <Card icon={CheckCircle2} tone="ok" title={t('Пароль изменён')}>
        <p>{t('Теперь можно войти с новым паролем.')}</p>
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => onOpenAuth?.()}>{t('Войти')}</button>
      </Card>
    );
  }

  const e1 = touched ? pwError(pw) : '';
  const e2 = touched && pw !== pw2 ? t('Пароли не совпадают') : '';

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (pwError(pw) || pw !== pw2) return;
    setBusy(true);
    try {
      await api.resetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setError(err.message || t('Не удалось сменить пароль'));
    } finally { setBusy(false); }
  };

  return (
    <Card icon={KeyRound} tone="info" title={t('Новый пароль')}>
      <form className="ztx-auth-form" onSubmit={submit} noValidate>
        <label>
          <span>{t('Новый пароль')}</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)}
            aria-invalid={!!e1} aria-describedby="ztx-rp-hint ztx-rp-e1" />
        </label>
        <small id="ztx-rp-hint">{t('Минимум 8 символов, заглавная и строчная буквы, цифра')}</small>
        <span id="ztx-rp-e1" className="ztx-pay-err" role="alert">{e1}</span>
        <label>
          <span>{t('Повторите пароль')}</span>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
            aria-invalid={!!e2} aria-describedby="ztx-rp-e2" />
        </label>
        <span id="ztx-rp-e2" className="ztx-pay-err" role="alert">{e2}</span>
        {error && <p className="ztx-pay-err" role="alert">{error}</p>}
        <button type="submit" className="ztx-btn ztx-btn-solid" disabled={busy}>{busy ? t('Сохраняем…') : t('Сменить пароль')}</button>
      </form>
    </Card>
  );
}

const verifyCalls = new Map();

export function VerifyEmail({ token, onVerified, onOpenAuth }) {
  // результат хранится вместе с токеном, чтобы смена токена снова показывала «загрузку»
  const [res, setRes] = useState({ token: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const onVerifiedRef = useStable(onVerified);

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    // токен одноразовый: повторный вызов эффекта (StrictMode) не должен слать второй запрос
    if (!verifyCalls.has(token)) verifyCalls.set(token, api.verifyEmail(token));
    verifyCalls.get(token).then(
      () => { if (alive) { setRes({ token, error: '' }); onVerifiedRef.current?.(); } },
      (e) => { if (alive) setRes({ token, error: e.message || t('Не удалось подтвердить почту') }); },
    );
    return () => { alive = false; };
  }, [token, attempt, onVerifiedRef]);

  if (!token) {
    return (
      <Card icon={XCircle} tone="danger" title={t('Ссылка недействительна')}>
        <p role="alert">{t('В ссылке нет токена подтверждения.')}</p>
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => navigate('/')}>{t('На главную')}</button>
      </Card>
    );
  }
  if (res.token !== token) {
    return (
      <Card icon={Loader2} tone="info" title={t('Подтверждаем почту…')}>
        <p role="status">{t('Это займёт пару секунд.')}</p>
      </Card>
    );
  }
  if (res.error) {
    return (
      <Card icon={XCircle} tone="danger" title={t('Не удалось подтвердить почту')}>
        <p role="alert">{res.error}</p>
        <p>{t('Ссылка могла устареть. Запросите новое письмо в профиле.')}</p>
        <div className="ztx-pay-actions">
          <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => { verifyCalls.delete(token); setRes({ token: null, error: '' }); setAttempt((n) => n + 1); }}>{t('Повторить')}</button>
          <button type="button" className="ztx-btn ztx-pay-ghost" onClick={() => navigate('/')}>{t('На главную')}</button>
        </div>
      </Card>
    );
  }
  return (
    <Card icon={MailCheck} tone="ok" title={t('Почта подтверждена')}>
      <p>{t('Спасибо! Теперь вам доступны все возможности магазина.')}</p>
      <div className="ztx-pay-actions">
        <button type="button" className="ztx-btn ztx-btn-solid" onClick={() => navigate('/catalog')}>{t('В каталог')}</button>
        {onOpenAuth && <button type="button" className="ztx-btn ztx-pay-ghost" onClick={() => onOpenAuth()}>{t('Войти')}</button>}
      </div>
    </Card>
  );
}

// ref с актуальным колбэком, чтобы он не перезапускал эффект
function useStable(fn) {
  const [ref] = useState(() => ({ current: fn }));
  useEffect(() => { ref.current = fn; });
  return ref;
}

export default ResetPassword;

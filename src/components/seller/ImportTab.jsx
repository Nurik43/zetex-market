import { useRef, useState } from 'react';
import { Download, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../useToast';
import { t } from '../../i18n';

const MAX_ROWS = 500;
const MAX_CHARS = 900_000;

const readText = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error(t('Не удалось прочитать файл')));
  r.readAsText(file, 'utf-8');
});

export default function ImportTab({ onImported }) {
  const { toast } = useToast();
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const reset = () => {
    setFileName(''); setCsv(''); setPreview(null); setError(''); setDone(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    setPreview(null); setError(''); setDone(null); setCsv(''); setFileName('');
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') { setError(t('Выберите файл в формате .csv')); return; }
    setBusy(true);
    try {
      const text = await readText(file);
      if (text.length > MAX_CHARS) throw new Error(t('Файл слишком большой. Разбейте его на несколько частей.'));
      setCsv(text);
      setFileName(file.name);
      setPreview(await api.importProducts(text, true));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (busy || !csv) return;
    setBusy(true);
    try {
      const res = await api.importProducts(csv, false);
      setDone(res);
      setPreview(null);
      toast(t('Импорт завершён: создано {c}, обновлено {u}', { c: res.created, u: res.updated }));
      onImported?.();
    } catch (err) {
      setError(err.message);
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const ok = preview ? preview.created + preview.updated : 0;

  return (
    <section className="ztx-seller-card" aria-labelledby="imp-h">
      <div className="ztx-seller-card-head">
        <h3 id="imp-h" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{t('Импорт товаров из CSV')}</h3>
        <a className="ztx-seller-btn" href={api.importTemplateUrl} download><Download size={14} aria-hidden="true" /> {t('Скачать шаблон')}</a>
      </div>
      <div className="ztx-seller-card-pad ztx-seller-col">
        <ol className="ztx-seller-steps">
          <li>{t('Скачайте шаблон и заполните его: название, категория, цена обязательны.')}</li>
          <li>{t('Выберите файл — мы сначала проверим его, ничего не сохраняя.')}</li>
          <li>{t('Если всё в порядке, нажмите «Импортировать».')}</li>
        </ol>
        <p className="ztx-seller-hint">{t('До {n} строк за раз. Товар с тем же названием будет обновлён, остальные — созданы. Без ссылки на фото подставится заглушка.', { n: MAX_ROWS })}</p>

        <div className="ztx-seller-row" style={{ alignItems: 'center' }}>
          <label className="ztx-seller-btn primary" style={{ cursor: busy ? 'wait' : 'pointer' }}>
            <FileUp size={14} aria-hidden="true" /> {busy && !preview ? t('Проверяем…') : t('Выбрать CSV-файл')}
            <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={pick} disabled={busy} className="ztx-seller-sr" />
          </label>
          {fileName && <span className="ztx-seller-note">{fileName}</span>}
          {(fileName || done) && <button type="button" className="ztx-seller-btn" onClick={reset} disabled={busy}>{t('Сбросить')}</button>}
        </div>

        {error && <div className="ztx-seller-banner danger" role="alert"><AlertTriangle size={16} aria-hidden="true" />{error}</div>}

        {preview && (
          <div className="ztx-seller-col" aria-live="polite">
            <div className="ztx-seller-stats">
              <div className="ztx-seller-stat"><b>{preview.created}</b><span>{t('будет создано')}</span></div>
              <div className="ztx-seller-stat"><b>{preview.updated}</b><span>{t('будет обновлено')}</span></div>
              <div className="ztx-seller-stat"><b style={{ color: preview.errors.length ? 'var(--danger)' : undefined }}>{preview.errors.length}</b><span>{t('строк с ошибками')}</span></div>
            </div>
            {preview.errors.length > 0 && (
              <>
                <div className="ztx-seller-banner warn"><AlertTriangle size={16} aria-hidden="true" />{t('Строки с ошибками будут пропущены. Исправьте их в файле и загрузите снова — или импортируйте остальные.')}</div>
                <div className="ztx-seller-table-wrap" style={{ border: '1px solid var(--line)', borderRadius: 12, maxHeight: 320, overflowY: 'auto' }}>
                  <table className="ztx-seller-table">
                    <thead><tr><th scope="col">{t('Строка')}</th><th scope="col">{t('Ошибка')}</th></tr></thead>
                    <tbody>
                      {preview.errors.map((er) => (
                        <tr key={er.row}><td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>{er.row}</td><td style={{ color: 'var(--danger)' }}>{er.error}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div>
              <button type="button" className="ztx-seller-btn accent big" onClick={run} disabled={busy || ok === 0}>
                {busy ? t('Импортируем…') : t('Импортировать ({n})', { n: ok })}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div className="ztx-seller-banner ok" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            {t('Готово: создано {c}, обновлено {u}, пропущено строк с ошибками: {e}.', { c: done.created, u: done.updated, e: done.errors.length })}
          </div>
        )}
      </div>
    </section>
  );
}

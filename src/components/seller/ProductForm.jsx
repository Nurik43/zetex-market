import { useState } from 'react';
import { Upload, X, ArrowLeft, ArrowRight, Star, Plus, Trash2 } from 'lucide-react';
import { iconFor } from '../../icons';
import { api, imgUrl, hideBrokenImg } from '../../api';
import { useToast } from '../useToast';
import { t } from '../../i18n';

export const MAX_PHOTOS = 7;
const MAX_SPECS = 30;
const MAX_FILE = 2 * 1024 * 1024;

const photosOf = (p) => (p ? [p.image, ...(p.images || [])].filter(Boolean) : []);

/** Форма товара. Для смены товара родитель меняет key — состояние инициализируется заново. */
export default function ProductForm({ editing, taxonomy, onSaved, onCancel }) {
  const { toast } = useToast();
  const [title, setTitle] = useState(editing?.title || '');
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [oldPrice, setOldPrice] = useState(editing?.oldPrice ? String(editing.oldPrice) : '');
  const [stock, setStock] = useState(editing ? String(editing.stock) : '100');
  const [description, setDescription] = useState(editing?.description || '');
  const [category, setCategory] = useState(editing?.category || 'Электроника');
  const [subcategory, setSubcategory] = useState(editing?.subcategory || '');
  const [photos, setPhotos] = useState(photosOf(editing));
  const [specs, setSpecs] = useState(editing?.specs?.length ? editing.specs.map((s) => ({ ...s })) : []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const priceN = Number(price);
  const oldN = Number(oldPrice);
  const oldBad = oldPrice !== '' && !(oldN > priceN);
  const discount = oldPrice !== '' && !oldBad && priceN > 0 ? Math.round((1 - priceN / oldN) * 100) : 0;

  const addFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) toast(t('Можно загрузить не больше {n} фото', { n: MAX_PHOTOS }), 'error');
    setUploading(true);
    const added = [];
    try {
      for (const f of files.slice(0, Math.max(0, room))) {
        if (f.size > MAX_FILE) { toast(t('Файл «{name}» больше 2 МБ — пропущен', { name: f.name }), 'error'); continue; }
        added.push(await api.uploadImage(f));
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (added.length) setPhotos((p) => [...p, ...added]);
      setUploading(false);
    }
  };

  const move = (i, to) => setPhotos((p) => {
    if (to < 0 || to >= p.length) return p;
    const a = [...p];
    [a[i], a[to]] = [a[to], a[i]];
    return a;
  });
  const makeMain = (i) => setPhotos((p) => [p[i], ...p.filter((_, k) => k !== i)]);
  const removePhoto = (i) => setPhotos((p) => p.filter((_, k) => k !== i));

  const setSpec = (i, key, v) => setSpecs((s) => s.map((x, k) => (k === i ? { ...x, [key]: v } : x)));

  const submit = async (e) => {
    e.preventDefault();
    if (saving || uploading) return;
    setSubmitted(true);
    if (!title.trim() || !price || !photos.length) {
      toast(t('Заполните название, цену и загрузите фото товара'), 'error');
      return;
    }
    if (oldBad) { toast(t('Старая цена должна быть выше текущей'), 'error'); return; }
    const cleanSpecs = specs
      .map((s) => ({ name: s.name.trim(), value: s.value.trim() }))
      .filter((s) => s.name || s.value);
    if (cleanSpecs.some((s) => !s.name || !s.value)) {
      toast(t('В характеристике нужно заполнить и название, и значение'), 'error');
      return;
    }
    const payload = {
      title: title.trim(), description: description.trim(), category, subcategory,
      price: priceN, oldPrice: oldPrice ? oldN : null, stock: Number(stock || 0),
      image: photos[0], images: photos.slice(1), specs: cleanSpecs,
    };
    setSaving(true);
    try {
      if (editing) await api.updateProduct(editing.id, payload);
      else await api.createProduct(payload);
      toast(editing ? t('Изменения сохранены') : t('Товар опубликован на витрине'));
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const subGroups = taxonomy.find((c) => c.name === category)?.groups || [];

  return (
    <section className={`ztx-seller-card ${editing ? 'ztx-seller-form-edit' : ''}`} aria-labelledby="p-form-title">
      <div className="ztx-seller-card-head">
        <h3 id="p-form-title" style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>
          {editing ? t('Редактировать товар') : t('Добавить новый товар')}
        </h3>
        {editing && <button type="button" className="ztx-seller-btn" onClick={onCancel}>{t('Отменить редактирование')}</button>}
      </div>
      <form onSubmit={submit} className="ztx-seller-card-pad" noValidate>
        <div className="ztx-seller-grid2">
          <div className="ztx-seller-col">
            <div className="ztx-seller-field">
              <label htmlFor="p-title">{t('Название товара')}</label>
              <input id="p-title" className="ztx-seller-input" maxLength={200} placeholder={t('Например: Смартфон Zetex Pro 15')} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={submitted && !title.trim()} required />
            </div>

            <div className="ztx-seller-row" style={{ alignItems: 'flex-start' }}>
              <div className="ztx-seller-field" style={{ flex: '1 1 130px' }}>
                <label htmlFor="p-price">{t('Цена (в сумах)')}</label>
                <input id="p-price" type="number" min="1" inputMode="numeric" className="ztx-seller-input" placeholder="1200000" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={submitted && !price} required />
              </div>
              <div className="ztx-seller-field" style={{ flex: '1 1 130px' }}>
                <label htmlFor="p-old">{t('Старая цена')}</label>
                <input id="p-old" type="number" min="1" inputMode="numeric" className="ztx-seller-input" placeholder="1500000" value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} aria-invalid={oldBad} aria-describedby="p-old-hint" />
              </div>
              <div className="ztx-seller-field" style={{ flex: '1 1 100px' }}>
                <label htmlFor="p-stock">{t('В наличии, шт.')}</label>
                <input id="p-stock" type="number" min="0" inputMode="numeric" className="ztx-seller-input" value={stock} onChange={(e) => setStock(e.target.value)} />
              </div>
            </div>
            <p id="p-old-hint" className={oldBad ? 'ztx-seller-err' : 'ztx-seller-hint'} style={{ marginTop: -8 }} role={oldBad ? 'alert' : undefined}>
              {oldBad
                ? t('Старая цена должна быть выше текущей')
                : discount > 0
                  ? t('Покупатели увидят скидку −{n}% и зачёркнутую старую цену', { n: discount })
                  : t('Необязательно. Укажите цену до скидки — на карточке появится скидка.')}
            </p>

            <div className="ztx-seller-field">
              <label htmlFor="p-desc">{t('Описание')}</label>
              <textarea id="p-desc" rows={4} maxLength={5000} className="ztx-seller-input" placeholder={t('Комплектация, гарантия, особенности…')} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="ztx-seller-field">
              <span className="ztx-seller-label" id="p-cat-l">{t('Категория')}</span>
              <div className="ztx-seller-cats" role="group" aria-labelledby="p-cat-l">
                {taxonomy.map((cat) => {
                  const Icon = iconFor(cat.icon);
                  return (
                    <button type="button" key={cat.name} className="ztx-seller-cat" aria-pressed={category === cat.name} onClick={() => { setCategory(cat.name); setSubcategory(''); }}>
                      <Icon size={18} aria-hidden="true" />
                      <span>{t(cat.name)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="ztx-seller-field">
              <label htmlFor="p-sub">{t('Подкатегория')}</label>
              <select id="p-sub" className="ztx-seller-input" value={subcategory} onChange={(e) => setSubcategory(e.target.value)}>
                <option value="">{t('Не выбрана')}</option>
                {subGroups.map((g) => (
                  <optgroup key={g.name} label={t(g.name)}>
                    {g.items.map((it) => <option key={it} value={it}>{t(it)}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="ztx-seller-col">
            <div className="ztx-seller-field">
              <span className="ztx-seller-label" id="p-photos-l">{t('Фотографии товара ({n} из {max})', { n: photos.length, max: MAX_PHOTOS })}</span>
              <ul className="ztx-seller-gallery" aria-labelledby="p-photos-l">
                {photos.map((src, i) => (
                  <li key={src} className="ztx-seller-thumb">
                    {i === 0 && <span className="ztx-seller-badge brand tag">{t('Главное')}</span>}
                    <img src={imgUrl(src)} alt={t('Фото {n}', { n: i + 1 })} onError={hideBrokenImg} />
                    <div className="ztx-seller-thumb-bar">
                      <button type="button" className="ztx-seller-iconbtn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={t('Сдвинуть фото {n} влево', { n: i + 1 })} title={t('Влево')}><ArrowLeft size={16} /></button>
                      <button type="button" className="ztx-seller-iconbtn brand" onClick={() => makeMain(i)} disabled={i === 0} aria-label={t('Сделать фото {n} главным', { n: i + 1 })} title={t('Сделать главным')}><Star size={16} /></button>
                      <button type="button" className="ztx-seller-iconbtn" onClick={() => move(i, i + 1)} disabled={i === photos.length - 1} aria-label={t('Сдвинуть фото {n} вправо', { n: i + 1 })} title={t('Вправо')}><ArrowRight size={16} /></button>
                      <button type="button" className="ztx-seller-iconbtn danger" onClick={() => removePhoto(i)} aria-label={t('Удалить фото {n}', { n: i + 1 })} title={t('Удалить')}><X size={16} /></button>
                    </div>
                  </li>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <li style={{ position: 'relative' }}>
                    <label className="ztx-seller-add">
                      <Upload size={24} aria-hidden="true" />
                      <span>{uploading ? t('Загружаем…') : t('Добавить фото')}</span>
                      <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={addFiles} disabled={uploading} />
                    </label>
                  </li>
                )}
              </ul>
              <p className="ztx-seller-hint">{t('PNG, JPG, WEBP до 2 МБ. Первое фото — главное, оно показывается в каталоге.')}</p>
              {submitted && !photos.length && <p className="ztx-seller-err" role="alert">{t('Загрузите хотя бы одно фото')}</p>}
            </div>

            <div className="ztx-seller-field">
              <span className="ztx-seller-label" id="p-specs-l">{t('Характеристики ({n} из {max})', { n: specs.length, max: MAX_SPECS })}</span>
              <div className="ztx-seller-specs" role="group" aria-labelledby="p-specs-l">
                {specs.map((s, i) => (
                  <div className="ztx-seller-spec" key={i}>
                    <input className="ztx-seller-input" maxLength={60} placeholder={t('Название')} aria-label={t('Название характеристики {n}', { n: i + 1 })} value={s.name} onChange={(e) => setSpec(i, 'name', e.target.value)} />
                    <input className="ztx-seller-input" maxLength={200} placeholder={t('Значение')} aria-label={t('Значение характеристики {n}', { n: i + 1 })} value={s.value} onChange={(e) => setSpec(i, 'value', e.target.value)} />
                    <button type="button" className="ztx-seller-iconbtn danger" onClick={() => setSpecs((a) => a.filter((_, k) => k !== i))} aria-label={t('Удалить характеристику {n}', { n: i + 1 })}><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <div>
                <button type="button" className="ztx-seller-btn" disabled={specs.length >= MAX_SPECS} onClick={() => setSpecs((a) => [...a, { name: '', value: '' }])}>
                  <Plus size={14} aria-hidden="true" /> {t('Добавить характеристику')}
                </button>
              </div>
              <p className="ztx-seller-hint">{t('Например: «Память» — «256 ГБ». Показываются на странице товара.')}</p>
            </div>

            {editing && editing.status !== 'active' && (
              <div className="ztx-seller-banner warn" role="note">
                {t('Товар скрыт из каталога модератором и не виден покупателям.')}
              </div>
            )}
          </div>
        </div>

        <button type="submit" className={`ztx-seller-btn big ${editing ? 'primary' : 'accent'}`} disabled={saving || uploading} style={{ width: '100%', marginTop: 24 }}>
          {saving ? t('Сохраняем…') : editing ? t('Сохранить изменения') : t('Опубликовать товар на Zetex')}
        </button>
      </form>
    </section>
  );
}

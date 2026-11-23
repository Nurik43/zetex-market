import { User, Building, FileText, Briefcase } from 'lucide-react';
import { t } from '../i18n';

export default function RegisterForm({ role, formData, onChange, inputStyle }) {
  const fieldWrapper = { display: 'flex', flexDirection: 'column', gap: '6px' };
  const labelStyle = { fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' };
  const iconStyle = { position: 'absolute', left: '14px', top: '12px', zIndex: 1 };

  // Общий стиль для инпутов с иконкой
  const inputWithIcon = { ...inputStyle, paddingLeft: '42px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {role === 'buyer' ? (
        // РЕГИСТРАЦИЯ ПОКУПАТЕЛЯ
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={fieldWrapper}>
            <label style={labelStyle}>{t('Имя')}</label>
            <div style={{ position: 'relative' }}>
              <User size={16} color="var(--ink-3)" style={iconStyle} />
              <input placeholder={t('Иван')} value={formData.firstName || ''} onChange={(e) => onChange('firstName', e.target.value)} style={inputWithIcon} />
            </div>
          </div>
          <div style={fieldWrapper}>
            <label style={labelStyle}>{t('Фамилия')}</label>
            <div style={{ position: 'relative' }}>
              <User size={16} color="var(--ink-3)" style={iconStyle} />
              <input placeholder={t('Иванов')} value={formData.lastName || ''} onChange={(e) => onChange('lastName', e.target.value)} style={inputWithIcon} />
            </div>
          </div>
        </div>
      ) : (
        // РЕГИСТРАЦИЯ ПРОДАВЦА
        <>
          <div style={fieldWrapper}>
            <label style={labelStyle}>{t('Название компании')}</label>
            <div style={{ position: 'relative' }}>
              <Building size={16} color="var(--ink-3)" style={iconStyle} />
              <input placeholder={t('ООО «Текстиль»')} value={formData.companyName || ''} onChange={(e) => onChange('companyName', e.target.value)} style={inputWithIcon} />
            </div>
          </div>
          <div style={fieldWrapper}>
            <label style={labelStyle}>{t('ИНН')}</label>
            <div style={{ position: 'relative' }}>
              <FileText size={16} color="var(--ink-3)" style={iconStyle} />
              <input placeholder="0000000000" value={formData.inn || ''} onChange={(e) => onChange('inn', e.target.value)} style={inputWithIcon} />
            </div>
          </div>
          <div style={fieldWrapper}>
            <label style={labelStyle}>{t('Сфера деятельности')}</label>
            <div style={{ position: 'relative' }}>
              <Briefcase size={16} color="var(--ink-3)" style={iconStyle} />
              <input placeholder={t('Напр. Оптовая торговля')} value={formData.category || ''} onChange={(e) => onChange('category', e.target.value)} style={inputWithIcon} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
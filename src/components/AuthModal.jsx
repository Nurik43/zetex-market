import { useState } from 'react';
import { t } from '../i18n';
import { Mail, Lock, User, Eye, EyeOff, ArrowRight, ChevronDown, X, ShoppingBag, Store } from 'lucide-react';
import { api } from '../api';

const COUNTRIES = [
  { code: '+998', flag: '🇺🇿', name: 'Узбекистан', mask: '(XX) XXX-XX-XX', maxLength: 9 },
  { code: '+7', flag: '🇰🇿', name: 'Казахстан', mask: '(XXX) XXX-XX-XX', maxLength: 10 },
  { code: '+7', flag: '🇷🇺', name: 'Россия', mask: '(XXX) XXX-XX-XX', maxLength: 10 },
  { code: '+996', flag: '🇰🇬', name: 'Кыргызстан', mask: '(XXX) XX-XX-XX', maxLength: 9 },
  { code: '+992', flag: '🇹🇯', name: 'Таджикистан', mask: '(XX) XXX-XX-XX', maxLength: 9 }
];

export default function AuthModal({ isOpen, onClose, onAuthSuccess }) {
  const [isSignUp, setIsSignUp] = useState(false); 
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState('buyer'); // 'buyer' или 'seller'
  
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [isCountryDropdownOpen, setIsCountryDropdownOpen] = useState(false);
  const [rawPhone, setRawPhone] = useState(''); 

  const [formData, setFormData] = useState({
    
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '',
    inn: ''
  });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [needCode, setNeedCode] = useState(false); // администратору с 2FA нужен код из приложения
  const [otp, setOtp] = useState('');

  if (!isOpen) return null;

  const validateEmail = (email) => {
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return regex.test(email);
  };

  const checkPasswordStrength = (password) => {
    let score = 0;
    if (password.length >= 8) score++; 
    if (/[A-Z]/.test(password)) score++; 
    if (/[a-z]/.test(password)) score++; 
    if (/[0-9]/.test(password)) score++; 
    return score;
  };

  const getPasswordStrengthLabel = (score) => {
    if (!formData.password) return { text: '', color: 'var(--line-2)', width: '0%' };
    if (score <= 1) return { text: t('Слишком слабый'), color: 'var(--danger)', width: '25%' };
    if (score === 2) return { text: t('Средний уровень'), color: '#f59e0b', width: '50%' };
    if (score === 3) return { text: t('Хороший пароль'), color: '#3b82f6', width: '75%' };
    return { text: t('Идеально надежный!'), color: 'var(--accent)', width: '100%' };
  };

  const passwordScore = checkPasswordStrength(formData.password);
  const strength = getPasswordStrengthLabel(passwordScore);

  const formatPhoneNumber = (value, mask) => {
    let digits = value.replace(/\D/g, '');
    let formatted = '';
    let digitIndex = 0;

    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 'X') {
        if (digitIndex >= digits.length) break;
        formatted += digits[digitIndex];
        digitIndex++;
      } else {
        if (digitIndex >= digits.length) break;
        formatted += mask[i];
      }
    }
    return formatted;
  };

  const handlePhoneChange = (e) => {
    const inputDigits = e.target.value.replace(/\D/g, '');
    if (inputDigits.length <= selectedCountry.maxLength) {
      setRawPhone(inputDigits);
    }
    setError('');
  };

  const handleInputChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    setError(''); 
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!validateEmail(formData.email)) {
      setError(t('Пожалуйста, введите корректный адрес почты (например, name@domain.com)'));
      return;
    }

    try {
      setLoading(true);

      // --- РЕГИСТРАЦИЯ ---
      if (isSignUp) {
        if (!formData.firstName.trim() || !formData.lastName.trim() || !rawPhone || !formData.password) {
          setError(t('Пожалуйста, заполните все поля корректно'));
          return;
        }
        if (formData.firstName.trim().length < 2 || formData.lastName.trim().length < 2) {
          setError(t('Имя и Фамилия должны содержать не менее 2 символов'));
          return;
        }
        if (rawPhone.length < selectedCountry.maxLength) {
          setError(t('Номер телефона введен не полностью'));
          return;
        }
        if (passwordScore < 4) {
          setError(t('Пароль должен содержать минимум 8 символов (заглавная, строчная и цифра)'));
          return;
        }
        if (role === 'seller' && (!formData.companyName.trim() || !/^\d{9,14}$/.test(formData.inn.trim()))) {
          setError(t('Для продавца укажите название компании и ИНН (9–14 цифр)'));
          return;
        }

        if (!acceptTerms) {
          setError(t('Чтобы зарегистрироваться, примите условия соглашения и политику конфиденциальности'));
          return;
        }

        const data = await api.register({
          acceptTerms: true,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim(),
          phone: `${selectedCountry.code} ${formatPhoneNumber(rawPhone, selectedCountry.mask)}`,
          password: formData.password,
          role,
          ...(role === 'seller' ? { companyName: formData.companyName.trim(), inn: formData.inn.trim() } : {})
        });
        onAuthSuccess(data);
      }
      // --- ВХОД ---
      else {
        if (!formData.email || !formData.password) {
          setError(t('Введите электронную почту и пароль'));
          return;
        }
        const data = await api.login({ email: formData.email.trim(), password: formData.password, ...(needCode ? { code: otp.replace(/\s/g, '') } : {}) });
        setNeedCode(false); setOtp('');
        onAuthSuccess(data);
      }
      setFormData({ firstName: '', lastName: '', email: '', password: '', companyName: '', inn: '' });
      setRawPhone('');
    } catch (err) {
      if (err.need2fa) setNeedCode(true);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      backgroundColor: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', 
      zIndex: 9999 
    }} role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      
      <style>{`
        input:-webkit-autofill,
        input:-webkit-autofill:hover, 
        input:-webkit-autofill:focus {
          -webkit-text-fill-color: var(--ink) !important;
          box-shadow: 0 0 0px 1000px var(--surface) inset !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>

      <div style={{
        backgroundColor: 'var(--surface)', borderRadius: '24px', padding: '40px',
        width: '100%', maxWidth: '440px', maxHeight: '96vh', overflowY: 'auto', margin: '0 12px', boxShadow: '0 20px 50px rgba(0,0,0,0.1)',
        border: '1px solid var(--soft)', position: 'relative'
      }}>
        
        <button 
          onClick={onClose}
          type="button"
          style={{
            position: 'absolute', top: '24px', right: '24px', background: 'none',
            border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex',
            padding: '6px', borderRadius: '50%', backgroundColor: 'var(--soft)'
          }}
        >
          <X size={18} />
        </button>
        
        <h2 style={{ fontSize: '26px', fontWeight: '800', color: 'var(--ink)', margin: '0 0 8px 0', letterSpacing: '-0.5px' }}>
          {isSignUp ? t('Создать аккаунт') : t('Войти в систему')}
        </h2>
        <p style={{ color: 'var(--ink-2)', fontSize: '14px', margin: '0 0 24px 0' }}>
          {isSignUp ? t('Выберите тип профиля и заполните данные') : t('Введите свои данные для доступа к маркетплейсу')}
        </p>

        {error && (
          <div style={{ 
            backgroundColor: 'var(--danger-tint)', color: 'var(--danger)', padding: '12px 16px', 
            borderRadius: '12px', fontSize: '14px', fontWeight: '600', marginBottom: '20px',
            border: '1px solid var(--danger-tint)'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          
          {/* НОВОЕ: Переключатель Роли (Покупатель / Продавец) при Регистрации */}
          {isSignUp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '4px' }}>
              <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Кто вы на Zetex?')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div 
                  onClick={() => setRole('buyer')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '12px', borderRadius: '12px', border: `2px solid ${role === 'buyer' ? 'var(--brand)' : 'var(--line)'}`,
                    backgroundColor: role === 'buyer' ? 'var(--brand-tint)' : 'var(--surface)', cursor: 'pointer',
                    fontSize: '14px', fontWeight: '600', color: role === 'buyer' ? 'var(--brand)' : 'var(--ink-2)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <ShoppingBag size={16} />
                  {t('Покупатель')}
                </div>
                <div 
                  onClick={() => setRole('seller')}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '12px', borderRadius: '12px', border: `2px solid ${role === 'seller' ? 'var(--brand)' : 'var(--line)'}`,
                    backgroundColor: role === 'seller' ? 'var(--brand-tint)' : 'var(--surface)', cursor: 'pointer',
                    fontSize: '14px', fontWeight: '600', color: role === 'seller' ? 'var(--brand)' : 'var(--ink-2)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Store size={16} />
                  {t('Продавец')}
                </div>
              </div>
            </div>
          )}

          {isSignUp && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Имя')}</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <User size={16} color="var(--ink-3)" style={{ position: 'absolute', left: '14px' }} />
                  <input 
                    type="text" required autoComplete="off"
                    value={formData.firstName} onChange={(e) => handleInputChange('firstName', e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Фамилия')}</label>
                <input 
                  type="text" required autoComplete="off"
                  value={formData.lastName} onChange={(e) => handleInputChange('lastName', e.target.value)}
                  style={{ ...inputStyle, paddingLeft: '14px' }}
                />
              </div>
            </div>
          )}

          {/* Электронная почта */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Электронная почта')}</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={16} color="var(--ink-3)" style={{ position: 'absolute', left: '14px' }} />
              <input 
                type="email" required autoComplete="username"
                value={formData.email} onChange={(e) => handleInputChange('email', e.target.value)}
                style={{
                  ...inputStyle,
                  borderColor: formData.email && !validateEmail(formData.email) ? 'var(--danger)' : 'var(--line-2)'
                }}
              />
            </div>
          </div>

          {isSignUp && role === 'seller' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Название компании')}</label>
                <input type="text" autoComplete="off" placeholder={t('ООО «Текстиль»')}
                  value={formData.companyName} onChange={(e) => handleInputChange('companyName', e.target.value)}
                  style={{ ...inputStyle, paddingLeft: '14px' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('ИНН')}</label>
                <input type="text" inputMode="numeric" autoComplete="off" placeholder="000000000"
                  value={formData.inn} onChange={(e) => handleInputChange('inn', e.target.value.replace(/\D/g, '').slice(0, 14))}
                  style={{ ...inputStyle, paddingLeft: '14px' }} />
              </div>
            </div>
          )}

          {/* Номер телефона */}
          {isSignUp && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Номер телефона')}</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <div 
                  onClick={() => setIsCountryDropdownOpen(!isCountryDropdownOpen)}
                  style={{
                    position: 'absolute', left: '12px', display: 'flex', alignItems: 'center', 
                    gap: '4px', cursor: 'pointer', userSelect: 'none', zIndex: 10,
                    paddingRight: '8px', borderRight: '1px solid var(--line)'
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{selectedCountry.flag}</span>
                  <span style={{ fontSize: '14px', color: 'var(--ink-2)', fontWeight: '500' }}>{selectedCountry.code}</span>
                  <ChevronDown size={14} color="var(--ink-2)" />
                </div>

                {isCountryDropdownOpen && (
                  <div style={{
                    position: 'absolute', top: '48px', left: 0, backgroundColor: 'var(--surface)',
                    border: '1px solid var(--line)', borderRadius: '12px', width: '220px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.08)', zIndex: 20, padding: '6px'
                  }}>
                    {COUNTRIES.map((country, idx) => (
                      <div 
                        key={idx}
                        onClick={() => {
                          setSelectedCountry(country);
                          setRawPhone(''); 
                          setIsCountryDropdownOpen(false);
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                          borderRadius: '8px', cursor: 'pointer', fontSize: '14px', color: 'var(--ink)'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--soft)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <span>{country.flag}</span>
                        <span style={{ fontWeight: '600', minWidth: '40px' }}>{country.code}</span>
                        <span style={{ color: 'var(--ink-2)' }}>{t(country.name)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <input 
                  type="text" required autoComplete="off"
                  placeholder={selectedCountry.mask.replace(/X/g, '•')}
                  value={formatPhoneNumber(rawPhone, selectedCountry.mask)} 
                  onChange={handlePhoneChange}
                  style={{ ...inputStyle, paddingLeft: selectedCountry.code.length === 2 ? '90px' : '105px' }}
                />
              </div>
            </div>
          )}

          {/* Пароль */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Пароль')}</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={16} color="var(--ink-3)" style={{ position: 'absolute', left: '14px' }} />
              <input 
                type={showPassword ? 'text' : 'password'} required autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={formData.password} onChange={(e) => handleInputChange('password', e.target.value)}
                style={{ ...inputStyle, paddingRight: '44px' }}
              />
              <button 
                type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {!isSignUp && needCode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
                <label htmlFor="ztx-otp" style={{ fontSize: '13px', color: 'var(--ink-2)', fontWeight: '600' }}>{t('Код из приложения-аутентификатора')}</label>
                <input id="ztx-otp" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus required value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/[^\d ]/g, '')); setError(''); }}
                  placeholder="000000" style={{ ...inputStyle, paddingLeft: '14px', letterSpacing: '.3em', textAlign: 'center' }} />
              </div>
            )}

            {isSignUp && formData.password && (
              <div style={{ marginTop: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: strength.color, fontWeight: '700' }}>{strength.text}</span>
                </div>
                <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: strength.width, height: '100%', backgroundColor: strength.color, transition: 'all 0.3s' }} />
                </div>
              </div>
            )}
          </div>

          {isSignUp && (
            <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--ink-2)', lineHeight: 1.45, cursor: 'pointer' }}>
              <input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} style={{ marginTop: '2px', flex: 'none' }} />
              <span>
                {t('Я принимаю')} <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)' }}>{t('пользовательское соглашение')}</a> {t('и')} <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)' }}>{t('политику конфиденциальности')}</a>
              </span>
            </label>
          )}

          <button 
            type="submit"
            disabled={loading}
            style={{ 
              opacity: loading ? 0.7 : 1,
              backgroundColor: 'var(--brand)', color: 'var(--on-brand)', border: 'none', padding: '14px', 
              borderRadius: '12px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '6px',
              boxShadow: '0 4px 14px rgba(31, 79, 224, 0.15)'
            }}
          >
            {loading ? t('Подождите…') : isSignUp ? t('Зарегистрироваться') : t('Войти в личный кабинет')}
            <ArrowRight size={16} />
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px', color: 'var(--ink-2)' }}>
          {isSignUp ? t('Уже есть аккаунт?') : t('Впервые у нас?')}
          <span 
            onClick={() => { setIsSignUp(!isSignUp); setError(''); setRawPhone(''); }}
            style={{ color: 'var(--brand)', fontWeight: '700', marginLeft: '6px', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isSignUp ? t('Войти') : t('Создать аккаунт')}
          </span>
        </div>

        <button 
          type="button"
          onClick={onClose}
          style={{
            display: 'block', width: '100%', background: 'none', border: 'none',
            color: 'var(--ink-3)', marginTop: '16px', cursor: 'pointer', fontSize: '14px',
            fontWeight: '600', transition: 'color 0.2s'
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--ink)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--ink-3)'}
        >
          ← Вернуться назад к покупкам
        </button>

      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '12px 14px 12px 42px',
  borderRadius: '12px',
  border: '1px solid var(--line-2)',
  fontSize: '15px',
  outline: 'none',
  backgroundColor: 'var(--surface)',
  color: 'var(--ink)',
  transition: 'border-color 0.2s ease'
};
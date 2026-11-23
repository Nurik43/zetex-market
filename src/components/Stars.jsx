import { useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { t } from '../i18n';
import './stars.css';

/**
 * Звёзды рейтинга. Без onChange — только показ (value может быть дробным),
 * с onChange — выбор оценки (radiogroup, стрелки/цифры на клавиатуре).
 */
export default function Stars({ value = 0, size = 16, onChange, label }) {
  const [hover, setHover] = useState(0);
  const refs = useRef([]);
  const shown = onChange && hover ? hover : value;

  if (!onChange) {
    return (
      <span className="ztx-stars" role="img" aria-label={label || t('Оценка {n} из 5', { n: value })}>
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, shown - (i - 1)));
          return (
            <span key={i} className="ztx-stars-cell" style={{ width: size, height: size }}>
              <Star size={size} className="ztx-stars-bg" />
              <span className="ztx-stars-fg" style={{ width: `${fill * 100}%` }}>
                <Star size={size} fill="currentColor" />
              </span>
            </span>
          );
        })}
      </span>
    );
  }

  const pick = (n) => {
    const v = Math.max(1, Math.min(5, n));
    onChange(v);
    refs.current[v - 1]?.focus();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); pick((value || 0) + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); pick((value || 2) - 1); }
    else if (/^[1-5]$/.test(e.key)) pick(Number(e.key));
  };

  return (
    <span className="ztx-stars ztx-stars-input" role="radiogroup" aria-label={label || t('Ваша оценка')} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          ref={(el) => { refs.current[i - 1] = el; }}
          role="radio"
          aria-checked={value === i}
          aria-label={t('Оценка {n} из 5', { n: i })}
          tabIndex={value === i || (!value && i === 1) ? 0 : -1}
          className={`ztx-stars-btn ${i <= shown ? 'on' : ''}`}
          onClick={() => onChange(i)}
          onKeyDown={onKey}
          onMouseEnter={() => setHover(i)}
        >
          <Star size={size} fill={i <= shown ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

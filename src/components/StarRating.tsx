import { useId } from 'react';

interface StarRatingProps {
  value: number;
  max?: number;
  large?: boolean;
  label?: string;
}

const STAR_PATH =
  'M12 1.9 14.9 8.2 21.8 9 16.6 13.7 18 20.6 12 17.1 6 20.6 7.4 13.7 2.2 9 9.1 8.2 12 1.9Z';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function StarRating({ value, max = 3, large = false, label }: StarRatingProps) {
  const clipSeed = useId();
  const clampedValue = clamp(value, 0, max);

  return (
    <span
      aria-label={label}
      className={`star-rating ${large ? 'star-rating-large' : ''}`}
      role={label ? 'img' : undefined}
    >
      {Array.from({ length: max }, (_, index) => {
        const fillPercent = clamp(clampedValue - index, 0, 1) * 100;
        const clipId = `${clipSeed}-star-${index}`;

        return (
          <svg
            aria-hidden="true"
            className="star-rating-icon"
            key={clipId}
            viewBox="0 0 24 24"
          >
            <defs>
              <clipPath id={clipId}>
                <rect height="24" width={`${fillPercent}%`} x="0" y="0" />
              </clipPath>
            </defs>
            <path className="star-rating-empty" d={STAR_PATH} />
            <path className="star-rating-fill" clipPath={`url(#${clipId})`} d={STAR_PATH} />
          </svg>
        );
      })}
    </span>
  );
}

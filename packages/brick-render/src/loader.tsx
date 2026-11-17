import { useState } from 'react';
import './loader.css';

/** How far along a load is, as a count of things done. */
export interface LoaderProgress {
  done: number;
  total: number;
}

/**
 * A card over the view while something loads, shared by the workshop and Brick World. It fades in
 * only after a short delay, so quick loads never flash it, and fades out once `label` is null.
 * The bar runs indeterminate until there is progress to show. Its parent must be positioned.
 */
export function Loader({
  label,
  progress = null,
}: {
  /** What is loading, or null to hide the card. */
  label: string | null;
  progress?: LoaderProgress | null;
}) {
  // The last label stays on the card while it fades out, so the text doesn't blank first.
  const [shown, setShown] = useState(label ?? '');
  if (label && label !== shown) setShown(label);
  const fraction = label && progress && progress.total ? progress.done / progress.total : null;
  return (
    <div
      className="viewport-loader"
      data-active={label ? '' : undefined}
      role="status"
      aria-live="polite"
      aria-hidden={!label}
    >
      <div className="viewport-loader-card">
        <p>{shown}</p>
        <div
          className="viewport-loader-bar"
          data-indeterminate={fraction === null ? '' : undefined}
          role="progressbar"
          aria-label={shown}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        >
          <span style={fraction === null ? undefined : { transform: `scaleX(${fraction})` }} />
        </div>
        {fraction !== null && progress && (
          <small>
            {progress.done.toLocaleString()} of {progress.total.toLocaleString()}
          </small>
        )}
      </div>
    </div>
  );
}

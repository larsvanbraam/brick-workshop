import { useEffect, useState } from 'react';
import type { BuildProgress } from './Scene';

export type LoaderStage = 'preparing' | 'parts' | 'placing' | null;

const LABELS: Record<Exclude<LoaderStage, null>, string> = {
  preparing: 'Preparing build…',
  parts: 'Loading parts…',
  placing: 'Placing bricks…',
};

/**
 * A card over the viewport while a build is being swapped in. It fades in only after a short
 * delay, so quick changes never flash it, and fades out once the model is complete. The bar runs
 * indeterminate until there is a brick count to show.
 */
export function ViewportLoader({
  stage,
  progress,
}: {
  stage: LoaderStage;
  progress: BuildProgress | null;
}) {
  // The last stage stays on the card while it fades out, so the text doesn't blank first.
  const [shown, setShown] = useState<Exclude<LoaderStage, null>>('parts');
  useEffect(() => {
    if (stage) setShown(stage);
  }, [stage]);
  const fraction =
    stage === 'placing' && progress && progress.total ? progress.done / progress.total : null;
  return (
    <div
      className="viewport-loader"
      data-active={stage ? '' : undefined}
      role="status"
      aria-live="polite"
      aria-hidden={!stage}
    >
      <div className="viewport-loader-card floating">
        <p>{LABELS[shown]}</p>
        <div
          className="viewport-loader-bar"
          data-indeterminate={fraction === null ? '' : undefined}
          role="progressbar"
          aria-label={LABELS[shown]}
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

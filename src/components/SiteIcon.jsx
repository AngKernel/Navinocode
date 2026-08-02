import React, { useEffect, useMemo, useState } from 'react';
import { computeAppLetter } from '@/lib/utils';
import { getIconCandidates } from '@/lib/siteIcons';

const SiteIcon = ({
  app,
  size = 48,
  className = '',
  imageClassName = '',
  fallbackClassName = '',
}) => {
  const candidates = useMemo(
    () => getIconCandidates(app),
    [app?.url, app?.icon, app?.iconMode]
  );
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => setCandidateIndex(0), [candidates.join('|')]);

  const dimensions = { width: `${size}px`, height: `${size}px` };
  const current = candidates[candidateIndex];

  if (!current) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-2xl bg-gray-500 text-white ${fallbackClassName} ${className}`}
        style={dimensions}
        aria-label={`${app?.name || '应用'}的字母图标`}
      >
        <span className="font-bold" style={{ fontSize: `${Math.max(12, Math.round(size * 0.34))}px` }}>
          {computeAppLetter(app || {})}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/90 dark:bg-black/30 ${className}`}
      style={dimensions}
    >
      <img
        src={current}
        alt={`${app?.name || '应用'}图标`}
        className={`h-full w-full object-contain p-1 ${imageClassName}`}
        referrerPolicy="no-referrer"
        onError={() => setCandidateIndex((index) => index + 1)}
      />
    </div>
  );
};

export default SiteIcon;

import React from 'react';

export function TitleEmblemSvg() {
  return (
    <svg
      viewBox="0 0 640 130"
      className="w-full max-w-[560px] h-auto drop-shadow-[0_8px_20px_rgba(0,0,0,0.85)]"
      role="img"
      aria-label="Çağlar Boyu Savaş Online Amblemi"
    >
      <defs>
        <linearGradient id="crestGold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="45%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
        <linearGradient id="plateDark" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#090d16" />
        </linearGradient>
      </defs>

      {/* Outer Forged Iron & Bronze Plaque */}
      <polygon
        points="36,18 604,18 628,65 604,112 36,112 12,65"
        fill="url(#plateDark)"
        stroke="url(#crestGold)"
        strokeWidth="3.5"
      />
      <polygon
        points="44,25 596,25 616,65 596,105 44,105 24,65"
        fill="none"
        stroke="rgba(253, 224, 71, 0.28)"
        strokeWidth="1.5"
      />

      {/* Left Stone-to-Medieval Crossed Halberd Accent */}
      <path
        d="M52,42 L78,88 M78,42 L52,88"
        stroke="#f59e0b"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="65" cy="65" r="9" fill="#0f172a" stroke="#fef08a" strokeWidth="2.5" />

      {/* Right Modern-to-Cyber Energy Spire Accent */}
      <polygon
        points="575,38 590,65 575,92 560,65"
        fill="#0284c7"
        stroke="#7dd3fc"
        strokeWidth="2.5"
      />
      <circle cx="575" cy="65" r="5" fill="#e0f2fe" />

      {/* Primary Emblem Typography */}
      <text
        x="320"
        y="66"
        textAnchor="middle"
        fill="url(#crestGold)"
        fontFamily="Cinzel, Georgia, serif"
        fontWeight="800"
        fontSize="35"
        letterSpacing="3"
      >
        ÇAĞLAR BOYU SAVAŞ
      </text>

      {/* Subtitle Ribbons */}
      <line x1="105" y1="89" x2="185" y2="89" stroke="#f59e0b" strokeWidth="2" />
      <text
        x="320"
        y="93"
        textAnchor="middle"
        fill="#38bdf8"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        fontSize="12.5"
        letterSpacing="4"
      >
        ONLINE CHRONICLES
      </text>
      <line x1="455" y1="89" x2="535" y2="89" stroke="#38bdf8" strokeWidth="2" />
    </svg>
  );
}

export function GoldCoinIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#78350f" stroke="#090d16" strokeWidth="2" />
      <circle cx="12" cy="12" r="8" fill="#f59e0b" />
      <path d="M8 8 A6 6 0 0 1 16 8" stroke="#fef08a" strokeWidth="2" fill="none" />
      <rect x="10.5" y="7.5" width="3" height="9" rx="1" fill="#78350f" />
    </svg>
  );
}

export function XpStarIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon
        points="12,2 15,8.5 22,9.3 17,14.2 18.2,21.2 12,17.8 5.8,21.2 7,14.2 2,9.3 9,8.5"
        fill="#a855f7"
        stroke="#090d16"
        strokeWidth="2"
      />
      <polygon
        points="12,5 14,9.5 18.5,10 15.2,13.2 16,17.8 12,15.5 8,17.8 8.8,13.2 5.5,10 10,9.5"
        fill="#e9d5ff"
      />
    </svg>
  );
}

export function ArchetypeSvgIcon({
  archetype,
  accent,
}: {
  archetype: 'swarmer' | 'ranger' | 'charger' | 'colossus';
  accent: string;
}) {
  if (archetype === 'swarmer') {
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" aria-hidden="true">
        <path
          d="M5 19 L19 5 M14 5 L19 5 L19 10"
          stroke={accent}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="8" cy="16" r="3" fill={accent} />
      </svg>
    );
  }
  if (archetype === 'ranger') {
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" aria-hidden="true">
        <path
          d="M6 4 C14 8, 14 16, 6 20"
          stroke={accent}
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
        <line x1="4" y1="12" x2="20" y2="12" stroke="#f8fafc" strokeWidth="2.2" />
        <polygon points="20,12 16,9 16,15" fill={accent} />
      </svg>
    );
  }
  if (archetype === 'charger') {
    return (
      <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" aria-hidden="true">
        <polygon
          points="3,13 13,6 13,10 21,10 13,18 13,14"
          fill={accent}
          stroke="#090d16"
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6 shrink-0" aria-hidden="true">
      <path
        d="M12 3 L20 6 L20 13 C20 17.5 16.5 20.5 12 22 C7.5 20.5 4 17.5 4 13 L4 6 Z"
        fill={accent}
        stroke="#090d16"
        strokeWidth="2"
      />
      <path d="M12 6 L12 18 M8 11 L16 11" stroke="#090d16" strokeWidth="2.2" />
    </svg>
  );
}

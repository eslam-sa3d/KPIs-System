import { palette } from '@pulse/theme';

/** Decorative dashboard mockup (laptop + tablet + magnifier) for the landing
 *  hero — brand-literal colors via the shared `palette` export (same pattern
 *  as kpi-chart.tsx/response-summary.tsx), not the M3 semantic tokens, since
 *  this is illustration art rather than themeable UI chrome. */
export function LandingHeroIllustration() {
  const W = 640;
  const H = 520;
  const card = '#ffffff';
  const cardBdr = '#e8daf5';
  const sidebarBg = '#f0e8fa';
  const screenBg = '#faf7fe';
  const rowMuted = '#e8daf5';
  const textLight = '#c4a8e0';
  const purple = palette.primary.purple;
  const purpleLight = palette.secondary.purpleLight;
  const coral = palette.primary.coral;

  return (
    <div className="landing-hero-illustration" aria-hidden="true">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: '100%', height: 'auto', filter: 'drop-shadow(0 24px 48px rgba(79,0,140,0.18))' }}
      >
        <defs>
          <filter id="cshadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor={purple} floodOpacity="0.10" />
          </filter>
          <filter id="lshadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="8" stdDeviation="16" floodColor={purple} floodOpacity="0.14" />
          </filter>
          <filter id="mglow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="12" floodColor={purple} floodOpacity="0.25" />
          </filter>
          <clipPath id="screenClip">
            <rect x="102" y="72" width="336" height="224" rx="6" />
          </clipPath>
        </defs>

        {/* Background hex-dot pattern */}
        {Array.from({ length: 7 * 8 }).map((_, i) => {
          const col = i % 7;
          const row = Math.floor(i / 7);
          const cx = col * 90 + (row % 2 === 1 ? 45 : 10) + 10;
          const cy = row * 68 + 20;
          return (
            <polygon
              key={i}
              points={`${cx},${cy - 22} ${cx + 19},${cy - 11} ${cx + 19},${cy + 11} ${cx},${cy + 22} ${cx - 19},${cy + 11} ${cx - 19},${cy - 11}`}
              fill="none"
              stroke="rgba(79,0,140,0.07)"
              strokeWidth="1.2"
            />
          );
        })}

        {/* Laptop */}
        <rect
          x="90"
          y="58"
          width="360"
          height="242"
          rx="14"
          fill={card}
          stroke={cardBdr}
          strokeWidth="2"
          filter="url(#lshadow)"
        />
        <circle cx="270" cy="68" r="3" fill={rowMuted} />
        <rect x="102" y="78" width="336" height="212" rx="6" fill={screenBg} />
        <rect x="102" y="78" width="336" height="28" rx="6" fill={sidebarBg} />
        <rect x="102" y="94" width="336" height="12" fill={sidebarBg} />
        <circle cx="118" cy="92" r="5" fill={coral} opacity="0.85" />
        <circle cx="132" cy="92" r="5" fill="#ffdd40" opacity="0.8" />
        <circle cx="146" cy="92" r="5" fill="#00c48c" opacity="0.8" />
        <rect x="162" y="84" width="150" height="14" rx="7" fill={cardBdr} />
        <rect x="168" y="88" width="80" height="6" rx="3" fill={textLight} />

        <rect x="102" y="106" width="62" height="184" fill={sidebarBg} clipPath="url(#screenClip)" />
        <rect x="114" y="116" width="38" height="12" rx="4" fill={purple} opacity="0.15" />
        <rect x="118" y="119" width="20" height="6" rx="3" fill={purple} opacity="0.7" />
        {[136, 153, 170, 187, 204, 221].map((y, i) => (
          <g key={y}>
            <rect
              x="112"
              y={y}
              width="42"
              height="10"
              rx="5"
              fill={i === 0 ? purple : 'transparent'}
              opacity={i === 0 ? 0.1 : 1}
            />
            <rect
              x="118"
              y={y + 2}
              width={i === 0 ? 28 : 22}
              height="6"
              rx="3"
              fill={i === 0 ? purple : rowMuted}
              opacity={i === 0 ? 0.8 : 1}
            />
            {i === 0 && <rect x="102" y={y} width="3" height="10" rx="1.5" fill={coral} />}
          </g>
        ))}

        <rect x="174" y="114" width="90" height="10" rx="5" fill={purple} opacity="0.25" />
        <rect x="174" y="128" width="56" height="7" rx="3.5" fill={rowMuted} />

        {[
          { color: purple, w: 36 },
          { color: '#00c48c', w: 28 },
          { color: coral, w: 32 },
        ].map(({ color, w }, i) => (
          <g key={i} filter="url(#cshadow)">
            <rect x={174 + i * 88} y="142" width="80" height="48" rx="8" fill={card} stroke={cardBdr} strokeWidth="1" />
            <rect x={174 + i * 88} y="142" width="80" height="4" rx="4" fill={color} opacity="0.8" />
            <rect x={180 + i * 88} y="152" width={w} height="6" rx="3" fill={rowMuted} />
            <rect
              x={180 + i * 88}
              y="163"
              width={i === 1 ? 38 : i === 0 ? 26 : 18}
              height="14"
              rx="4"
              fill={color}
              opacity="0.12"
            />
            <rect
              x={182 + i * 88}
              y="166"
              width={i === 1 ? 28 : i === 0 ? 20 : 14}
              height="8"
              rx="3"
              fill={color}
              opacity="0.9"
            />
          </g>
        ))}

        <g filter="url(#cshadow)">
          <rect x="174" y="200" width="260" height="80" rx="8" fill={card} stroke={cardBdr} strokeWidth="1" />
          <rect x="183" y="210" width="60" height="7" rx="3.5" fill={rowMuted} />
          {(
            [
              [188, 248, 10, 22, purple, 0.9],
              [202, 255, 10, 15, purpleLight, 0.8],
              [216, 244, 10, 26, palette.secondary.moonLight, 0.8],
              [230, 250, 10, 20, coral, 0.9],
              [244, 241, 10, 29, purple, 0.8],
              [258, 247, 10, 23, purpleLight, 0.7],
              [272, 252, 10, 18, palette.secondary.moonLight, 0.8],
              [286, 245, 10, 25, coral, 0.9],
              [300, 248, 10, 22, purple, 0.8],
              [314, 238, 10, 32, purpleLight, 0.8],
              [328, 246, 10, 24, palette.secondary.moonLight, 0.7],
              [342, 242, 10, 28, coral, 0.85],
              [356, 250, 10, 20, purple, 0.7],
              [370, 244, 10, 26, purpleLight, 0.8],
              [384, 239, 10, 31, coral, 0.85],
              [398, 246, 10, 24, palette.secondary.moonLight, 0.8],
              [412, 248, 10, 22, purple, 0.8],
            ] as Array<[number, number, number, number, string, number]>
          ).map(([x, bot, w, h, color, op], i) => (
            <rect key={i} x={x} y={bot - h} width={w} height={h} rx="3" fill={color} opacity={op} />
          ))}
          <line x1="183" y1="270" x2="430" y2="270" stroke={cardBdr} strokeWidth="1" />
        </g>

        <rect x="55" y="300" width="430" height="18" rx="6" fill="#ede4f8" stroke={cardBdr} strokeWidth="1.5" />
        <rect x="55" y="306" width="430" height="12" fill="#e8daf5" />
        <rect x="55" y="300" width="430" height="3" rx="2" fill={cardBdr} />
        <rect x="230" y="308" width="80" height="6" rx="3" fill={cardBdr} />

        {/* Tablet */}
        <g transform="rotate(6, 480, 280)" filter="url(#lshadow)">
          <rect x="390" y="185" width="115" height="155" rx="12" fill={card} stroke={cardBdr} strokeWidth="2" />
          <rect x="399" y="196" width="97" height="133" rx="6" fill={screenBg} />
          <rect x="399" y="196" width="97" height="20" rx="6" fill={sidebarBg} />
          <rect x="399" y="208" width="97" height="8" fill={sidebarBg} />
          <rect x="407" y="200" width="40" height="8" rx="4" fill={rowMuted} />
          {[224, 236, 248].map((y, i) => (
            <rect
              key={y}
              x="407"
              y={y}
              width="81"
              height="8"
              rx="4"
              fill={i === 0 ? sidebarBg : rowMuted}
              opacity="0.7"
            />
          ))}
          <circle cx="447" cy="289" r="26" fill={sidebarBg} />
          <circle cx="447" cy="289" r="26" stroke={cardBdr} strokeWidth="5" fill="none" />
          <circle
            cx="447"
            cy="289"
            r="26"
            stroke={coral}
            strokeWidth="5"
            strokeDasharray="150 163"
            strokeDashoffset="0"
            strokeLinecap="round"
            fill="none"
            transform="rotate(-90 447 289)"
          />
          <text
            x="447"
            y="293"
            textAnchor="middle"
            fill={purple}
            fontSize="11"
            fontWeight="700"
            style={{ fontFamily: 'var(--font-family-base)' }}
          >
            95%
          </text>
          <rect x="432" y="332" width="30" height="3" rx="1.5" fill={cardBdr} />
        </g>

        {/* Magnifying glass */}
        <g transform="translate(295, 195)" filter="url(#mglow)">
          <circle cx="0" cy="0" r="70" fill="rgba(79,0,140,0.06)" stroke={cardBdr} strokeWidth="2" />
          <circle cx="0" cy="0" r="60" fill={card} stroke={purple} strokeWidth="3" />
          <circle cx="0" cy="0" r="44" fill={purple} />
          <circle cx="0" cy="0" r="44" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
          <path d="M-18,2 L-6,16 L20,-12" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="43" y1="43" x2="72" y2="72" stroke={cardBdr} strokeWidth="12" strokeLinecap="round" />
          <line x1="43" y1="43" x2="72" y2="72" stroke={purple} strokeWidth="8" strokeLinecap="round" />
          <line x1="43" y1="43" x2="72" y2="72" stroke={purpleLight} strokeWidth="4" strokeLinecap="round" />
        </g>

        {/* Floating badges */}
        <g transform="translate(68, 90)" filter="url(#cshadow)">
          <rect x="-26" y="-26" width="56" height="56" rx="14" fill={card} stroke={cardBdr} strokeWidth="1.5" />
          <rect x="-26" y="-26" width="56" height="4" rx="4" fill={purple} opacity="0.15" />
          <text
            x="2"
            y="10"
            textAnchor="middle"
            fill={coral}
            fontSize="20"
            fontWeight="800"
            style={{ fontFamily: 'monospace' }}
          >
            {'</>'}
          </text>
        </g>

        <g transform="translate(550, 110)" filter="url(#cshadow)">
          <rect x="-26" y="-26" width="56" height="56" rx="14" fill={card} stroke={cardBdr} strokeWidth="1.5" />
          <ellipse cx="2" cy="5" rx="10" ry="12" fill={coral} opacity="0.9" />
          <ellipse cx="2" cy="-1" rx="8" ry="6" fill={purple} opacity="0.85" />
          {[-1, 4, 9].map((y) => (
            <g key={y}>
              <line x1="-8" y1={y} x2="-18" y2={y - 4} stroke={coral} strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1={y} x2="22" y2={y - 4} stroke={coral} strokeWidth="2" strokeLinecap="round" />
            </g>
          ))}
          <line x1="-2" y1="-7" x2="-8" y2="-17" stroke={purple} strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="-7" x2="12" y2="-17" stroke={purple} strokeWidth="2" strokeLinecap="round" />
        </g>

        <g transform="translate(570, 230)" filter="url(#cshadow)">
          <rect x="-26" y="-30" width="56" height="62" rx="14" fill={card} stroke={cardBdr} strokeWidth="1.5" />
          <rect x="-8" y="-34" width="20" height="10" rx="4" fill={purple} />
          {[-14, -4, 6, 16].map((y, i) => (
            <g key={y}>
              <circle cx="-14" cy={y + 1} r="4" fill={i < 3 ? coral : rowMuted} opacity={i < 3 ? 0.9 : 0.5} />
              {i < 3 && (
                <path
                  d={`M-17,${y + 1} L-15,${y + 3} L-11,${y - 1}`}
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <rect
                x="-4"
                y={y - 2}
                width={i === 0 ? 28 : i === 1 ? 22 : i === 2 ? 26 : 18}
                height="6"
                rx="3"
                fill={i < 3 ? rowMuted : cardBdr}
              />
            </g>
          ))}
        </g>

        <g transform="translate(62, 275)" filter="url(#cshadow)">
          <rect x="-26" y="-26" width="56" height="56" rx="14" fill={card} stroke={cardBdr} strokeWidth="1.5" />
          <path d="M2,-14 L18,0 L18,10 Q18,22 2,28 Q-14,22 -14,10 L-14,0 Z" fill={purple} opacity="0.12" />
          <path
            d="M2,-14 L18,0 L18,10 Q18,22 2,28 Q-14,22 -14,10 L-14,0 Z"
            fill="none"
            stroke={purple}
            strokeWidth="2"
          />
          <path d="M-6,6 L0,13 L11,-2" stroke={purple} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        <ellipse cx="295" cy="325" rx="200" ry="14" fill="rgba(79,0,140,0.08)" />
      </svg>
    </div>
  );
}

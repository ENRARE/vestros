import type { LandingFeature } from './landingContent'

interface LandingFeatureArtworkProps {
  kind: LandingFeature['art']
}

const ART_LABELS: Record<LandingFeature['art'], string> = {
  vesting: 'Metallic USDC token with a scheduled unlock timeline',
  treasury: 'Layered treasury dashboard with allocation bars and trend line',
  grants: 'Connected grant funding network with recipient nodes',
}

export function LandingFeatureArtwork({ kind }: LandingFeatureArtworkProps) {
  const gradientId = `landing-${kind}-metal`

  return (
    <svg className="landing-feature-art" viewBox="0 0 440 220" role="img" aria-label={ART_LABELS[kind]}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E7EBEF" stopOpacity="0.9" />
          <stop offset="0.42" stopColor="#747D87" stopOpacity="0.72" />
          <stop offset="1" stopColor="#22282E" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {kind === 'vesting' && <VestingArtwork gradientId={gradientId} />}
      {kind === 'treasury' && <TreasuryArtwork gradientId={gradientId} />}
      {kind === 'grants' && <GrantArtwork gradientId={gradientId} />}
    </svg>
  )
}

function VestingArtwork({ gradientId }: { gradientId: string }) {
  return (
    <g>
      <path d="M35 176H405" stroke="#313940" strokeWidth="1" />
      <path d="M72 186H194" stroke="#2389E8" strokeOpacity="0.65" strokeWidth="2" />
      <path d="M72 186V181M194 186V181" stroke="#6C7883" strokeWidth="1" />
      <circle cx="72" cy="186" r="4" fill="#2389E8" />
      <circle cx="194" cy="186" r="4" fill="#9199A2" />
      <circle cx="308" cy="186" r="4" fill="#4A535C" />
      <path d="M72 186H308" stroke="#3D464E" strokeDasharray="3 6" strokeWidth="1" />
      <g opacity="0.28">
        <path d="M54 34H386M54 82H386M54 130H386" stroke="#5B6670" strokeDasharray="2 8" />
        <path d="M88 20V164M154 20V164M220 20V164M286 20V164M352 20V164" stroke="#5B6670" strokeDasharray="2 8" />
      </g>
      <g transform="translate(82 24)">
        <path d="M0 37C0 27 22 19 49 19S98 27 98 37V100C98 110 76 118 49 118S0 110 0 100Z" fill="#171C21" stroke="#66727C" strokeWidth="1.2" />
        <ellipse cx="49" cy="37" rx="49" ry="18" fill={`url(#${gradientId})`} stroke="#AEB7BF" strokeOpacity="0.72" strokeWidth="1.2" />
        <ellipse cx="49" cy="37" rx="29" ry="10" fill="#2A3138" stroke="#D6DBDF" strokeOpacity="0.58" />
        <text x="49" y="43" fill="#F5F5F5" fontFamily="Manrope, sans-serif" fontSize="16" fontWeight="800" textAnchor="middle">USDC</text>
        <path d="M15 65C31 76 68 79 84 65" fill="none" stroke="#2389E8" strokeOpacity="0.74" strokeWidth="2" />
      </g>
      <g transform="translate(238 35)">
        <rect x="0" y="25" width="76" height="66" rx="4" fill="#1B2025" stroke="#5D6872" />
        <path d="M17 25V16C17 3 27 0 38 0S59 3 59 16V25" fill="none" stroke="#8C969F" strokeWidth="7" />
        <rect x="30" y="48" width="16" height="23" rx="3" fill="#2389E8" fillOpacity="0.82" />
        <circle cx="38" cy="53" r="2" fill="#E7EBEF" />
        <path d="M38 55V65" stroke="#E7EBEF" strokeWidth="1.4" />
        <path d="M9 101H67" stroke="#3E474F" strokeWidth="2" />
      </g>
      <text x="72" y="205" fill="#6F7A84" fontFamily="Manrope, sans-serif" fontSize="9" letterSpacing="1.5">START</text>
      <text x="178" y="205" fill="#6F7A84" fontFamily="Manrope, sans-serif" fontSize="9" letterSpacing="1.5">CLIFF</text>
      <text x="292" y="205" fill="#6F7A84" fontFamily="Manrope, sans-serif" fontSize="9" letterSpacing="1.5">UNLOCK</text>
    </g>
  )
}

function TreasuryArtwork({ gradientId }: { gradientId: string }) {
  return (
    <g>
      <path d="M38 187H402" stroke="#313940" strokeWidth="1" />
      <g transform="translate(40 25)">
        <rect x="22" y="18" width="280" height="142" rx="5" fill="#111519" stroke="#49535C" />
        <rect x="0" y="0" width="280" height="142" rx="5" fill="#1A1F24" stroke="#6B7680" />
        <path d="M18 34H262" stroke="#354049" />
        <circle cx="20" cy="18" r="3" fill="#2389E8" />
        <circle cx="31" cy="18" r="3" fill="#5A646D" />
        <circle cx="42" cy="18" r="3" fill="#5A646D" />
        <text x="18" y="56" fill="#7E8992" fontFamily="Manrope, sans-serif" fontSize="9" letterSpacing="1">TOTAL BALANCE</text>
        <text x="18" y="80" fill="#F5F5F5" fontFamily="Plus Jakarta Sans, sans-serif" fontSize="23" fontWeight="700">$248.6k</text>
        <path d="M18 119H262" stroke="#303A43" />
        <path d="M18 105L62 92L96 101L132 70L170 83L207 54L262 63" fill="none" stroke="#2389E8" strokeWidth="2.2" />
        <path d="M18 105L62 92L96 101L132 70L170 83L207 54L262 63V119H18Z" fill={`url(#${gradientId})`} fillOpacity="0.15" />
        <circle cx="207" cy="54" r="4" fill="#2389E8" stroke="#D6DBDF" strokeWidth="1.2" />
      </g>
      <g transform="translate(282 64)">
        <rect x="0" y="0" width="105" height="94" rx="4" fill="#20262C" stroke="#65717B" />
        <text x="14" y="20" fill="#7E8992" fontFamily="Manrope, sans-serif" fontSize="8" letterSpacing="1">ALLOCATIONS</text>
        <rect x="14" y="34" width="76" height="7" rx="2" fill="#3C464F" />
        <rect x="14" y="34" width="49" height="7" rx="2" fill="#2389E8" />
        <rect x="14" y="51" width="76" height="7" rx="2" fill="#3C464F" />
        <rect x="14" y="51" width="30" height="7" rx="2" fill="#A4ADB5" />
        <rect x="14" y="68" width="76" height="7" rx="2" fill="#3C464F" />
        <rect x="14" y="68" width="58" height="7" rx="2" fill="#66727C" />
      </g>
    </g>
  )
}

function GrantArtwork({ gradientId }: { gradientId: string }) {
  return (
    <g>
      <path d="M38 181H402" stroke="#313940" strokeWidth="1" />
      <path d="M112 91L215 48L324 91L215 145Z" fill="#20262C" fillOpacity="0.72" stroke="#63707A" />
      <path d="M112 91V145L215 196L324 142V91" fill="#171C21" stroke="#4A555F" />
      <path d="M215 48V145M112 91L215 145L324 91" fill="none" stroke="#74808A" strokeOpacity="0.75" />
      <path d="M215 145V196" stroke="#6F7A84" />
      <path d="M75 48L112 91M355 48L324 91M72 154L112 145M360 154L324 142" stroke="#2389E8" strokeOpacity="0.76" strokeWidth="1.4" />
      <circle cx="75" cy="48" r="15" fill="#242B31" stroke="#A2ABB3" />
      <circle cx="355" cy="48" r="15" fill="#242B31" stroke="#A2ABB3" />
      <circle cx="72" cy="154" r="15" fill="#242B31" stroke="#A2ABB3" />
      <circle cx="360" cy="154" r="15" fill="#242B31" stroke="#A2ABB3" />
      <circle cx="215" cy="145" r="32" fill={`url(#${gradientId})`} stroke="#D6DBDF" strokeOpacity="0.7" />
      <path d="M204 145H226M215 134V156" stroke="#20262C" strokeWidth="3" />
      <path d="M215 113V82" stroke="#2389E8" strokeWidth="2" strokeDasharray="3 5" />
      <circle cx="215" cy="68" r="11" fill="#2389E8" fillOpacity="0.9" stroke="#D6DBDF" strokeWidth="1" />
      <path d="M210 68H220M215 63V73" stroke="#F5F5F5" strokeWidth="1.4" />
      <path d="M58 204H150M280 204H372" stroke="#3D464E" strokeDasharray="2 5" />
      <text x="215" y="214" fill="#6F7A84" fontFamily="Manrope, sans-serif" fontSize="9" letterSpacing="1.5" textAnchor="middle">PROGRAM → BUILDER NETWORK</text>
    </g>
  )
}

/**
 * MiniEstimate — the hero artifact.
 *
 * A miniature of the estimate document customers actually receive: paper
 * card, letterhead, tape-rule, dotted-leader ledger, grade seal and the
 * juniper price panel. Pure presentational markup; every figure uses the
 * mono `figure` class per the design system.
 */
export function MiniEstimate() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[400px] select-none">
      {/* Input chip — the photos that produced this document */}
      <div className="absolute -left-3 -top-5 z-10 rotate-[-2deg] rounded-warm-lg border border-border bg-white px-3.5 py-2.5 shadow-warm-lg sm:-left-8">
        <p className="text-[11px] font-semibold text-text-primary">4 photos received</p>
        <p className="figure mt-0.5 text-[11px] text-text-secondary">
          walls measured: 904 sq ft · confirmed
        </p>
      </div>

      {/* The document */}
      <div className="rotate-[1.2deg] rounded-warm-2xl bg-white p-6 shadow-document">
        {/* Letterhead */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
              Estimate
            </p>
            <p className="font-display text-base font-bold leading-tight text-text-primary">
              Sunbelt Painting Co
            </p>
            <p className="figure mt-0.5 text-[11px] text-text-muted">EST-2026-8841</p>
          </div>
          <div
            className="grade-seal"
            style={{
              color: 'var(--color-tertiary)',
              width: 58,
              height: 58,
              ['--seal-gap' as never]: '#ffffff',
            }}
          >
            <span className="font-display text-lg font-bold leading-none">B</span>
            <span className="mt-0.5 text-[6px] font-semibold uppercase tracking-[0.14em]">
              Measured
            </span>
          </div>
        </div>

        <div className="tape-rule mt-4" />

        {/* Ledger */}
        <div className="mt-4 space-y-2.5 text-[13px]">
          {[
            ['Exterior walls — 2 coats, 904 sq ft', '$2,260.00'],
            ['Prep: scrape, caulk & spot-prime', '$480.00'],
            ['Ladders & staging, rear gable', '$350.00'],
          ].map(([label, amount]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="text-text-secondary">{label}</span>
              <span className="flex-1 border-b border-dotted border-border-strong" />
              <span className="figure text-text-primary">{amount}</span>
            </div>
          ))}
        </div>

        {/* Price panel */}
        <div className="mt-5 rounded-warm-xl bg-primary p-5 text-white">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/60">
            Total inc. sales tax
          </p>
          <p className="figure mt-1 text-4xl font-medium leading-none">
            $3,344<sup className="text-lg align-super">.93</sup>
          </p>
          <div className="tape-rule-light mt-4" />
          <div className="mt-3 flex items-baseline justify-between text-[11px]">
            <span className="text-white/70">Measured range</span>
            <span className="figure text-white/90">$3,150 – $3,560</span>
          </div>
        </div>

        {/* Action mock */}
        <div className="mt-4 rounded-warm-lg border border-border bg-surface py-2.5 text-center text-[12px] font-semibold text-primary">
          Accept this estimate
        </div>
      </div>

      {/* Speed badge */}
      <p className="figure absolute -bottom-4 right-2 rotate-[-1deg] rounded-full border border-border bg-white px-3 py-1 text-[11px] text-text-secondary shadow-warm">
        generated in 58s
      </p>
    </div>
  )
}

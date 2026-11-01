import { ArrowUpRight, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { APP_PATH } from '@/appRoutes'
import LiquidChrome from '@/components/ui/LiquidChrome'
import { FOOTER_LINKS, LANDING_FEATURES } from './landingContent'
import { LandingFeatureArtwork } from './LandingFeatureArtwork'
import { VestrosMark } from './VestrosMark'

const COPYRIGHT_YEAR = '2026'

export function LandingPage() {
  return (
    <main className="landing-shell">
      <div className="landing-page-liquid" aria-hidden="true">
        <LiquidChrome
          color="#ffffff"
          speed={0.2}
          amplitude={0.3}
          detail={4}
          thickness={1}
          interactive
          className="landing-page-liquid-canvas"
        />
      </div>
      <div className="landing-frame">
        <header className="landing-header">
          <Link to={APP_PATH} className="landing-brand" aria-label="Open Vestros workspace">
            <span className="landing-brand-mark"><VestrosMark /></span>
            <span className="landing-brand-name display">Vestros</span>
          </Link>
          <span className="landing-header-note">USDC infrastructure on Arc</span>
        </header>

        <div className="landing-main-grid">
          <section className="landing-hero landing-hero-band" aria-labelledby="landing-title">
            <div className="landing-hero-content">
              <div className="landing-kicker"><span className="landing-kicker-mark" /> Financial infrastructure for teams and ecosystems</div>
              <h1 id="landing-title" className="landing-title display">USDC vesting, made simple.</h1>
              <p className="landing-description">
                Create vesting schedules, allocate USDC, and let beneficiaries claim their funds over time. Built on Arc.
              </p>
              <div className="landing-actions">
                <Link to={APP_PATH} className="landing-button landing-button-primary">
                  Launch App <ArrowUpRight size={15} strokeWidth={2} />
                </Link>
                <Link to="/help" className="landing-button landing-button-secondary">
                  Read Docs <BookOpen size={14} strokeWidth={1.8} />
                </Link>
              </div>
            </div>
          </section>
        </div>

        <section className="landing-features" aria-label="Vestros capabilities">
          {LANDING_FEATURES.map((feature, index) => (
            <article key={feature.title} className={'landing-feature-card landing-feature-card-' + (index + 1)}>
                <div className="landing-feature-visual">
                  <LandingFeatureArtwork kind={feature.art} />
                </div>
                <div className="landing-feature-content">
                  <h2 className="display">{feature.title}</h2>
                  <p>{feature.description}</p>
                </div>
            </article>
          ))}
        </section>

        <footer className="landing-footer">
          <nav className="landing-footer-links" aria-label="Landing page links">
            {FOOTER_LINKS.map(link => (
              link.external ? (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">{link.label}<ArrowUpRight size={12} /></a>
              ) : (
                <Link key={link.label} to={link.href}>{link.label}<ArrowUpRight size={12} /></Link>
              )
            ))}
          </nav>
          <span className="landing-copyright">© {COPYRIGHT_YEAR} Vestros</span>
        </footer>
      </div>
    </main>
  )
}

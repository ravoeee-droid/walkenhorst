"use client";

import { ReactNode } from "react";
import {
  StudioV3BrandKit,
  StudioV3LandingBlock,
  StudioV3LandingConfig,
  StudioV3LeadVariables,
  resolveStudioV3Text,
} from "@/lib/studio-v3";
import styles from "./landing-page-renderer.module.css";

type Props = {
  landing: StudioV3LandingConfig;
  brand: StudioV3BrandKit;
  variables: StudioV3LeadVariables;
  video: ReactNode;
  findings?: string[];
  metrics?: Array<{ label: string; value: string }>;
  qualification?: ReactNode;
  onCta?: () => void;
  preview?: boolean;
};

const token = (value: string | undefined, brand: StudioV3BrandKit) => {
  if (!value) return undefined;
  return value
    .replace("brand.background", brand.backgroundColor)
    .replace("brand.surface", brand.surfaceColor)
    .replace("brand.primary", brand.primaryColor)
    .replace("brand.secondary", brand.secondaryColor)
    .replace("brand.accent", brand.accentColor)
    .replace("brand.text", brand.textColor)
    .replace("brand.muted", brand.mutedTextColor);
};

function styleFor(block: StudioV3LandingBlock, brand: StudioV3BrandKit) {
  return {
    "--py": `${block.style.paddingY ?? 42}px`,
    "--maxw": `${block.style.maxWidth ?? 1180}px`,
    "--block-bg": token(block.style.background, brand) || brand.backgroundColor,
    "--block-text": token(block.style.textColor, brand) || brand.textColor,
    "--block-accent": token(block.style.accentColor, brand) || brand.accentColor,
    "--block-radius": `${block.style.radius ?? brand.radiusPx}px`,
  } as React.CSSProperties;
}

function imageFor(block: StudioV3LandingBlock, fallback = "") {
  if (block.settings?.imageHidden) return "";
  return String(block.settings?.imageUrl || "").trim() || fallback;
}

function imageStyle(block: StudioV3LandingBlock): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: 240,
    maxHeight: 560,
    display: "block",
    objectFit: String(block.settings?.imageFit || "cover") as "cover" | "contain",
    objectPosition: String(block.settings?.imageFocus || "center"),
    borderRadius: "var(--block-radius)",
    boxShadow: "var(--w-shadow)",
  };
}

function MediaLayout({ block, image, children }: { block: StudioV3LandingBlock; image: string; children: ReactNode }) {
  if (!image) return <>{children}</>;
  const position = String(block.settings?.imagePosition || "left");
  const media = <img src={image} alt={String(block.settings?.imageAlt || "")} style={imageStyle(block)} />;
  if (position === "top") {
    return (
      <div style={{ display: "grid", gap: 28 }}>
        {media}
        {children}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(min(290px,100%),1fr))",
        alignItems: "center",
        gap: "clamp(24px,4vw,54px)",
      }}
    >
      {position === "right" ? children : media}
      {position === "right" ? media : children}
    </div>
  );
}

export function StudioV3LandingPage({
  landing,
  brand,
  variables,
  video,
  findings = [],
  metrics = [],
  qualification,
  onCta,
  preview = false,
}: Props) {
  const blocks = [...landing.blocks].filter((block) => block.enabled).sort((a, b) => a.order - b.order);
  const cta = brand.defaultCtaLabel;
  const rootStyle = {
    "--w-bg": brand.backgroundColor,
    "--w-text": brand.textColor,
    "--w-primary": brand.primaryColor,
    "--w-accent": brand.accentColor,
    "--w-button-text": brand.buttonTextColor,
    "--w-heading": brand.fontHeading,
    "--w-body": brand.fontBody,
    "--w-radius": `${brand.radiusPx}px`,
    "--w-shadow":
      brand.shadowStyle === "strong"
        ? "0 24px 60px rgba(0,0,0,.19)"
        : brand.shadowStyle === "soft"
          ? "0 12px 34px rgba(0,0,0,.10)"
          : "none",
  } as React.CSSProperties;
  const clickCta = () => {
    if (onCta) {
      onCta();
      return;
    }
    if (brand.defaultCtaUrl && !preview) window.location.href = brand.defaultCtaUrl;
  };

  return (
    <div className={styles.page} style={rootStyle}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          {landing.showLogo && brand.logoUrl ? (
            <img src={brand.logoUrl} className={styles.logo} alt={brand.name} />
          ) : (
            <span className={styles.wordmark}>{brand.name}</span>
          )}
          <button className={styles.headerCta} onClick={clickCta}>
            {brand.defaultCtaLabel}
          </button>
        </div>
      </header>
      {blocks.map((block) => (
        <LandingBlock
          key={block.id}
          block={block}
          brand={brand}
          variables={variables}
          video={video}
          findings={findings}
          metrics={metrics}
          qualification={qualification}
          onCta={clickCta}
          preview={preview}
        />
      ))}
      {landing.stickyCta ? (
        <div className={styles.sticky}>
          <button className={styles.button} onClick={clickCta}>
            {cta}
          </button>
        </div>
      ) : null}
    </div>
  );
}

type BlockProps = {
  block: StudioV3LandingBlock;
  brand: StudioV3BrandKit;
  variables: StudioV3LeadVariables;
  video: ReactNode;
  findings: string[];
  metrics: Array<{ label: string; value: string }>;
  qualification?: ReactNode;
  onCta: () => void;
  preview: boolean;
};

function LandingBlock({ block, brand, variables, video, findings, metrics, qualification, onCta, preview }: BlockProps) {
  const headline = resolveStudioV3Text(block.headline || "", variables);
  const body = resolveStudioV3Text(block.body || "", variables);
  const eyebrow = resolveStudioV3Text(block.eyebrow || "", variables);
  const blockStyle = styleFor(block, brand);
  const heading = () => (headline ? <h2 className={styles.h2}>{headline}</h2> : null);
  const intro = () => (
    <>
      {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
      {heading()}
      {body ? <p className={styles.body}>{body}</p> : null}
    </>
  );
  const blockCta = () => {
    onCta();
    const target = resolveStudioV3Text(block.ctaUrl || "", variables).trim();
    if (target && !preview) window.location.href = target;
  };

  if (block.type === "hero") {
    const image = imageFor(block);
    const position = String(block.settings?.imagePosition || "right");
    const heroContent = (
      <div>
        {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
        <h1 className={styles.h1}>{headline}</h1>
        {body ? <p className={styles.body}>{body}</p> : null}
        <div className={styles.heroMeta}>
          <span className={styles.chip}>Persönlich für {resolveStudioV3Text("{{company}}", variables)}</span>
          <span className={styles.chip}>Energie · PV · Effizienz</span>
          <span className={styles.chip}>Unverbindliche Vorprüfung</span>
        </div>
      </div>
    );
    const heroStyle: React.CSSProperties =
      image && position === "background"
        ? {
            ...blockStyle,
            backgroundImage: `linear-gradient(90deg,rgba(0,0,0,.70),rgba(0,0,0,.28)),url(${JSON.stringify(image).slice(1, -1)})`,
            backgroundSize: "cover",
            backgroundPosition: String(block.settings?.imageFocus || "center"),
            color: "#fff",
          }
        : blockStyle;
    return (
      <section className={`${styles.block} ${styles.hero}`} style={heroStyle}>
        <div className={styles.inner}>
          {image && position !== "background" ? <MediaLayout block={block} image={image}>{heroContent}</MediaLayout> : heroContent}
        </div>
      </section>
    );
  }

  if (block.type === "video")
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          <div className={styles.videoWrap}>{video}</div>
        </div>
      </section>
    );

  if (block.type === "findings") {
    const content = (
      <div>
        {intro()}
        <div className={styles.findings}>
          {(findings.length
            ? findings
            : ["Individuelles Energiepotenzial", "PV-/Eigenverbrauch prüfen", "Nächsten wirtschaftlichen Schritt priorisieren"]
          )
            .slice(0, 6)
            .map((finding, index) => (
              <article className={styles.finding} key={`${finding}-${index}`}>
                <span>✓</span>
                <strong>{finding}</strong>
              </article>
            ))}
        </div>
      </div>
    );
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          <MediaLayout block={block} image={imageFor(block)}>{content}</MediaLayout>
        </div>
      </section>
    );
  }

  if (block.type === "metrics") {
    const content = (
      <div>
        {intro()}
        <div className={styles.metrics}>
          {(metrics.length
            ? metrics
            : [
                { label: "Opportunity", value: resolveStudioV3Text("{{opportunity}} / 100", variables) },
                { label: "PV Vorprüfung", value: resolveStudioV3Text("{{pv_kwp}} kWp", variables) },
                { label: "Dachfläche", value: resolveStudioV3Text("{{roof_area}} m²", variables) },
                { label: "Energie Score", value: resolveStudioV3Text("{{energy_score}} / 100", variables) },
              ]
          ).map((metric) => (
            <article className={styles.metric} key={metric.label}>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>
      </div>
    );
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          <MediaLayout block={block} image={imageFor(block)}>{content}</MediaLayout>
        </div>
      </section>
    );
  }

  if (block.type === "trust") {
    const image = imageFor(block, brand.portraitUrl || "");
    const content = (
      <div>
        {intro()}
        <span className={styles.trustBadge}>Walkenhorst Energie · persönlicher Ansprechpartner</span>
      </div>
    );
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          {image ? (
            <MediaLayout block={{ ...block, settings: { ...(block.settings || {}), imagePosition: block.settings?.imagePosition || "right" } }} image={image}>
              {content}
            </MediaLayout>
          ) : (
            <div className={styles.trustGrid}>
              {content}
              <article className={styles.proofCard}>
                <strong>{brand.contactName}</strong>
                <p className={styles.body}>{brand.trustBody}</p>
              </article>
            </div>
          )}
        </div>
      </section>
    );
  }

  if (block.type === "about") {
    const image = imageFor(block, brand.portraitUrl || "");
    const content = (
      <div>
        {intro()}
        <p className={styles.body}>{brand.trustBody}</p>
      </div>
    );
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          <MediaLayout block={block} image={image}>{content}</MediaLayout>
        </div>
      </section>
    );
  }

  if (block.type === "logos") {
    const custom = (block.items || []).filter((item) => String(item.url || "").trim());
    const logos = custom.length
      ? custom.map((item) => ({ url: String(item.url), label: String(item.label || "Partner") }))
      : ((brand.metadata?.partnerLogos as string[]) || []).map((url) => ({ url, label: "Partner" }));
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          {intro()}
          <div className={styles.logos}>
            {logos.map((item, index) => (
              <img src={item.url} alt={item.label} key={`${item.url}-${index}`} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (block.type === "proof")
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          {intro()}
          <div className={styles.proofGrid}>
            {(block.items || []).map((item, index) => (
              <article className={styles.proofCard} key={index} style={{ overflow: "hidden" }}>
                {item.imageUrl ? (
                  <img
                    src={String(item.imageUrl)}
                    alt={String(item.title || "Case")}
                    style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 10, marginBottom: 16 }}
                  />
                ) : null}
                <strong>{String(item.title || "Proof")}</strong>
                <p className={styles.body}>{String(item.body || "")}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    );

  if (block.type === "qualification") {
    const content = (
      <div>
        {intro()}
        <div className={styles.qualification}>{qualification}</div>
      </div>
    );
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          <MediaLayout block={block} image={imageFor(block)}>{content}</MediaLayout>
        </div>
      </section>
    );
  }

  if (block.type === "cta") {
    const content = (
      <div className={styles.ctaCard} style={{ borderRadius: "var(--block-radius)" }}>
        {intro()}
        <button className={styles.button} onClick={blockCta}>
          {resolveStudioV3Text(block.ctaLabel || brand.defaultCtaLabel, variables)}
        </button>
      </div>
    );
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          <MediaLayout block={block} image={imageFor(block)}>{content}</MediaLayout>
        </div>
      </section>
    );
  }

  if (block.type === "calendar")
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          {intro()}
          <div className={styles.calendar}>
            {typeof block.settings?.url === "string" && block.settings.url ? (
              <iframe title="Termin vereinbaren" src={String(block.settings.url)} loading="lazy" />
            ) : (
              <div style={{ padding: 30 }}>Kalender-URL im Landingpage Builder hinterlegen.</div>
            )}
          </div>
        </div>
      </section>
    );

  if (block.type === "faq")
    return (
      <section className={styles.block} style={blockStyle}>
        <div className={styles.inner}>
          {intro()}
          <div className={styles.faq}>
            {(block.items || []).map((item, index) => (
              <article className={styles.faqItem} key={index}>
                <strong>{String(item.question || "Frage")}</strong>
                <p>{String(item.answer || "")}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    );

  if (block.type === "footer")
    return (
      <footer className={styles.block} style={blockStyle}>
        <div className={`${styles.inner} ${styles.footerGrid}`}>
          <div>{landingLogo(brand)}</div>
          <div>
            <p>{brand.contactName}</p>
            <p>{brand.contactPhone}</p>
            <p>{brand.contactEmail}</p>
          </div>
          <div>
            <p>Walkenhorst Energie</p>
            <p>Persönliche Energieberatung</p>
          </div>
        </div>
      </footer>
    );

  return null;
}

function landingLogo(brand: StudioV3BrandKit) {
  return brand.logoUrl ? <img src={brand.logoUrl} className={styles.logo} alt={brand.name} /> : <strong className={styles.wordmark}>{brand.name}</strong>;
}

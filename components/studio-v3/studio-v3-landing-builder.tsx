"use client";

import { ChangeEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  StudioV3BrandKit,
  StudioV3LandingBlock,
  StudioV3LandingBlockType,
  StudioV3LandingConfig,
  StudioV3LeadVariables,
  studioV3Id,
} from "@/lib/studio-v3";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { StudioV3LandingPage } from "./landing-page-renderer";
import styles from "./studio-v3-editor.module.css";

type Props = {
  landing: StudioV3LandingConfig;
  brand: StudioV3BrandKit;
  variables: StudioV3LeadVariables;
  video: ReactNode;
  findings: string[];
  metrics: Array<{ label: string; value: string }>;
  qualification?: ReactNode;
  onChange: (next: StudioV3LandingConfig) => void;
};

type ImageAsset = {
  id: string;
  filename: string;
  label: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  publicUrl: string;
};

const MEDIA_BUCKET = "energy-media";
const blockLabels: Record<StudioV3LandingBlockType, string> = {
  hero: "Hero",
  video: "Video",
  findings: "Findings",
  metrics: "Kennzahlen",
  trust: "Trust",
  about: "Andreas",
  logos: "Logos",
  proof: "Proof / Cases",
  qualification: "Qualifizierung",
  cta: "CTA",
  calendar: "Kalender",
  faq: "FAQ",
  footer: "Footer",
};

const imageBlocks = new Set<StudioV3LandingBlockType>([
  "hero",
  "findings",
  "metrics",
  "trust",
  "about",
  "qualification",
  "cta",
]);

export function StudioV3LandingBuilder({
  landing,
  brand,
  variables,
  video,
  findings,
  metrics,
  qualification,
  onChange,
}: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [selectedId, setSelectedId] = useState(landing.blocks[0]?.id || null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const selected = landing.blocks.find((block) => block.id === selectedId) || null;
  const ordered = useMemo(() => [...landing.blocks].sort((a, b) => a.order - b.order), [landing.blocks]);

  const loadImages = useCallback(async () => {
    if (!supabase) return;
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) return;
    const result = await supabase
      .from("energy_media_assets")
      .select("id,filename,label,storage_bucket,storage_path,mime_type")
      .eq("user_id", session.user.id)
      .like("mime_type", "image/%")
      .order("created_at", { ascending: false })
      .limit(500);
    if (result.error) {
      setImageError(result.error.message);
      return;
    }
    setImageAssets(
      (result.data || []).map((asset) => ({
        ...(asset as Omit<ImageAsset, "publicUrl">),
        publicUrl: supabase.storage.from(asset.storage_bucket || MEDIA_BUCKET).getPublicUrl(asset.storage_path).data.publicUrl,
      }))
    );
  }, [supabase]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const patchBlock = (id: string, patch: Partial<StudioV3LandingBlock>) =>
    onChange({ ...landing, blocks: landing.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)) });

  const patchSettings = (id: string, patch: Record<string, unknown>) =>
    onChange({
      ...landing,
      blocks: landing.blocks.map((block) =>
        block.id === id ? { ...block, settings: { ...(block.settings || {}), ...patch } } : block
      ),
    });

  const styleBlock = (id: string, key: keyof StudioV3LandingBlock["style"], value: unknown) =>
    onChange({
      ...landing,
      blocks: landing.blocks.map((block) =>
        block.id === id ? { ...block, style: { ...block.style, [key]: value } } : block
      ),
    });

  function move(id: string, direction: -1 | 1) {
    const list = [...ordered];
    const index = list.findIndex((block) => block.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    onChange({ ...landing, blocks: list.map((block, i) => ({ ...block, order: (i + 1) * 10 })) });
  }

  function add(type: StudioV3LandingBlockType) {
    const order = Math.max(0, ...landing.blocks.map((block) => block.order)) + 10;
    const defaults: StudioV3LandingBlock = {
      id: studioV3Id(`lp-${type}`),
      type,
      enabled: true,
      order,
      headline: blockLabels[type],
      body: "",
      style: {
        background: "brand.background",
        textColor: "brand.text",
        accentColor: "brand.accent",
        paddingY: 42,
        maxWidth: 1180,
        radius: 16,
        align: "left",
      },
      items:
        type === "faq"
          ? [
              {
                question: "Wie läuft die Vorprüfung ab?",
                answer:
                  "Wir prüfen gemeinsam die relevanten Verbrauchs-, Vertrags- und Standortdaten und priorisieren danach die wirtschaftlich sinnvollen Schritte.",
              },
            ]
          : type === "proof"
            ? [{ title: "Persönliche Beratung", body: "Direkter Ansprechpartner statt anonymer Plattform.", imageUrl: "" }]
            : type === "logos"
              ? []
              : undefined,
    };
    onChange({ ...landing, blocks: [...landing.blocks, defaults] });
    setSelectedId(defaults.id);
  }

  function remove(id: string) {
    onChange({ ...landing, blocks: landing.blocks.filter((block) => block.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, blockId: string) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !supabase) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Bitte eine Bilddatei auswählen.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setImageError("Das Bild darf maximal 50 MB groß sein.");
      return;
    }
    setImageBusy(true);
    setImageError(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Session abgelaufen.");
      const id = crypto.randomUUID();
      const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const path = `${session.user.id}/${id}-${safe}`;
      const up = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: "31536000",
      });
      if (up.error) throw up.error;
      const insert = await supabase
        .from("energy_media_assets")
        .insert({
          id,
          user_id: session.user.id,
          filename: file.name,
          kind: "image",
          mime_type: file.type,
          size_bytes: file.size,
          storage_bucket: MEDIA_BUCKET,
          storage_path: path,
          label: file.name.replace(/\.[^.]+$/, ""),
          metadata: { source: "landing_builder" },
        })
        .select("id,filename,label,storage_bucket,storage_path,mime_type")
        .single();
      if (insert.error) {
        await supabase.storage.from(MEDIA_BUCKET).remove([path]);
        throw insert.error;
      }
      const publicUrl = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      const asset = { ...(insert.data as Omit<ImageAsset, "publicUrl">), publicUrl };
      setImageAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
      patchSettings(blockId, { imageUrl: publicUrl, imageAssetId: id, imageHidden: false });
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "Bild konnte nicht hochgeladen werden.");
    } finally {
      setImageBusy(false);
    }
  }

  function setBlockImage(block: StudioV3LandingBlock, assetId: string) {
    const asset = imageAssets.find((item) => item.id === assetId);
    if (!asset) return;
    patchSettings(block.id, { imageUrl: asset.publicUrl, imageAssetId: asset.id, imageHidden: false });
  }

  function setItemValue(block: StudioV3LandingBlock, index: number, patch: Record<string, unknown>) {
    const items = [...(block.items || [])];
    items[index] = { ...items[index], ...patch };
    patchBlock(block.id, { items });
  }

  const selectedImage = selected ? String(selected.settings?.imageUrl || "") : "";
  const selectedImageHidden = Boolean(selected?.settings?.imageHidden);
  const defaultPortrait = selected && ["trust", "about"].includes(selected.type) ? brand.portraitUrl : "";
  const previewImage = selectedImageHidden ? "" : selectedImage || defaultPortrait || "";

  return (
    <div className={styles.landingShell}>
      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <strong>Landingpage Blocks</strong>
          <small>{ordered.filter((b) => b.enabled).length} aktiv</small>
        </div>
        <div className={styles.scroll}>
          <section className={styles.section}>
            <div className={styles.grid2}>
              <label style={{ fontSize: 8 }}>
                <input
                  type="checkbox"
                  checked={landing.showLogo}
                  onChange={(e) => onChange({ ...landing, showLogo: e.target.checked })}
                />{" "}
                Logo
              </label>
              <label style={{ fontSize: 8 }}>
                <input
                  type="checkbox"
                  checked={landing.stickyCta}
                  onChange={(e) => onChange({ ...landing, stickyCta: e.target.checked })}
                />{" "}
                Sticky CTA
              </label>
            </div>
          </section>
          <section className={styles.section}>
            {ordered.map((block, index) => (
              <div
                className={`${styles.blockRow} ${selectedId === block.id ? styles.blockRowActive : ""}`}
                key={block.id}
                onClick={() => setSelectedId(block.id)}
              >
                <button
                  className={styles.mini}
                  onClick={(event) => {
                    event.stopPropagation();
                    patchBlock(block.id, { enabled: !block.enabled });
                  }}
                >
                  {block.enabled ? "●" : "○"}
                </button>
                <div>
                  <strong>{blockLabels[block.type]}</strong>
                  <small>{block.headline || block.eyebrow || "Block"}</small>
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  <button
                    className={styles.mini}
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      move(block.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    className={styles.mini}
                    disabled={index === ordered.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      move(block.id, 1);
                    }}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className={styles.section}>
            <div className={styles.sectionTitle}>
              <strong>Block hinzufügen</strong>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {Object.entries(blockLabels).map(([type, label]) => (
                <button className={styles.mini} key={type} onClick={() => add(type as StudioV3LandingBlockType)}>
                  + {label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>

      <main className={styles.landingPreview}>
        <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 10 }}>
          <button
            className={`${styles.btn} ${device === "desktop" ? styles.primary : ""}`}
            onClick={() => setDevice("desktop")}
          >
            Desktop
          </button>
          <button
            className={`${styles.btn} ${device === "mobile" ? styles.primary : ""}`}
            onClick={() => setDevice("mobile")}
          >
            Mobile
          </button>
        </div>
        <div className={styles.landingViewport} style={{ width: device === "mobile" ? 390 : "100%", maxWidth: "100%" }}>
          <StudioV3LandingPage
            landing={landing}
            brand={brand}
            variables={variables}
            video={video}
            findings={findings}
            metrics={metrics}
            qualification={qualification}
            preview
          />
        </div>
      </main>

      <aside className={styles.panel}>
        <div className={styles.panelHead}>
          <strong>Block Eigenschaften</strong>
          <small>{selected ? blockLabels[selected.type] : "–"}</small>
        </div>
        {selected ? (
          <div className={styles.scroll}>
            <section className={styles.section}>
              <div className={styles.field}>
                <label>Eyebrow</label>
                <input value={selected.eyebrow || ""} onChange={(e) => patchBlock(selected.id, { eyebrow: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label>Headline</label>
                <textarea value={selected.headline || ""} onChange={(e) => patchBlock(selected.id, { headline: e.target.value })} />
              </div>
              <div className={styles.field}>
                <label>Text</label>
                <textarea value={selected.body || ""} onChange={(e) => patchBlock(selected.id, { body: e.target.value })} />
              </div>
              {selected.type === "cta" ? (
                <>
                  <div className={styles.field}>
                    <label>CTA Text</label>
                    <input value={selected.ctaLabel || ""} onChange={(e) => patchBlock(selected.id, { ctaLabel: e.target.value })} />
                  </div>
                  <div className={styles.field}>
                    <label>CTA URL</label>
                    <input value={selected.ctaUrl || ""} onChange={(e) => patchBlock(selected.id, { ctaUrl: e.target.value })} />
                  </div>
                </>
              ) : null}
              {selected.type === "calendar" ? (
                <div className={styles.field}>
                  <label>Kalender URL</label>
                  <input
                    value={String(selected.settings?.url || "")}
                    onChange={(e) => patchSettings(selected.id, { url: e.target.value })}
                  />
                </div>
              ) : null}
            </section>

            {imageBlocks.has(selected.type) ? (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>
                  <strong>Bild</strong>
                  <small>Block-Medium</small>
                </div>
                {previewImage ? (
                  <div
                    style={{
                      overflow: "hidden",
                      borderRadius: 10,
                      border: "1px solid #e4e8e5",
                      background: "#f5f5f5",
                      marginBottom: 8,
                    }}
                  >
                    <img src={previewImage} alt="" style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }} />
                  </div>
                ) : (
                  <div className={styles.empty} style={{ marginBottom: 8 }}>
                    Kein Bild aktiv.
                  </div>
                )}
                <div className={styles.field}>
                  <label>Aus Medienbibliothek</label>
                  <select
                    value={String(selected.settings?.imageAssetId || "")}
                    onChange={(e) => setBlockImage(selected, e.target.value)}
                  >
                    <option value="">Bild auswählen …</option>
                    {imageAssets.map((asset) => (
                      <option value={asset.id} key={asset.id}>
                        {asset.label || asset.filename}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Oder Bild-URL</label>
                  <input
                    value={selectedImage}
                    placeholder="https://…"
                    onChange={(e) => patchSettings(selected.id, { imageUrl: e.target.value, imageAssetId: "", imageHidden: false })}
                  />
                </div>
                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label>Position</label>
                    <select
                      value={String(selected.settings?.imagePosition || (selected.type === "hero" ? "right" : "left"))}
                      onChange={(e) => patchSettings(selected.id, { imagePosition: e.target.value })}
                    >
                      <option value="left">Links</option>
                      <option value="right">Rechts</option>
                      <option value="top">Oben</option>
                      {selected.type === "hero" ? <option value="background">Hintergrund</option> : null}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <label>Fit</label>
                    <select
                      value={String(selected.settings?.imageFit || "cover")}
                      onChange={(e) => patchSettings(selected.id, { imageFit: e.target.value })}
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </select>
                  </div>
                </div>
                <div className={styles.field}>
                  <label>Bildfokus</label>
                  <select
                    value={String(selected.settings?.imageFocus || "center")}
                    onChange={(e) => patchSettings(selected.id, { imageFocus: e.target.value })}
                  >
                    <option value="center">Mitte</option>
                    <option value="top">Oben</option>
                    <option value="bottom">Unten</option>
                    <option value="left">Links</option>
                    <option value="right">Rechts</option>
                  </select>
                </div>
                <div className={styles.grid2}>
                  <label className={styles.btn} style={{ cursor: imageBusy ? "wait" : "pointer", textAlign: "center" }}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      style={{ display: "none" }}
                      disabled={imageBusy}
                      onChange={(event) => void uploadImage(event, selected.id)}
                    />
                    {imageBusy ? "Lädt …" : "Bild hochladen"}
                  </label>
                  <button
                    className={styles.btn}
                    onClick={() => patchSettings(selected.id, { imageUrl: "", imageAssetId: "", imageHidden: true })}
                  >
                    Bild entfernen
                  </button>
                </div>
                {["trust", "about"].includes(selected.type) ? (
                  <button
                    className={styles.btn}
                    style={{ width: "100%", marginTop: 6 }}
                    onClick={() => patchSettings(selected.id, { imageUrl: "", imageAssetId: "", imageHidden: false })}
                  >
                    Andreas-Standardbild verwenden
                  </button>
                ) : null}
                {imageError ? <small style={{ display: "block", color: "#a53030", marginTop: 7 }}>{imageError}</small> : null}
              </section>
            ) : null}

            <section className={styles.section}>
              <div className={styles.sectionTitle}>
                <strong>Design</strong>
              </div>
              <div className={styles.field}>
                <label>Background</label>
                <input
                  value={selected.style.background || "brand.background"}
                  onChange={(e) => styleBlock(selected.id, "background", e.target.value)}
                />
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Text</label>
                  <input
                    value={selected.style.textColor || "brand.text"}
                    onChange={(e) => styleBlock(selected.id, "textColor", e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Akzent</label>
                  <input
                    value={selected.style.accentColor || "brand.accent"}
                    onChange={(e) => styleBlock(selected.id, "accentColor", e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Padding Y</label>
                  <input
                    type="number"
                    min="0"
                    max="160"
                    value={selected.style.paddingY ?? 42}
                    onChange={(e) => styleBlock(selected.id, "paddingY", Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label>Max width</label>
                  <input
                    type="number"
                    min="320"
                    max="1600"
                    value={selected.style.maxWidth ?? 1180}
                    onChange={(e) => styleBlock(selected.id, "maxWidth", Number(e.target.value))}
                  />
                </div>
              </div>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label>Radius</label>
                  <input
                    type="number"
                    min="0"
                    max="60"
                    value={selected.style.radius ?? 16}
                    onChange={(e) => styleBlock(selected.id, "radius", Number(e.target.value))}
                  />
                </div>
                <div className={styles.field}>
                  <label>Alignment</label>
                  <select
                    value={selected.style.align || "left"}
                    onChange={(e) => styleBlock(selected.id, "align", e.target.value)}
                  >
                    <option value="left">Links</option>
                    <option value="center">Zentriert</option>
                  </select>
                </div>
              </div>
            </section>

            {selected.type === "logos" ? (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>
                  <strong>Logos / Bilder</strong>
                  <button
                    className={styles.mini}
                    onClick={() => patchBlock(selected.id, { items: [...(selected.items || []), { url: "", label: "Partner" }] })}
                  >
                    +
                  </button>
                </div>
                {(selected.items || []).map((item, index) => (
                  <div key={index} style={{ border: "1px solid #e4e8e5", borderRadius: 7, padding: 7, marginBottom: 6 }}>
                    <div className={styles.field}>
                      <label>Medienbibliothek</label>
                      <select
                        value=""
                        onChange={(e) => {
                          const asset = imageAssets.find((asset) => asset.id === e.target.value);
                          if (asset) setItemValue(selected, index, { url: asset.publicUrl, assetId: asset.id });
                        }}
                      >
                        <option value="">Bild auswählen …</option>
                        {imageAssets.map((asset) => (
                          <option value={asset.id} key={asset.id}>
                            {asset.label || asset.filename}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <label>Logo-URL</label>
                      <input value={String(item.url || "")} onChange={(e) => setItemValue(selected, index, { url: e.target.value })} />
                    </div>
                    <div className={styles.grid2}>
                      <input
                        value={String(item.label || "")}
                        placeholder="Alt / Name"
                        onChange={(e) => setItemValue(selected, index, { label: e.target.value })}
                      />
                      <button
                        className={`${styles.btn} ${styles.danger}`}
                        onClick={() => patchBlock(selected.id, { items: (selected.items || []).filter((_, i) => i !== index) })}
                      >
                        Entfernen
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            ) : null}

            {["faq", "proof"].includes(selected.type) ? (
              <section className={styles.section}>
                <div className={styles.sectionTitle}>
                  <strong>Inhalte</strong>
                  <button
                    className={styles.mini}
                    onClick={() =>
                      patchBlock(selected.id, {
                        items: [
                          ...(selected.items || []),
                          selected.type === "faq"
                            ? { question: "Neue Frage", answer: "Antwort" }
                            : { title: "Neuer Proof", body: "Beschreibung", imageUrl: "" },
                        ],
                      })
                    }
                  >
                    +
                  </button>
                </div>
                {(selected.items || []).map((item, index) => (
                  <div key={index} style={{ border: "1px solid #e4e8e5", borderRadius: 7, padding: 7, marginBottom: 6 }}>
                    {selected.type === "proof" ? (
                      <>
                        {item.imageUrl ? (
                          <img
                            src={String(item.imageUrl)}
                            alt=""
                            style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 6, marginBottom: 6 }}
                          />
                        ) : null}
                        <div className={styles.field}>
                          <label>Case-Bild</label>
                          <select
                            value=""
                            onChange={(e) => {
                              const asset = imageAssets.find((asset) => asset.id === e.target.value);
                              if (asset) setItemValue(selected, index, { imageUrl: asset.publicUrl, imageAssetId: asset.id });
                            }}
                          >
                            <option value="">Bild auswählen …</option>
                            {imageAssets.map((asset) => (
                              <option value={asset.id} key={asset.id}>
                                {asset.label || asset.filename}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className={styles.field}>
                          <label>Oder Bild-URL</label>
                          <input
                            value={String(item.imageUrl || "")}
                            onChange={(e) => setItemValue(selected, index, { imageUrl: e.target.value, imageAssetId: "" })}
                          />
                        </div>
                      </>
                    ) : null}
                    <div className={styles.field}>
                      <label>{selected.type === "faq" ? "Frage" : "Titel"}</label>
                      <input
                        value={String(item[selected.type === "faq" ? "question" : "title"] || "")}
                        onChange={(e) =>
                          setItemValue(selected, index, {
                            [selected.type === "faq" ? "question" : "title"]: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className={styles.field}>
                      <label>{selected.type === "faq" ? "Antwort" : "Text"}</label>
                      <textarea
                        value={String(item[selected.type === "faq" ? "answer" : "body"] || "")}
                        onChange={(e) =>
                          setItemValue(selected, index, {
                            [selected.type === "faq" ? "answer" : "body"]: e.target.value,
                          })
                        }
                      />
                    </div>
                    <button
                      className={`${styles.btn} ${styles.danger}`}
                      style={{ width: "100%" }}
                      onClick={() => patchBlock(selected.id, { items: (selected.items || []).filter((_, i) => i !== index) })}
                    >
                      Eintrag entfernen
                    </button>
                  </div>
                ))}
              </section>
            ) : null}

            <section className={styles.section}>
              <button className={`${styles.btn} ${styles.danger}`} onClick={() => remove(selected.id)}>
                Block löschen
              </button>
            </section>
          </div>
        ) : (
          <div className={styles.empty}>Block auswählen, um Inhalte, Bilder und Design zu bearbeiten.</div>
        )}
      </aside>
    </div>
  );
}

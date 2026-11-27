import { useId } from "react";
import { CHARACTER_RECIPES, recipeById, type CharacterRecipe } from "@/lib/character-presets";

function parseHex(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const c = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x * (1 - t) + y * t)));
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Warm Editorial Studio illustrated SVG portrait matching each agent's floor character.
 * Renders crisply at any size (16px chips through 96px profile previews) in both Light & Dark mode.
 */
export default function CharacterFace({
  face,
  size = 40,
  shape = "rounded",
  className,
}: {
  face?: string | null;
  size?: number;
  shape?: "rounded" | "circle";
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ch: CharacterRecipe = recipeById(face) ?? CHARACTER_RECIPES[0];

  const skinHi = mixHex(ch.skin, "#fff7ea", 0.24);
  const skinSh = mixHex(ch.skin, "#964a30", 0.24);
  const skinDeep = mixHex(ch.skin, "#703222", 0.42);
  const hairHi = mixHex(ch.hair, "#fff4e0", 0.26);
  const hairSh = mixHex(ch.hair, "#1e1218", 0.34);
  const hairDeep = mixHex(ch.hair, "#140c12", 0.54);
  const shirtHi = mixHex(ch.shirt, "#fff7ea", 0.22);
  const shirtSh = mixHex(ch.shirt, "#1e1520", 0.28);
  const shirt2Sh = mixHex(ch.shirt2, "#241a24", 0.22);
  const capBase = ch.capColor || ch.shirt;
  const capHi = mixHex(capBase, "#fff7ea", 0.24);
  const capSh = mixHex(capBase, "#1c131d", 0.30);
  const scarfBase = ch.scarf || ch.shirt2;
  const scarfHi = mixHex(scarfBase, "#fff7ea", 0.24);
  const scarfSh = mixHex(scarfBase, "#1e141c", 0.30);
  const ink = "#271b22";
  const lip = "#b3544e";

  const hideEars = ["hijab", "longwavy", "bob", "curlyband"].includes(ch.hairStyle);
  const radius = shape === "circle" ? "50%" : Math.max(6, Math.round(size * 0.26));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={`${ch.label} avatar`}
      className={className ? `char-face ${className}` : "char-face"}
      style={{
        display: "block",
        flexShrink: 0,
        borderRadius: radius,
        overflow: "hidden",
      }}
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="6" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={ch.bg1} />
          <stop offset="100%" stopColor={ch.bg2} />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="26%" cy="18%" r="64%">
          <stop offset="0%" stopColor="#fffdf8" stopOpacity="0.62" />
          <stop offset="100%" stopColor="#fffdf8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-skin`} x1="20" y1="14" x2="46" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={skinHi} />
          <stop offset="52%" stopColor={ch.skin} />
          <stop offset="100%" stopColor={skinSh} />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x1="16" y1="6" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={hairHi} />
          <stop offset="42%" stopColor={ch.hair} />
          <stop offset="100%" stopColor={hairSh} />
        </linearGradient>
        <linearGradient id={`${uid}-shirt`} x1="16" y1="44" x2="48" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={shirtHi} />
          <stop offset="55%" stopColor={ch.shirt} />
          <stop offset="100%" stopColor={shirtSh} />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <rect width="64" height="64" rx={shape === "circle" ? 32 : 16} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}-clip)`}>
        {/* Warm Editorial Studio backdrop */}
        <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
        <rect width="64" height="64" fill={`url(#${uid}-glow)`} />
        <circle cx="54" cy="56" r="24" fill="#ffffff" fillOpacity="0.18" />

        {/* ---------- Back Hair Layer ---------- */}
        {ch.hairStyle === "longwavy" && (
          <g>
            <path d="M13 28C11 16 19 8 32 8C45 8 53 16 51 28L53 56C47 59 17 59 11 56Z" fill={hairSh} />
            <path d="M15 26C14 16 21 10 32 10C43 10 50 16 49 26L50 53C45 56 19 56 14 53Z" fill={`url(#${uid}-hair)`} />
          </g>
        )}
        {ch.hairStyle === "bob" && (
          <g>
            <path d="M13 28C12 15 20 8 32 8C44 8 52 15 51 28C52 38 49 45 43 46H21C15 45 12 38 13 28Z" fill={`url(#${uid}-hair)`} />
            <path d="M15 42C20 46 44 46 49 42C48 45 44 47 32 47C20 47 16 45 15 42Z" fill={hairSh} />
          </g>
        )}
        {ch.hairStyle === "curlyband" && (
          <g fill={`url(#${uid}-hair)`}>
            <circle cx="15" cy="30" r="8" />
            <circle cx="49" cy="30" r="8" />
            <circle cx="14" cy="39" r="7.5" fill={hairSh} />
            <circle cx="50" cy="39" r="7.5" fill={hairSh} />
            <circle cx="19" cy="44" r="6" fill={hairSh} />
            <circle cx="45" cy="44" r="6" fill={hairSh} />
            <ellipse cx="32" cy="24" rx="19" ry="16" />
          </g>
        )}
        {ch.hairStyle === "afro" && (
          <g fill={`url(#${uid}-hair)`}>
            <circle cx="32" cy="22" r="18" />
            <circle cx="15.5" cy="22.5" r="9.2" />
            <circle cx="48.5" cy="22.5" r="9.2" />
            <circle cx="18.5" cy="13.5" r="8" />
            <circle cx="32" cy="11.5" r="8.2" />
            <circle cx="45.5" cy="13.5" r="8" />
            <circle cx="14.5" cy="31" r="6.8" fill={hairSh} />
            <circle cx="49.5" cy="31" r="6.8" fill={hairSh} />
            <path d="M21 12.5C25 9.8 31 9.8 35 11.5" stroke={hairHi} strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
          </g>
        )}
        {ch.hairStyle === "twinpuffs" && (
          <g>
            <circle cx="13" cy="17" r="9.5" fill={`url(#${uid}-hair)`} />
            <circle cx="51" cy="17" r="9.5" fill={`url(#${uid}-hair)`} />
            <path d="M9.5 13.5C11 11.5 14 11 16 12" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
            <path d="M47.5 13.5C49 11.5 52 11 54 12" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.6" />
          </g>
        )}
        {ch.hairStyle === "highbun" && (
          <g>
            <ellipse cx="32" cy="10" rx="9" ry="7.2" fill={`url(#${uid}-hair)`} />
            <path d="M27.5 7.6C29.8 6 33.5 6 35.8 7.6" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.65" />
          </g>
        )}
        {ch.hairStyle === "ponytail" && (
          <g>
            <path d="M44 16C52 17 56 26 54 39C53 45 50 51 45 53C42 46 44 37 44 29C44 24 42 20 44 16Z" fill={`url(#${uid}-hair)`} />
            <path d="M47 21C51 26 51.5 34 49.5 43" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            <rect x="41.5" y="16" width="6" height="4.2" rx="2" transform="rotate(24 44.5 18)" fill={shirtHi} stroke={shirtSh} strokeWidth="0.7" />
          </g>
        )}
        {ch.hairStyle === "braids" && (
          <g>
            <ellipse cx="32" cy="24" rx="18" ry="14" fill={`url(#${uid}-hair)`} />
            {[17, 47].map((bx) => (
              <g key={bx}>
                <ellipse cx={bx} cy="39" rx="4.2" ry="4.4" fill={`url(#${uid}-hair)`} />
                <ellipse cx={bx} cy="45.5" rx="3.9" ry="4.1" fill={hairSh} />
                <ellipse cx={bx} cy="51.5" rx="3.5" ry="3.7" fill={`url(#${uid}-hair)`} />
                <path d={`M${bx - 3} 41.5L${bx + 3} 43.5M${bx + 3} 41.5L${bx - 3} 43.5M${bx - 2.6} 47.8L${bx + 2.6} 49.6`} stroke={hairDeep} strokeWidth="1" opacity="0.55" />
                <rect x={bx - 3} y="54" width="6" height="2.6" rx="1.2" fill={ch.shirt} />
                <path d={`M${bx - 2.2} 56.5C${bx - 2.6} 59.5 ${bx + 2.6} 59.5 ${bx + 2.2} 56.5Z`} fill={hairSh} />
              </g>
            ))}
          </g>
        )}
        {ch.hairStyle === "hijab" && (
          <g>
            <path d="M12 31C12 15 20 8 32 8C44 8 52 15 52 31L53 56C47 59 17 59 11 56Z" fill={`url(#${uid}-hair)`} />
            <path d="M14 48C22 54 42 54 50 48L51 56H13Z" fill={hairSh} />
          </g>
        )}

        {/* ---------- Shoulders, Neck & Tailored Outfit ---------- */}
        <g>
          {/* Base bust */}
          <path
            d="M8 65C9 53 16 47 25 46H39C48 47 55 53 56 65Z"
            fill={ch.outfit === "vest" ? ch.shirt2 : `url(#${uid}-shirt)`}
          />
          {ch.outfit === "vest" && (
            <path d="M17 65C18 54 21 47 26 46H38C43 47 46 54 47 65Z" fill={`url(#${uid}-shirt)`} />
          )}

          {/* Neck + subtle chin shadow */}
          <rect x="27" y="40" width="10" height="10" rx="4.5" fill={ch.skin} />
          <path d="M27 42C29.5 45 34.5 45 37 42V46.5C34.5 47.8 29.5 47.8 27 46.5Z" fill={skinSh} opacity="0.72" />

          {/* Outfit details */}
          {ch.outfit === "collar" && (
            <g>
              <path d="M24 46L32 52L27 54L22 48Z" fill={ch.shirt2} />
              <path d="M40 46L32 52L37 54L42 48Z" fill={ch.shirt2} />
              <circle cx="32" cy="56.5" r="1.4" fill={ch.shirt2} />
              <circle cx="32" cy="61" r="1.4" fill={ch.shirt2} />
            </g>
          )}
          {ch.outfit === "tie" && (
            <g>
              <path d="M24 46L32 52L27 53.5L22.5 47.5Z" fill={shirtHi} />
              <path d="M40 46L32 52L37 53.5L41.5 47.5Z" fill={shirtHi} />
              <path d="M30 51H34L33.5 54L34.5 64H29.5L30.5 54Z" fill={ch.shirt2} />
            </g>
          )}
          {ch.outfit === "cardigan" && (
            <g>
              <path d="M25 46H39L37.5 65H26.5Z" fill={ch.shirt2} />
              <path d="M24 46.5L26 65" stroke={shirtSh} strokeWidth="1.6" />
              <path d="M40 46.5L38 65" stroke={shirtSh} strokeWidth="1.6" />
              {/* Studio lanyard */}
              <path d="M27.5 46.5L32 56.5L36.5 46.5" stroke="#3c5f9e" strokeWidth="1.6" fill="none" />
              <rect x="29.5" y="56" width="5" height="6" rx="1.2" fill="#fbf8f0" stroke="#3c5f9e" strokeWidth="0.9" />
            </g>
          )}
          {ch.outfit === "crew" && (
            <path d="M24.5 46.5C27 50.5 37 50.5 39.5 46.5" stroke={ch.shirt2} strokeWidth="2.6" strokeLinecap="round" fill="none" />
          )}
          {ch.outfit === "turtleneck" && (
            <g>
              <rect x="25.5" y="42.5" width="13" height="7" rx="3" fill={shirtHi} stroke={shirtSh} strokeWidth="0.8" />
              <line x1="29" y1="43.5" x2="29" y2="48.5" stroke={shirtSh} strokeWidth="0.8" opacity="0.55" />
              <line x1="35" y1="43.5" x2="35" y2="48.5" stroke={shirtSh} strokeWidth="0.8" opacity="0.55" />
            </g>
          )}
          {ch.outfit === "hoodie" && (
            <g>
              <path d="M21 47.5C25 52.5 39 52.5 43 47.5" stroke={shirtSh} strokeWidth="2.8" strokeLinecap="round" fill="none" />
              <line x1="28" y1="50" x2="27.5" y2="59" stroke={ch.shirt2} strokeWidth="1.6" strokeLinecap="round" />
              <line x1="36" y1="50" x2="36.5" y2="59" stroke={ch.shirt2} strokeWidth="1.6" strokeLinecap="round" />
            </g>
          )}
          {(ch.outfit === "blazer" || ch.outfit === "jacket") && (
            <g>
              <path d="M25.5 46H38.5L37 65H27Z" fill={ch.shirt2} />
              <path d="M24 46L27 65L21.5 55L23 52L20.5 50Z" fill={shirtSh} opacity="0.7" />
              <path d="M40 46L37 65L42.5 55L41 52L43.5 50Z" fill={shirtSh} opacity="0.7" />
            </g>
          )}
          {ch.outfit === "striped" && (
            <g stroke={ch.shirt2} strokeWidth="2.4">
              <line x1="12" y1="53" x2="52" y2="53" />
              <line x1="10" y1="59" x2="54" y2="59" />
            </g>
          )}
          {ch.outfit === "vest" && (
            <g>
              <path d="M25 46L32 54L39 46Z" fill={ch.shirt2} />
              <path d="M25 46L32 54L39 46" stroke={shirtSh} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
              <path d="M26 46L32 50L38 46" stroke={shirt2Sh} strokeWidth="1" fill="none" />
            </g>
          )}

          {/* Cozy knit scarf */}
          {ch.scarf && (
            <g>
              <path d="M21 44.5C25 49 39 49 43 44.5C44.5 48.5 41 53.5 32 53.5C23 53.5 19.5 48.5 21 44.5Z" fill={scarfBase} stroke={scarfSh} strokeWidth="0.9" />
              <path d="M24 48.5C28 50.8 36 50.8 40 48.5" stroke={scarfHi} strokeWidth="1.5" strokeLinecap="round" opacity="0.65" />
              <rect x="33.5" y="49.5" width="7.2" height="12.5" rx="2.6" fill={scarfBase} stroke={scarfSh} strokeWidth="0.85" />
              <line x1="35" y1="58.5" x2="39.2" y2="58.5" stroke={scarfHi} strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
            </g>
          )}

          {/* Neck headphones (Bima, Zaki) */}
          {ch.headphones && (
            <g>
              <path d="M23.5 45.5C25 53 39 53 40.5 45.5" stroke={mixHex(ch.headphones, "#242830", 0.35)} strokeWidth="2.4" fill="none" />
              <rect x="20.5" y="45" width="4.8" height="8" rx="2.4" fill={ch.headphones} stroke="#363c48" strokeWidth="0.9" />
              <rect x="38.7" y="45" width="4.8" height="8" rx="2.4" fill={ch.headphones} stroke="#363c48" strokeWidth="0.9" />
            </g>
          )}

          {/* Hijab chest drape */}
          {ch.hairStyle === "hijab" && (
            <g>
              <path d="M16 44C21 54 43 54 48 44C47 51 40 56 32 56C24 56 17 51 16 44Z" fill={`url(#${uid}-hair)`} />
              <path d="M21 48C26 52 38 52 43 48" stroke={hairHi} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
            </g>
          )}
        </g>

        {/* ---------- Ears & Earrings ---------- */}
        {!hideEars && (
          <g>
            <ellipse cx="17.5" cy="31.5" rx="3.4" ry="4.4" fill={ch.skin} />
            <path d="M16.8 30C16 31 16.2 32.8 17.5 33.2" stroke={skinSh} strokeWidth="1.2" strokeLinecap="round" />
            <ellipse cx="46.5" cy="31.5" rx="3.4" ry="4.4" fill={skinSh} />
            <path d="M47.2 30C48 31 47.8 32.8 46.5 33.2" stroke={skinDeep} strokeWidth="1.2" strokeLinecap="round" />
          </g>
        )}
        {ch.earrings === "gold" && (
          <g>
            <circle cx="17.5" cy="36.2" r="2.1" fill="#f7c84d" stroke="#b57d18" strokeWidth="0.7" />
            <circle cx="46.5" cy="36.2" r="2.1" fill="#f7c84d" stroke="#b57d18" strokeWidth="0.7" />
          </g>
        )}
        {ch.earrings === "silver" && (
          <g>
            <circle cx="17.5" cy="36.2" r="2.1" fill="#e5ebf5" stroke="#7d899c" strokeWidth="0.75" />
            <circle cx="46.5" cy="36.2" r="2.1" fill="#e5ebf5" stroke="#7d899c" strokeWidth="0.75" />
          </g>
        )}

        {/* ---------- Sculpted Editorial Head ---------- */}
        <path
          d="M17.8 27.5C17.8 18.2 23.6 13.5 32 13.5C40.4 13.5 46.2 18.2 46.2 27.5C46.2 36.8 40.2 44.5 32 44.5C23.8 44.5 17.8 36.8 17.8 27.5Z"
          fill={`url(#${uid}-skin)`}
        />
        {/* Soft forehead shadow under bangs */}
        {ch.hairStyle !== "bald" && (
          <path d="M19 22.5C24 20.5 40 20.5 45 22.5V25C39 23.2 25 23.2 19 25Z" fill={skinSh} opacity="0.28" />
        )}

        {/* Cheek Blush */}
        {ch.blush && (
          <g fill="#e87975" opacity="0.28">
            <ellipse cx="22.8" cy="34.2" rx="3.3" ry="1.9" />
            <ellipse cx="41.2" cy="34.2" rx="3.3" ry="1.9" />
          </g>
        )}

        {/* Freckles */}
        {ch.freckles && (
          <g fill={skinDeep} opacity="0.65">
            <circle cx="21.5" cy="33.5" r="0.75" />
            <circle cx="23.8" cy="34.8" r="0.75" />
            <circle cx="25.2" cy="33.2" r="0.65" />
            <circle cx="42.5" cy="33.5" r="0.75" />
            <circle cx="40.2" cy="34.8" r="0.75" />
            <circle cx="38.8" cy="33.2" r="0.65" />
          </g>
        )}

        {/* ---------- Expressive Eyes ---------- */}
        {ch.eyes === "happy" ? (
          <g stroke={ink} strokeWidth="2.1" strokeLinecap="round" fill="none">
            <path d="M22.2 30.2C23.8 27.6 26.8 27.6 28.4 30.2" />
            <path d="M35.6 30.2C37.2 27.6 40.2 27.6 41.8 30.2" />
          </g>
        ) : (
          <g>
            {/* Left & Right sclera + iris + specular catchlight */}
            <ellipse cx="25.4" cy="29.8" rx="3.0" ry={ch.eyes === "calm" ? 2.1 : ch.eyes === "wide" || ch.eyes === "sparkle" ? 3.2 : 2.8} fill="#fdfbf7" />
            <ellipse cx="38.6" cy="29.8" rx="3.0" ry={ch.eyes === "calm" ? 2.1 : ch.eyes === "wide" || ch.eyes === "sparkle" ? 3.2 : 2.8} fill="#fdfbf7" />
            <circle cx="25.8" cy="29.9" r={ch.eyes === "focused" ? 1.85 : 2.2} fill={ch.eyeColor} />
            <circle cx="38.2" cy="29.9" r={ch.eyes === "focused" ? 1.85 : 2.2} fill={ch.eyeColor} />
            <circle cx="25.8" cy="29.9" r="1.15" fill={ink} />
            <circle cx="38.2" cy="29.9" r="1.15" fill={ink} />
            <circle cx="24.9" cy="28.9" r="0.85" fill="#ffffff" />
            <circle cx="37.3" cy="28.9" r="0.85" fill="#ffffff" />
            {ch.eyes === "sparkle" && (
              <>
                <circle cx="26.8" cy="31" r="0.45" fill="#ffffff" />
                <circle cx="39.2" cy="31" r="0.45" fill="#ffffff" />
              </>
            )}
            {/* Upper lash line */}
            <path
              d={ch.eyes === "lashed" || ch.eyes === "sparkle" ? "M21.6 28.4C23.4 26.5 27.2 26.7 28.6 28.4" : "M22.3 28.4C24 27 27 27 28.5 28.4"}
              stroke={ink}
              strokeWidth={ch.eyes === "lashed" ? 1.55 : 1.25}
              strokeLinecap="round"
            />
            <path
              d={ch.eyes === "lashed" || ch.eyes === "sparkle" ? "M35.4 28.4C36.8 26.7 40.6 26.5 42.4 28.4" : "M35.5 28.4C37 27 40 27 41.7 28.4"}
              stroke={ink}
              strokeWidth={ch.eyes === "lashed" ? 1.55 : 1.25}
              strokeLinecap="round"
            />
            {ch.eyes === "calm" && (
              <>
                <path d="M22.2 28.3H28.6" stroke={skinSh} strokeWidth="1.4" strokeLinecap="round" />
                <path d="M35.4 28.3H41.8" stroke={skinSh} strokeWidth="1.4" strokeLinecap="round" />
              </>
            )}
          </g>
        )}

        {/* ---------- Eyebrows ---------- */}
        <g stroke={hairDeep} strokeLinecap="round" fill="none" strokeWidth={ch.brow === "thick" ? 2.3 : 1.55}>
          {ch.brow === "arched" ? (
            <>
              <path d="M22 25.2C23.8 23.6 26.6 23.6 28.2 24.8" />
              <path d="M35.8 24.8C37.4 23.6 40.2 23.6 42 25.2" />
            </>
          ) : ch.brow === "confident" ? (
            <>
              <path d="M22.2 24.4L28.4 25.4" />
              <path d="M35.6 25.4L41.8 24.4" />
            </>
          ) : (
            <>
              <path d="M22.2 24.8C24.2 24.1 26.6 24.2 28.3 24.8" />
              <path d="M35.7 24.8C37.4 24.2 39.8 24.1 41.8 24.8" />
            </>
          )}
        </g>

        {/* Delicate Nose */}
        <path d="M31.6 31.2C31.2 32.8 31.6 33.8 32.9 33.8" stroke={skinSh} strokeWidth="1.35" strokeLinecap="round" fill="none" />

        {/* ---------- Facial Hair ---------- */}
        {ch.facial === "fullbeard" && (
          <g>
            <path d="M18.4 33.5C19.5 42.8 24.8 47 32 47C39.2 47 44.5 42.8 45.6 33.5C43 35.8 39 36.2 36 35.4C33.5 34.8 30.5 34.8 28 35.4C25 36.2 21 35.8 18.4 33.5Z" fill={`url(#${uid}-hair)`} />
            <path d="M27.2 38.2C29.4 40 34.6 40 36.8 38.2C35.2 40.8 28.8 40.8 27.2 38.2Z" fill="#fbf8f0" />
          </g>
        )}
        {ch.facial === "mustache" && (
          <path d="M25.5 36.8C27.5 34.7 30.5 34.8 32 36C33.5 34.8 36.5 34.7 38.5 36.8C36.4 37.6 33.6 37.3 32 36.7C30.4 37.3 27.6 37.6 25.5 36.8Z" fill={hairSh} />
        )}
        {ch.facial === "goatee" && (
          <path d="M27.8 40.8C29.5 44.2 34.5 44.2 36.2 40.8C34.5 42 29.5 42 27.8 40.8Z" fill={hairSh} />
        )}

        {/* ---------- Mouth ---------- */}
        {ch.facial !== "fullbeard" && (
          <g>
            {ch.mouth === "grin" ? (
              <>
                <path d="M26.8 36.8C29 40.8 35 40.8 37.2 36.8Z" fill="#fffdf8" stroke={lip} strokeWidth="1.2" strokeLinejoin="round" />
              </>
            ) : ch.mouth === "smile" ? (
              <path d="M27.4 37.2C29.6 39.6 34.4 39.6 36.6 37.2" stroke={lip} strokeWidth="1.7" strokeLinecap="round" fill="none" />
            ) : ch.mouth === "smirk" ? (
              <path d="M28 37.8C31.2 38.8 34.8 38.2 37.2 36.2" stroke={lip} strokeWidth="1.7" strokeLinecap="round" fill="none" />
            ) : (
              <path d="M28.5 37.8C30.8 38.4 33.2 38.4 35.5 37.8" stroke={lip} strokeWidth="1.6" strokeLinecap="round" fill="none" />
            )}
          </g>
        )}

        {/* ---------- Front Hair Layer ---------- */}
        {ch.hairStyle === "bob" && (
          <g>
            <path d="M14.5 26C14.5 14 22 8.5 32 8.5C42 8.5 49.5 14 49.5 26C47 19.5 41 18.5 36 19.5C30 20.8 24 23.5 18 22.5Z" fill={`url(#${uid}-hair)`} />
            <path d="M22 13.5C27 11 35 11 40 13.5" stroke={hairHi} strokeWidth="2.2" strokeLinecap="round" opacity="0.65" />
          </g>
        )}
        {ch.hairStyle === "sidepart" && (
          <g>
            <path d="M16.5 26C16 15 22.5 9 32.5 9C42.5 9 48 15 47.5 26C46.5 21 44 19 41 18.5C34 17.5 26 20 22 19C20 18.5 18 21.5 16.5 26Z" fill={`url(#${uid}-hair)`} />
            <path d="M23.5 12.5L22.5 19" stroke={hairDeep} strokeWidth="1.4" strokeLinecap="round" />
            <path d="M27 12.5C32 11 38 11.5 42 14" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          </g>
        )}
        {ch.hairStyle === "longwavy" && (
          <g>
            <path d="M15 26C15 14 22 8.5 32 8.5C42 8.5 49 14 49 26C47 21 41 18.5 33 17.5C25 18.5 19 21 15 26Z" fill={`url(#${uid}-hair)`} />
            <path d="M22 13C27 10.5 37 10.5 42 13" stroke={hairHi} strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
            {ch.hairpin && <rect x="17.5" y="19.5" width="7" height="2.6" rx="1.3" transform="rotate(-14 17.5 19.5)" fill={ch.hairpin} />}
          </g>
        )}
        {ch.hairStyle === "afro" && (
          <path d="M17.5 22C19 16 25 14 32 14C39 14 45 16 46.5 22C42 19 37 18 32 18C27 18 22 19 17.5 22Z" fill={ch.hair} />
        )}
        {ch.hairStyle === "highbun" && (
          <g>
            <path d="M16.5 26C16.5 17 23 13 32 13C41 13 47.5 17 47.5 26C45 21 41 20 38 20.5C34 21.5 30 21.5 26 20.5C23 20 19 21 16.5 26Z" fill={`url(#${uid}-hair)`} />
            <rect x="23.5" y="12.5" width="17" height="3.6" rx="1.8" fill={shirtHi} stroke={shirtSh} strokeWidth="0.6" />
            <path d="M23 17.2C28 15.6 36 15.6 41 17.2" stroke={hairHi} strokeWidth="1.8" strokeLinecap="round" opacity="0.55" />
          </g>
        )}
        {ch.hairStyle === "messy" && (
          <g>
            <path d="M16 26C15.5 14.5 22.5 8.8 32 8.8C41.5 8.8 48.5 14.5 48 26C46 21.5 43 20 40.5 22C38.5 18.5 35 19 32.5 22.5C29.5 19 25.5 19 23 22C20.5 20 18 21.5 16 26Z" fill={`url(#${uid}-hair)`} />
            <path d="M23 12.5C27.5 10.5 35 10.5 40 12.8" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          </g>
        )}
        {ch.hairStyle === "hijab" && (
          <g>
            <path d="M14 29C14 14.5 21.5 8.5 32 8.5C42.5 8.5 50 14.5 50 29C47.5 19.5 41 16.5 32 16.5C23 16.5 16.5 19.5 14 29Z" fill={`url(#${uid}-hair)`} />
            <path d="M18.5 22C23.5 18.5 40.5 18.5 45.5 22" stroke={hairDeep} strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
            <path d="M22 12.5C27 10.2 37 10.2 42 12.5" stroke={hairHi} strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
            {/* Graceful chin-framing wrap */}
            <path d="M15.8 39.5C20.5 45.5 43.5 45.5 48.2 39.5C47.2 46.2 40.8 50.5 32 50.5C23.2 50.5 16.8 46.2 15.8 39.5Z" fill={`url(#${uid}-hair)`} />
            <path d="M21 45.2C26.5 48.2 37.5 48.2 43 45.2" stroke={hairHi} strokeWidth="1.4" strokeLinecap="round" opacity="0.55" />
            <circle cx="44.5" cy="39.2" r="1.8" fill="#fdfaf2" stroke={hairSh} strokeWidth="0.6" />
          </g>
        )}
        {ch.hairStyle === "spiky" && (
          <g>
            <path
              d="M16.5 26C16 17.5 18 13 21 11.5L19.5 7.5L25 10.2L27.5 5L32.5 9.2L37.5 5.5L39 10.5L44.5 8.5L43 13C46.5 15.5 48 19.5 47.5 26C45 20.5 41 18.5 37 20C34 18 29 18 26 20C22.5 18.5 19 20.5 16.5 26Z"
              fill={`url(#${uid}-hair)`}
            />
            <path d="M25 12.5C29 10.5 35 10.5 39 12.5" stroke={hairHi} strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          </g>
        )}
        {ch.hairStyle === "twinpuffs" && (
          <g>
            <path d="M16.5 26C16.5 15.5 22.5 11.5 32 11.5C41.5 11.5 47.5 15.5 47.5 26C45 20.5 39 19 32 18.5C25 19 19 20.5 16.5 26Z" fill={`url(#${uid}-hair)`} />
            <line x1="32" y1="11.5" x2="32" y2="18.5" stroke={hairDeep} strokeWidth="1.2" />
          </g>
        )}
        {ch.hairStyle === "bald" && (
          <g>
            <ellipse cx="26.5" cy="18.2" rx="4.2" ry="2.1" transform="rotate(-14 26.5 18.2)" fill="#fffdf8" opacity="0.48" />
            <path d="M16.8 24.5C15.8 27 16 30.5 17.8 32.5C18.5 30 18.5 27 18.2 24.5Z" fill={ch.hair} />
            <path d="M47.2 24.5C48.2 27 48 30.5 46.2 32.5C45.5 30 45.5 27 45.8 24.5Z" fill={hairSh} />
          </g>
        )}
        {ch.hairStyle === "curlyband" && (
          <g>
            <path d="M15 26C15 14 22 9 32 9C42 9 49 14 49 26C46.5 20.5 41 18.5 32 18.5C23 18.5 17.5 20.5 15 26Z" fill={`url(#${uid}-hair)`} />
            {ch.headband && (
              <path d="M15.8 20.5C21.5 14.8 42.5 14.8 48.2 20.5" stroke={ch.headband} strokeWidth="4.2" strokeLinecap="round" fill="none" />
            )}
            {ch.headband && (
              <path d="M21 17.2C27 14.8 37 14.8 43 17.2" stroke="#fff6df" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.7" />
            )}
          </g>
        )}
        {ch.hairStyle === "curtain" && (
          <g>
            <path d="M15.5 27C15 14.5 22 8.8 32 8.8C42 8.8 49 14.5 48.5 27C47 21 43 22 39.5 24C36.5 20 34 17 32 15.5C30 17 27.5 20 24.5 24C21 22 17 21 15.5 27Z" fill={`url(#${uid}-hair)`} />
            <path d="M22 13C27 10.8 37 10.8 42 13" stroke={hairHi} strokeWidth="2.2" strokeLinecap="round" opacity="0.65" />
          </g>
        )}
        {ch.hairStyle === "ponytail" && (
          <g>
            <path d="M16 26.5C15.5 14.5 22.5 9 32 9C41.5 9 48.5 14.5 48 26.5C45.5 20.5 40 19 34.5 18.2C27.5 19.2 21.5 22.5 16 26.5Z" fill={`url(#${uid}-hair)`} />
            <path d="M23 13C28 10.8 36 10.8 41 13" stroke={hairHi} strokeWidth="2.1" strokeLinecap="round" opacity="0.6" />
            {ch.hairpin && <rect x="18" y="19.5" width="7" height="2.6" rx="1.3" transform="rotate(-14 18 19.5)" fill={ch.hairpin} />}
          </g>
        )}
        {ch.hairStyle === "beanie" && (
          <g>
            {/* Soft hair peeking under knit beanie */}
            <path d="M16.5 26.5C17 21.5 21 19 25 20.5C29 19 35 19 39 20.5C43 19 47 21.5 47.5 26.5C45.5 23 43 22 40 22.8C36 21.8 28 21.8 24 22.8C21 22 18.5 23 16.5 26.5Z" fill={`url(#${uid}-hair)`} />
            {/* Pom-pom */}
            <circle cx="32" cy="6.8" r="4.2" fill={capBase} stroke={capSh} strokeWidth="0.7" />
            <path d="M30.2 5.4C31.2 4.6 32.8 4.6 33.8 5.4" stroke={capHi} strokeWidth="1.4" strokeLinecap="round" opacity="0.65" />
            {/* Knit dome */}
            <path d="M15.5 21.5C15.5 12 22 7.5 32 7.5C42 7.5 48.5 12 48.5 21.5Z" fill={capBase} />
            <path d="M21 11.5C26 9.5 34 9.5 40 11.5" stroke={capHi} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            {/* Folded ribbed cuff */}
            <rect x="14.5" y="17.5" width="35" height="6.2" rx="3" fill={capBase} stroke={capSh} strokeWidth="0.85" />
            <g stroke={capSh} strokeWidth="1.1" opacity="0.55">
              <line x1="20" y1="18.2" x2="20" y2="23" />
              <line x1="25" y1="18.2" x2="25" y2="23" />
              <line x1="30" y1="18.2" x2="30" y2="23" />
              <line x1="35" y1="18.2" x2="35" y2="23" />
              <line x1="40" y1="18.2" x2="40" y2="23" />
              <line x1="44.5" y1="18.2" x2="44.5" y2="23" />
            </g>
          </g>
        )}
        {ch.hairStyle === "pompadour" && (
          <g>
            <path d="M16.5 26C15.8 18 17.5 10.5 24 7.8C31.5 4.8 43 7 46.8 14.2C48.5 17.5 48.2 22 47.5 26C45.8 20.5 43.2 18.2 38.5 18C32.5 17.8 26 19 21.5 19.2C19 19.3 17.6 22 16.5 26Z" fill={`url(#${uid}-hair)`} />
            <path d="M22.5 11.2C28 8.2 36.5 8.5 41.5 12.2" stroke={hairHi} strokeWidth="2.4" strokeLinecap="round" opacity="0.62" />
            <path d="M24 14.5C29.5 12.6 35.5 13 40 15" stroke={hairDeep} strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
          </g>
        )}
        {ch.hairStyle === "braids" && (
          <g>
            <path d="M15.5 26.5C15.5 14.5 22 9 32 9C42 9 48.5 14.5 48.5 26.5C46 20.8 40 18.8 32 17.8C24 18.8 18 20.8 15.5 26.5Z" fill={`url(#${uid}-hair)`} />
            <line x1="32" y1="9.2" x2="32" y2="17.8" stroke={hairDeep} strokeWidth="1.2" />
            <path d="M22 13C27 10.8 37 10.8 42 13" stroke={hairHi} strokeWidth="2.1" strokeLinecap="round" opacity="0.6" />
          </g>
        )}

        {/* ---------- Eyewear ---------- */}
        {ch.glasses === "round" && (
          <g stroke="#6c625c" strokeWidth="1.5" fill="#e6f2ff" fillOpacity="0.22">
            <circle cx="25.2" cy="29.8" r="4.6" />
            <circle cx="38.8" cy="29.8" r="4.6" />
            <path d="M29.8 29.8H34.2" fill="none" />
            <path d="M22.6 27.6L24.4 29.2" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.75" />
            <path d="M36.2 27.6L38 29.2" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.75" />
          </g>
        )}
        {ch.glasses === "cateye" && (
          <g stroke="#2d2332" strokeWidth="1.65" fill="#eef4ff" fillOpacity="0.2">
            <path d="M19.5 27.2L29.6 27.8C29.8 31.8 27.8 33.8 24.8 33.8C21.6 33.8 20 31.4 19.5 27.2Z" strokeLinejoin="round" />
            <path d="M44.5 27.2L34.4 27.8C34.2 31.8 36.2 33.8 39.2 33.8C42.4 33.8 44 31.4 44.5 27.2Z" strokeLinejoin="round" />
            <path d="M29.6 28.8H34.4" fill="none" />
          </g>
        )}
        {ch.glasses === "rect" && (
          <g stroke="#261e2a" strokeWidth="1.9" fill="#e8f3ff" fillOpacity="0.22">
            <rect x="20.2" y="26.2" width="9.8" height="7.4" rx="2.1" />
            <rect x="34" y="26.2" width="9.8" height="7.4" rx="2.1" />
            <path d="M30 29.2H34" fill="none" />
            <line x1="22.2" y1="28.2" x2="24.5" y2="30.5" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
            <line x1="36" y1="28.2" x2="38.3" y2="30.5" stroke="#ffffff" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
          </g>
        )}
        {ch.glasses === "halfrim" && (
          <g>
            <rect x="20.6" y="27.2" width="9.2" height="5.8" rx="1.6" fill="#e8f3ff" fillOpacity="0.22" />
            <rect x="34.2" y="27.2" width="9.2" height="5.8" rx="1.6" fill="#e8f3ff" fillOpacity="0.22" />
            <path d="M20.4 27.2H29.8M34.2 27.2H43.6M29.8 28.4H34.2" stroke="#3c3338" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        )}

        {/* Crisp inner studio frame border (adapts softly to both Light & Dark surfaces) */}
        <rect
          x="0.75"
          y="0.75"
          width="62.5"
          height="62.5"
          rx={shape === "circle" ? 31.25 : 15.25}
          stroke="#271b22"
          strokeOpacity="0.14"
          strokeWidth="1.5"
        />
      </g>
    </svg>
  );
}

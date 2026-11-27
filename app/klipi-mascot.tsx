"use client";
import { useId } from "react";
import type { StaplerMood } from "@/lib/stapler-state";

export type KlipiFx = "none" | "gulp" | "pop";

/**
 * Klipi — Original Warm Editorial Studio paperclip-note buddy mascot.
 * Renders a cozy honey-cream note cushion held by a sculpted copper paperclip loop,
 * with expressive eyes, rosy cheeks, voice-reactive mouth & mini studio headset while recording.
 */
export default function KlipiMascot({
  mood = "idle",
  size = "md",
  fx = "none",
}: {
  mood?: StaplerMood;
  size?: "md" | "lg";
  fx?: KlipiFx;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const isRecording = mood === "recording";
  const isPaused = mood === "paused";
  const isHappy = mood === "happy" || mood === "nudge";
  const showHeadset = isRecording || isPaused;
  const headsetColor = isPaused ? "#d97706" : "#d93b3b";
  const w = size === "lg" ? 42 : 36;
  const h = size === "lg" ? 40 : 34;

  return (
    <span
      className={`stapler-face klipi-face is-${mood} sz-${size}${fx !== "none" ? ` fx-${fx}` : ""}`}
      aria-hidden="true"
    >
      {isRecording && <span className="stapler-rec-ripple" />}
      <svg
        className="klipi-svg"
        width={w}
        height={h}
        viewBox="0 0 44 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id={`${uid}-card`} x1="8" y1="8" x2="36" y2="38" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#fff6d9" />
            <stop offset="52%" stopColor="#ffe07d" />
            <stop offset="100%" stopColor="#f5be48" />
          </linearGradient>
          <linearGradient id={`${uid}-clip`} x1="10" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f39a68" />
            <stop offset="55%" stopColor="#d4633c" />
            <stop offset="100%" stopColor="#a84323" />
          </linearGradient>
        </defs>

        {/* Subtle paper-note body cushion */}
        <rect
          x="5.5"
          y="9.5"
          width="33"
          height="28.5"
          rx="10"
          fill={`url(#${uid}-card)`}
          stroke={isRecording ? "#d93b3b" : isPaused ? "#d97706" : "#cf8c22"}
          strokeWidth={showHeadset ? "1.6" : "1.35"}
        />

        {/* Soft warm top highlight sheen */}
        <path
          d="M14 12.2H31.5"
          stroke="#ffffff"
          strokeOpacity="0.65"
          strokeWidth="1.8"
          strokeLinecap="round"
        />

        {/* Cute folded note corner at bottom-right */}
        <path
          d="M31.5 37.8C32.2 33.4 33.8 31.8 38.2 31.2V31.5C38.2 35 35.4 37.8 31.8 37.8H31.5Z"
          fill="#e2a130"
          fillOpacity="0.52"
        />
        <path
          d="M31.6 37.6C32.3 33.6 33.9 32 38 31.4"
          stroke="#c8851d"
          strokeOpacity="0.55"
          strokeWidth="1"
          strokeLinecap="round"
        />

        {/* Signature sculpted copper paperclip loop hugging top-left */}
        <g className="klipi-clip">
          <path
            d="M11.4 15.2V6.1C11.4 3.6 16.4 3.6 16.4 6.1V15.8C16.4 17.6 13.6 17.6 13.6 15.8V8.4"
            stroke="#fff7e2"
            strokeOpacity="0.72"
            strokeWidth="3.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M11.4 15.2V6.1C11.4 3.6 16.4 3.6 16.4 6.1V15.8C16.4 17.6 13.6 17.6 13.6 15.8V8.4"
            stroke={`url(#${uid}-clip)`}
            strokeWidth="2.35"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Mini studio headset when actively recording or paused */}
        {showHeadset && (
          <g className="klipi-headset">
            <path
              d="M5.2 22.5C5.2 8.2 38.8 8.2 38.8 22.5"
              stroke={headsetColor}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <rect x="2.2" y="19" width="4.4" height="9.2" rx="2.2" fill={headsetColor} />
            <rect x="37.4" y="19" width="4.4" height="9.2" rx="2.2" fill={headsetColor} />
            <rect x="3.2" y="21" width="1.2" height="5" rx="0.6" fill="#ffffff" fillOpacity="0.4" />
            <rect x="38.4" y="21" width="1.2" height="5" rx="0.6" fill="#ffffff" fillOpacity="0.4" />
          </g>
        )}

        {/* Rosy studio cheeks */}
        <g className="klipi-cheeks">
          <ellipse cx="11.6" cy="26.9" rx="2.7" ry="1.45" fill="#ee7968" />
          <ellipse cx="32.4" cy="26.9" rx="2.7" ry="1.45" fill="#ee7968" />
        </g>

        {/* Expressive animated eyes */}
        <g className="klipi-eyes">
          {isHappy ? (
            <>
              <path d="M13.8 23.6Q16.5 19.8 19.2 23.6" stroke="#2c1e16" strokeWidth="2.1" strokeLinecap="round" />
              <path d="M24.8 23.6Q27.5 19.8 30.2 23.6" stroke="#2c1e16" strokeWidth="2.1" strokeLinecap="round" />
            </>
          ) : isPaused ? (
            <>
              <path d="M14 23Q16.5 24.4 19 23" stroke="#2c1e16" strokeWidth="2" strokeLinecap="round" />
              <path d="M25 23Q27.5 24.4 30 23" stroke="#2c1e16" strokeWidth="2" strokeLinecap="round" />
            </>
          ) : (
            <>
              <g className="klipi-eye">
                <ellipse cx="16.5" cy="22.8" rx="2.35" ry={isRecording ? 2.85 : 2.6} fill="#2c1e16" />
                <circle cx="15.7" cy="21.7" r="0.82" fill="#ffffff" />
              </g>
              <g className="klipi-eye">
                <ellipse cx="27.5" cy="22.8" rx="2.35" ry={isRecording ? 2.85 : 2.6} fill="#2c1e16" />
                <circle cx="26.7" cy="21.7" r="0.82" fill="#ffffff" />
              </g>
            </>
          )}
        </g>

        {/* Mood-responsive mouth */}
        {isRecording ? (
          <ellipse
            className="klipi-voice-mouth"
            cx="22"
            cy="28.6"
            rx="2.65"
            ry="2.2"
            fill="#2c1e16"
          />
        ) : isHappy ? (
          <g>
            <path d="M18.4 27.2Q22 32.2 25.6 27.2Z" fill="#7c3120" />
            <ellipse cx="22" cy="29.4" rx="1.8" ry="0.95" fill="#ef7e6d" />
          </g>
        ) : isPaused ? (
          <path d="M20 28.4Q22 29.4 24 28.4" stroke="#2c1e16" strokeWidth="1.7" strokeLinecap="round" />
        ) : (
          <path
            className="klipi-smile"
            d="M19 27.6Q22 30.4 25 27.6"
            stroke="#2c1e16"
            strokeWidth="1.85"
            strokeLinecap="round"
          />
        )}
      </svg>
      {mood === "draft" && <span className="stapler-draft-dot" />}
    </span>
  );
}

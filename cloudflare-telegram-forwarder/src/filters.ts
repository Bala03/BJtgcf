import type { FilterStep } from "./types";

export type FilterResult = {
  text: string | null | undefined;
  drop: boolean;
};

function safeRegex(pattern: string, flags = ""): RegExp {
  return new RegExp(pattern, flags.replace(/[^gimsuy]/g, ""));
}

/**
 * Apply pipeline to message text. Non-text messages skip text filters in the bot layer.
 */
export function applyFilterPipeline(
  initialText: string | undefined,
  steps: FilterStep[],
): FilterResult {
  if (!initialText) {
    for (const s of steps) {
      if (s.type === "drop_if_text_missing") return { text: null, drop: true };
    }
    return { text: undefined, drop: false };
  }

  let text = initialText;

  for (const step of steps) {
    switch (step.type) {
      case "drop_if_text_missing":
        return { text: null, drop: true };
      case "drop_if_not_regex": {
        const re = safeRegex(step.pattern, step.flags ?? "");
        if (!re.test(text)) return { text: null, drop: true };
        break;
      }
      case "drop_if_regex": {
        const re = safeRegex(step.pattern, step.flags ?? "");
        if (re.test(text)) return { text: null, drop: true };
        break;
      }
      case "replace_literal":
        text = text.split(step.from).join(step.to);
        break;
      case "replace_regex": {
        const re = safeRegex(step.pattern, step.flags ?? "g");
        text = text.replace(re, step.replacement);
        break;
      }
      case "prefix":
        text = `${step.value}${text}`;
        break;
      case "suffix":
        text = `${text}${step.value}`;
        break;
      case "truncate":
        if (text.length > step.max) text = text.slice(0, step.max);
        break;
      case "lowercase":
        text = text.toLowerCase();
        break;
      case "uppercase":
        text = text.toUpperCase();
        break;
      case "blocklist": {
        const ci = step.caseInsensitive ?? true;
        const hay = ci ? text.toLowerCase() : text;
        for (const t of step.terms) {
          const needle = ci ? t.toLowerCase() : t;
          if (needle && hay.includes(needle)) return { text: null, drop: true };
        }
        break;
      }
      case "allowlist": {
        const ci = step.caseInsensitive ?? true;
        const mode = step.mode ?? "any";
        const hay = ci ? text.toLowerCase() : text;
        const terms = step.terms.map((t) => (ci ? t.toLowerCase() : t));
        if (mode === "any") {
          const ok = terms.some((t) => t && hay.includes(t));
          if (!ok) return { text: null, drop: true };
        } else {
          const ok = terms.every((t) => !t || hay.includes(t));
          if (!ok) return { text: null, drop: true };
        }
        break;
      }
      default:
        break;
    }
  }
  return { text, drop: false };
}

export function parsePipeline(json: string): FilterStep[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v as FilterStep[];
  } catch {
    return [];
  }
}

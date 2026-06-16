import { createContext, useContext } from "react";
import type { ActProvision } from "../../types";

// The language the law view currently renders. Provided at DeltaReview (the EN/FR
// toggle), consumed by every component that prints statutory text so one switch
// flips the whole view. Falls back to English when a French string is missing
// (e.g. an Act not yet re-ingested to the bilingual format).
export type Lang = "en" | "fr";

export const LangContext = createContext<Lang>("en");
export const useLang = () => useContext(LangContext);

export const provText = (p: ActProvision, lang: Lang) =>
  lang === "fr" && p.textFr ? p.textFr : p.text;

export const provNote = (p: ActProvision, lang: Lang) =>
  (lang === "fr" && p.marginalNoteFr ? p.marginalNoteFr : p.marginalNote) ?? null;

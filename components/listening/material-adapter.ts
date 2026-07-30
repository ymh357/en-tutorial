// Adapts a Material (video/audio with real subtitles) into the ShadowingData
// shape the three-stage flow consumes. Video captions only carry text;
// translation/imageryHint are empty and the imagine/recall stages render
// fallback content (title+thumbnail / hide bilingual) — see shadowing-tab.

import type { Material } from "@/lib/types";
import type { ShadowingData } from "@/components/listening/shadowing-tab";

export const materialToShadowingData = (material: Material): ShadowingData => ({
  topic: material.topic,
  context: material.title,
  sentences: (material.sentences ?? []).map((s) => ({
    text: s.text,
    translation: "",
    imageryHint: "",
  })),
});

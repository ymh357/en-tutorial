"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ShadowingTab } from "@/components/listening/shadowing-tab";
import { ErrorState } from "@/components/states/error-state";
import { useProfile } from "@/hooks/use-db";
import { db } from "@/lib/db";
import type { Material } from "@/lib/types";

// Loaded once into state (rather than re-read on every render) so the
// `material` object identity is stable — ShadowingTab depends on it in an
// effect that (re)creates the YouTube player (Task 5 review note).
export const VideoListeningClient = ({
  materialId,
}: {
  materialId: string;
}) => {
  const profile = useProfile();
  const [material, setMaterial] = useState<Material | null | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    void db.materials.get(materialId).then((found) => {
      if (!cancelled) setMaterial(found ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  if (material === undefined) {
    // Deferred ④: previously an empty fragment gave no visual feedback while
    // the material loaded from IndexedDB.
    return (
      <div className="flex max-w-3xl items-center justify-center p-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (material === null) {
    return (
      <div className="max-w-3xl p-4 md:p-6">
        <ErrorState title="素材不存在" description="未找到该视频素材。" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6 p-4 md:space-y-8 md:p-6">
      <ShadowingTab
        cefrLevel={profile?.studyLevel ?? "B1"}
        material={material}
      />
    </div>
  );
};

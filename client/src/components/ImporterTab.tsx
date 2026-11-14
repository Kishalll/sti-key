import React, { useState, useEffect, useRef } from "react";
import { UploadCloud, FolderArchive, ArrowRight, X, Sparkles, Image, Check, AlertCircle } from "lucide-react";
import { StagedItem, StickerRecord } from "../types";

export const ImporterTab: React.FC<{ onStickerAdded?: () => void }> = ({ onStickerAdded }) => {
  const [filterMode, setFilterMode] = useState<"stickers_only" | "media_only" | "both">("stickers_only");
  const [stagedQueue, setStagedQueue] = useState<StagedItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTag, setCurrentTag] = useState("");
  const [fitMode, setFitMode] = useState<"fit" | "crop">("fit");
  const [isUploading, setIsUploading] = useState(false);
  const [similarStickers, setSimilarStickers] = useState<StickerRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  const currentItem = stagedQueue[currentIndex];

  // Sync current tag input whenever current item changes
  useEffect(() => {
    if (currentItem) {
      setCurrentTag(currentItem.suggestedTag || "");
      if (tagInputRef.current) {
        tagInputRef.current.focus();
        tagInputRef.current.select();
      }
    }
  }, [currentIndex, stagedQueue]);

  // Query live similar stickers
  useEffect(() => {
    if (!currentTag.trim()) {
      setSimilarStickers([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stickers?search=${encodeURIComponent(currentTag)}`);
        const data = await res.json();
        setSimilarStickers(data.stickers || []);
      } catch {
        setSimilarStickers([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [currentTag]);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setErrorMsg(null);

    const isArchive = file.name.endsWith(".zip") || file.name.endsWith(".wastickers");

    const formData = new FormData();
    formData.append("file", file);

    try {
      if (isArchive) {
        formData.append("filterMode", filterMode);
        const res = await fetch("/api/staging/upload-zip", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Failed to unpack archive");
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          setStagedQueue(data.items);
          setCurrentIndex(0);
        } else {
          setErrorMsg("No matching files found in archive for chosen filter mode.");
        }
      } else {
        // Direct single file upload
        formData.append("mode", "fit");
        const res = await fetch("/api/stickers/upload", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error("Failed to upload sticker");
        onStickerAdded?.();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCommit = async () => {
    if (!currentItem) return;
    try {
      const res = await fetch("/api/staging/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stagedId: currentItem.id,
          tag: currentTag.trim(),
          mode: fitMode,
        }),
      });

      if (res.ok) {
        onStickerAdded?.();
        advanceQueue();
      }
    } catch (err) {
      console.error("Failed to commit item", err);
    }
  };

  const handleSkip = async () => {
    if (!currentItem) return;
    try {
      await fetch(`/api/staging/${currentItem.id}`, { method: "DELETE" });
      advanceQueue();
    } catch (err) {
      console.error("Failed to skip item", err);
    }
  };

  const advanceQueue = () => {
    setStagedQueue((prev) => prev.filter((_, idx) => idx !== currentIndex));
    if (currentIndex >= stagedQueue.length - 1) {
      setCurrentIndex(0);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Upload Header Box */}
      {stagedQueue.length === 0 ? (
        <div className="space-y-6">
          <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 bg-slate-950/60 rounded-3xl p-12 text-center transition-colors">
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
              accept=".zip,.wastickers,.webp,.png,.jpg,.jpeg,.gif,.mp4"
              className="hidden"
            />
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4 text-emerald-400 shadow-inner">
              <UploadCloud className="w-8 h-8" />
            </div>
            <h2 className="text-base font-semibold text-slate-100">Upload Stickers or Bulk Archive</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Drop your WhatsApp sticker export (.zip, .wastickers) or direct media files (.webp, .png, .gif, .mp4).
            </p>

            {/* Filter Mode Selector */}
            <div className="inline-flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 mt-6 text-xs">
              <button
                type="button"
                onClick={() => setFilterMode("stickers_only")}
                className={`px-3 py-1 rounded-lg transition-all ${
                  filterMode === "stickers_only"
                    ? "bg-slate-800 text-slate-100 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Stickers Only (.webp)
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("media_only")}
                className={`px-3 py-1 rounded-lg transition-all ${
                  filterMode === "media_only"
                    ? "bg-slate-800 text-slate-100 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Raw Media (Images / Video)
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("both")}
                className={`px-3 py-1 rounded-lg transition-all ${
                  filterMode === "both"
                    ? "bg-slate-800 text-slate-100 font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Both
              </button>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all inline-flex items-center gap-2"
              >
                {isUploading ? (
                  <span>Unpacking files...</span>
                ) : (
                  <>
                    <FolderArchive className="w-4 h-4" />
                    <span>Select Archive or Image</span>
                  </>
                )}
              </button>
            </div>

            {errorMsg && (
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-rose-400">
                <AlertCircle className="w-4 h-4" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Flashcard Tagging Queue */
        <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
            <div>
              <span className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">
                Staging Queue
              </span>
              <h3 className="text-sm font-bold text-slate-200">
                Sticker {currentIndex + 1} of {stagedQueue.length}
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFitMode(fitMode === "fit" ? "crop" : "fit")}
                className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium text-slate-300 hover:text-slate-100"
              >
                Mode: {fitMode.toUpperCase()}
              </button>
              <button
                type="button"
                onClick={() => setStagedQueue([])}
                className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
                title="Discard all remaining"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            {/* Media Preview Box */}
            <div className="aspect-square bg-slate-900/60 border border-slate-800/80 rounded-2xl flex items-center justify-center p-4 relative overflow-hidden">
              {currentItem.isAnimated ? (
                <video
                  src={`/staging/${currentItem.filePath.split("/storage/staging/")[1]}`}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <img
                  src={`/staging/${currentItem.filePath.split("/storage/staging/")[1]}`}
                  alt="Staged preview"
                  className="max-w-full max-h-full object-contain filter drop-shadow-md"
                />
              )}

              <div className="absolute bottom-2 left-2 text-[10px] text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded backdrop-blur">
                {currentItem.fileName}
              </div>
            </div>

            {/* Tagging Controls */}
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">
                  Assign Trigger Tag
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-sm">
                    .
                  </span>
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={currentTag}
                    onChange={(e) => setCurrentTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCommit();
                      if (e.key === "Escape") handleSkip();
                    }}
                    placeholder="tag_name (e.g. cat, laugh)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-7 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Press <kbd className="px-1 bg-slate-800 rounded text-slate-300">Enter</kbd> to save, or <kbd className="px-1 bg-slate-800 rounded text-slate-300">Esc</kbd> to skip.
                </p>
              </div>

              {/* Live Similarity Preview Strip */}
              {similarStickers.length > 0 && (
                <div>
                  <div className="text-[11px] font-medium text-slate-400 mb-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>Existing Similar Stickers:</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {similarStickers.slice(0, 5).map((sim) => (
                      <div
                        key={sim.id}
                        onClick={() => setCurrentTag(sim.tag)}
                        className="cursor-pointer bg-slate-900 border border-slate-800 rounded-xl p-1.5 flex-shrink-0 w-16 text-center hover:border-emerald-500 transition-colors"
                        title={`Click to reuse tag: .${sim.tag}`}
                      >
                        <img
                          src={`/stickers/${sim.file_path}`}
                          alt={sim.tag}
                          className="w-12 h-12 object-contain mx-auto"
                        />
                        <span className="text-[9px] text-slate-400 truncate block mt-1">
                          {sim.tag}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-4 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={handleCommit}
                  className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Save Sticker (Enter)</span>
                </button>
                <button
                  type="button"
                  onClick={handleSkip}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs rounded-xl border border-slate-800 transition-all"
                >
                  Skip (Esc)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

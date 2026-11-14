import React, { useState, useEffect } from "react";
import { Search, Film, Tag, Edit2, Trash2, Check, X, RefreshCw } from "lucide-react";
import { StickerRecord, TagIndexStats } from "../types";

export const LibraryTab: React.FC = () => {
  const [stickers, setStickers] = useState<StickerRecord[]>([]);
  const [stats, setStats] = useState<TagIndexStats>({ totalStickers: 0, uniqueTags: 0 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState("");

  const fetchStickers = async (query = "") => {
    setLoading(true);
    try {
      const url = query ? `/api/stickers?search=${encodeURIComponent(query)}` : "/api/stickers";
      const res = await fetch(url);
      const data = await res.json();
      setStickers(data.stickers || []);
      setStats(data.stats || { totalStickers: 0, uniqueTags: 0 });
    } catch (err) {
      console.error("Failed to load stickers", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStickers(search);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);

  const handleStartRename = (sticker: StickerRecord) => {
    setEditingId(sticker.id);
    setEditingTag(sticker.tag);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingTag.trim()) return;
    try {
      const res = await fetch(`/api/stickers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: editingTag }),
      });
      if (res.ok) {
        const updated = await res.json();
        setStickers((prev) => prev.map((s) => (s.id === id ? updated : s)));
        setEditingId(null);
      }
    } catch (err) {
      console.error("Failed to rename tag", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this sticker?")) return;
    try {
      const res = await fetch(`/api/stickers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setStickers((prev) => prev.filter((s) => s.id !== id));
        setStats((prev) => ({
          totalStickers: Math.max(0, prev.totalStickers - 1),
          uniqueTags: prev.uniqueTags,
        }));
      }
    } catch (err) {
      console.error("Failed to delete sticker", err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Search and Stats bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags (e.g. cat, laugh, wow)..."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-6 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200 text-sm">{stats.totalStickers}</span>
            <span>Total Stickers</span>
          </div>
          <div className="w-px h-4 bg-slate-800" />
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200 text-sm">{stats.uniqueTags}</span>
            <span>Unique Tags</span>
          </div>
          <button
            onClick={() => fetchStickers(search)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
            title="Refresh library"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Stickers Grid */}
      {stickers.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
          <Tag className="w-10 h-10 mx-auto text-slate-600 mb-3" />
          <h3 className="text-sm font-semibold text-slate-300">No stickers found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {search
              ? "No stickers match your search query. Try another term or add new ones in the Importer tab."
              : "Your sticker library is empty. Upload stickers or import archives from the Importer tab."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {stickers.map((sticker) => {
            const isEditing = editingId === sticker.id;
            return (
              <div
                key={sticker.id}
                className="group relative bg-slate-950/70 border border-slate-800/80 rounded-2xl overflow-hidden hover:border-slate-700 transition-all shadow-sm hover:shadow-md"
              >
                {/* Media Container */}
                <div className="aspect-square bg-slate-900/40 flex items-center justify-center p-3 relative">
                  <img
                    src={`/stickers/${sticker.file_path}`}
                    alt={sticker.tag}
                    className="max-w-full max-h-full object-contain filter drop-shadow-sm"
                    loading="lazy"
                  />

                  {Boolean(sticker.is_animated) && (
                    <span className="absolute top-2 right-2 flex items-center gap-1 bg-slate-900/90 text-cyan-400 border border-cyan-800/60 text-[10px] font-medium px-2 py-0.5 rounded-full backdrop-blur">
                      <Film className="w-2.5 h-2.5" />
                      GIF
                    </span>
                  )}
                </div>

                {/* Footer and tag */}
                <div className="p-3 border-t border-slate-800/60 bg-slate-950/90">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={editingTag}
                        onChange={(e) => setEditingTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveRename(sticker.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        className="w-full bg-slate-900 border border-emerald-500 rounded px-1.5 py-0.5 text-xs text-slate-100 focus:outline-none"
                      />
                      <button
                        onClick={() => handleSaveRename(sticker.id)}
                        className="text-emerald-400 hover:text-emerald-300 p-0.5"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-slate-400 hover:text-slate-200 p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-medium text-slate-200 truncate flex items-center gap-1">
                        <span className="text-emerald-400 font-bold">.</span>
                        {sticker.tag}
                      </span>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        <button
                          onClick={() => handleStartRename(sticker)}
                          className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
                          title="Rename tag"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(sticker.id)}
                          className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800"
                          title="Delete sticker"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React, { useState, useEffect } from "react";
import { X, Sparkles } from "lucide-react";
import { ActivePicker } from "../types";

interface PickerOverlayProps {
  picker: ActivePicker;
  onSelect: (triggerId: string, stickerId: string) => void;
  onCancel: (triggerId: string) => void;
}

export const PickerOverlay: React.FC<PickerOverlayProps> = ({
  picker,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const candidates = picker.candidates || [];

  useEffect(() => {
    setSelectedIndex(0);
  }, [picker]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const len = candidates.length;
      if (len === 0) return;

      if (e.key === "ArrowRight" || e.key === "Tab") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % len);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + len) % len);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 4 < len ? prev + 4 : prev % 4));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 4 >= 0 ? prev - 4 : prev));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (candidates[selectedIndex]) {
          onSelect(picker.triggerId, candidates[selectedIndex].id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel(picker.triggerId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [candidates, selectedIndex, picker, onSelect, onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 max-w-2xl w-full shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Choose Sticker for <span className="text-emerald-400 font-mono">.{picker.query}</span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Use Arrow Keys + Enter or click to send
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onCancel(picker.triggerId)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 4-Column Grid */}
        <div className="grid grid-cols-4 gap-3 max-h-96 overflow-y-auto p-1">
          {candidates.map((stk, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={stk.id}
                onClick={() => onSelect(picker.triggerId, stk.id)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`cursor-pointer rounded-2xl p-2.5 flex flex-col items-center justify-center transition-all aspect-square border ${
                  isSelected
                    ? "bg-slate-800/90 border-emerald-400 ring-2 ring-emerald-500/30 scale-105"
                    : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                }`}
              >
                <img
                  src={`/stickers/${stk.file_path}`}
                  alt={stk.tag}
                  className="w-16 h-16 object-contain filter drop-shadow-sm mb-1"
                />
                <span className="text-[10px] text-slate-300 font-mono truncate max-w-full">
                  .{stk.tag}
                </span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 mt-4 pt-3 border-t border-slate-800">
          <span>{candidates.length} matching candidate stickers</span>
          <span>Press Esc to cancel</span>
        </div>
      </div>
    </div>
  );
};

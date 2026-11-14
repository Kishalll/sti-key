import React from "react";
import { Layers, UploadCloud, QrCode, Sparkles } from "lucide-react";
import { WhatsAppStatus } from "../types";

interface HeaderProps {
  activeTab: "library" | "importer" | "whatsapp";
  onTabChange: (tab: "library" | "importer" | "whatsapp") => void;
  status: WhatsAppStatus;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  status,
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case "connected":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            WhatsApp Linked
          </span>
        );
      case "qr_ready":
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-amber-950/80 text-amber-400 border border-amber-800">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            Scan QR Code
          </span>
        );
      case "disconnected":
      default:
        return (
          <span className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-rose-950/80 text-rose-400 border border-rose-800">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            Disconnected
          </span>
        );
    }
  };

  return (
    <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20">
            <Sparkles className="w-5 h-5 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-100 tracking-tight">Sti-Key</h1>
            <p className="text-xs text-slate-400">WhatsApp Sticker Companion</p>
          </div>
        </div>

        <nav className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => onTabChange("library")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "library"
                ? "bg-emerald-500 text-slate-950 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Layers className="w-4 h-4" />
            Library
          </button>
          <button
            onClick={() => onTabChange("importer")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "importer"
                ? "bg-emerald-500 text-slate-950 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <UploadCloud className="w-4 h-4" />
            Importer
          </button>
          <button
            onClick={() => onTabChange("whatsapp")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === "whatsapp"
                ? "bg-emerald-500 text-slate-950 shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <QrCode className="w-4 h-4" />
            WhatsApp
          </button>
        </nav>

        <div>{getStatusBadge()}</div>
      </div>
    </header>
  );
};

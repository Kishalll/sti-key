import React, { useState } from "react";
import { QrCode, CheckCircle2, AlertTriangle, LogOut, RefreshCw, Zap } from "lucide-react";
import { WhatsAppStatus } from "../types";

interface WhatsAppTabProps {
  status: WhatsAppStatus;
  qrDataUrl: string | null;
}

export const WhatsAppTab: React.FC<WhatsAppTabProps> = ({ status, qrDataUrl }) => {
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    try {
      await fetch("/api/whatsapp/connect", { method: "POST" });
    } catch (err) {
      console.error("Failed to connect", err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm("Are you sure you want to unlink and log out of WhatsApp?")) return;
    setLoading(true);
    try {
      await fetch("/api/whatsapp/logout", { method: "POST" });
    } catch (err) {
      console.error("Failed to logout", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="bg-slate-950/70 border border-slate-800 rounded-3xl p-8 shadow-xl text-center">
        {status === "connected" ? (
          <div>
            <div className="w-16 h-16 rounded-2xl bg-emerald-950/80 border border-emerald-800 flex items-center justify-center mx-auto mb-4 text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-slate-100">Companion Linked and Active</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              Your WhatsApp account is linked. Outgoing messages starting with a dot will be evaluated against your in-memory sticker library.
            </p>

            <div className="mt-8 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 text-left space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-400 mt-0.5">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Send Native Stickers</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Type <code className="text-emerald-400 bg-slate-950 px-1 py-0.5 rounded">.cat</code> in any chat. The bot sends the sticker and deletes the text message.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-1.5 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 mt-0.5">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-200">Save Any Sticker</h4>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Swipe-to-reply to any sticker with <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded">.save</code> or <code className="text-cyan-400 bg-slate-950 px-1 py-0.5 rounded">.save my_tag</code> to index it automatically.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-800 flex justify-center">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loading}
                className="px-5 py-2.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 rounded-xl text-xs font-semibold transition-all flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Unlink Companion Session</span>
              </button>
            </div>
          </div>
        ) : status === "qr_ready" && qrDataUrl ? (
          <div>
            <div className="w-12 h-12 rounded-2xl bg-amber-950/80 border border-amber-800 flex items-center justify-center mx-auto mb-3 text-amber-400">
              <QrCode className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-slate-100">Link WhatsApp Companion Device</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Scan this QR code using WhatsApp on your phone to link this service as a companion device.
            </p>

            <div className="my-6 inline-block bg-white p-4 rounded-2xl shadow-xl">
              <img src={qrDataUrl} alt="WhatsApp QR Code" className="w-64 h-64 mx-auto" />
            </div>

            <ol className="text-left max-w-sm mx-auto space-y-2 text-xs text-slate-400 list-decimal list-inside bg-slate-900/60 p-4 rounded-xl border border-slate-800">
              <li>Open WhatsApp on your phone</li>
              <li>Tap <strong className="text-slate-200">Settings</strong> &gt; <strong className="text-slate-200">Linked Devices</strong></li>
              <li>Tap <strong className="text-slate-200">Link a Device</strong></li>
              <li>Point your phone camera at this screen</li>
            </ol>
          </div>
        ) : (
          <div>
            <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-400">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold text-slate-100">WhatsApp Companion Disconnected</h2>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              The companion socket is currently offline. Click below to establish connection and generate a QR pairing code.
            </p>

            <div className="mt-6">
              <button
                type="button"
                onClick={handleConnect}
                disabled={loading}
                className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 transition-all inline-flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                <span>Initialize WhatsApp Connection</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

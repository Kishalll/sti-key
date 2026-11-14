import { useState } from "react";
import { Header } from "./components/Header";
import { LibraryTab } from "./components/LibraryTab";
import { ImporterTab } from "./components/ImporterTab";
import { WhatsAppTab } from "./components/WhatsAppTab";
import { PickerOverlay } from "./components/PickerOverlay";
import { ToastContainer } from "./components/ToastContainer";
import { useWebSocket } from "./hooks/useWebSocket";

export function App() {
  const [activeTab, setActiveTab] = useState<"library" | "importer" | "whatsapp">("library");
  const {
    status,
    qrDataUrl,
    activePicker,
    toasts,
    selectSticker,
    cancelPicker,
    dismissToast,
  } = useWebSocket();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        status={status}
      />

      <main className="flex-1">
        {activeTab === "library" && <LibraryTab />}
        {activeTab === "importer" && (
          <ImporterTab onStickerAdded={() => setActiveTab("library")} />
        )}
        {activeTab === "whatsapp" && (
          <WhatsAppTab status={status} qrDataUrl={qrDataUrl} />
        )}
      </main>

      {/* Floating Interactive Picker Overlay */}
      {activePicker && (
        <PickerOverlay
          picker={activePicker}
          onSelect={selectSticker}
          onCancel={cancelPicker}
        />
      )}

      {/* Floating Real-Time Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;

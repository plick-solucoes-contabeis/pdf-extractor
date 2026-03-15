import React from "react";
import { DataView } from "@pdf-extractor/data-view";

export function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-white">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h1 className="text-lg font-semibold text-gray-800">XLSX Extractor Playground</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <DataView />
      </div>
    </div>
  );
}

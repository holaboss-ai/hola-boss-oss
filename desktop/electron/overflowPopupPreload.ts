import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overflowPopup", {
  openDownloads: () =>
    ipcRenderer.invoke("browser:overflowOpenDownloads") as Promise<void>,
  openHistory: () =>
    ipcRenderer.invoke("browser:overflowOpenHistory") as Promise<void>,
  importChrome: () =>
    ipcRenderer.invoke("browser:overflowImportChrome") as Promise<void>,
});

const { contextBridge, ipcRenderer } = require("electron");

const backendBaseUrlArg = process.argv.find((arg) => arg.startsWith("--dataforge-backend-base-url="));
const backendBaseUrl = backendBaseUrlArg ? backendBaseUrlArg.split("=").slice(1).join("=") : "";

contextBridge.exposeInMainWorld("dataforgeDesktop", {
  backendBaseUrl,
  getAppInfo: () => ipcRenderer.invoke("desktop:get-app-info"),
  openPath: (targetPath) => ipcRenderer.invoke("desktop:open-path", targetPath),
});

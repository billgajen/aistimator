/**
 * T-194: the 3D viewer the app opens. It is the web's own (/room-model), shown in
 * Safari's in-app browser on an iPhone and in the phone's own browser on Android
 * (T-201), so the app draws the same model as the dashboard with no 3D library of
 * its own. The model's signed address goes after "#", which the
 * browser never sends to a server. Pure.
 */
export function viewerAddress(webUrl: string, modelUrl: string, areaName: string): string {
  const base = webUrl.replace(/\/+$/, '')
  return `${base}/room-model#src=${encodeURIComponent(modelUrl)}&name=${encodeURIComponent(areaName.slice(0, 60))}`
}

declare global {
  interface Window {
    variantSupportLoaded?: boolean;
  }
}
window.variantSupportLoaded = true;
export {};

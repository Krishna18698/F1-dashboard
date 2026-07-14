/** Shared TrackStatus code → label/colour mapping (feed codes from F1's TrackStatus topic). */
export function trackStatusInfo(s?: string): { label: string; color: string; calm: boolean } {
  switch (s) {
    case "1": return { label: "Track Clear", color: "#3fa34d", calm: true };
    case "2": return { label: "Yellow Flag", color: "#f5c518", calm: false };
    case "4": return { label: "Safety Car", color: "#ff8000", calm: false };
    case "5": return { label: "Red Flag", color: "#e10600", calm: false };
    case "6": return { label: "Virtual Safety Car", color: "#ff8000", calm: false };
    case "7": return { label: "VSC Ending", color: "#f5c518", calm: false };
    default: return { label: "Race Control", color: "#8a8a92", calm: true };
  }
}

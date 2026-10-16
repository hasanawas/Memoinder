// Plain-language labels for delivery states. Kept deliberately honest: "sent"
// never claims you saw anything.

import type { DeliveryView } from "./data";

export const STATUS_LABEL: Record<DeliveryView["status"], string> = {
  clicked: "Shown and opened",
  displayed: "Shown on your device",
  sent: "Sent, not yet confirmed by a device",
  failed: "Sending failed",
  expired: "Device no longer subscribed",
  no_device: "Not sent: notifications are off on all your devices",
  missed: "Missed (more than a day late, not sent)",
};

export function statusLabel(d: Pick<DeliveryView, "status" | "lateness">): string {
  const label = STATUS_LABEL[d.status];
  return d.lateness === "late" && d.status !== "missed" ? `${label} (late)` : label;
}

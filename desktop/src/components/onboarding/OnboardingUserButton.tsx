import { useRef } from "react";
import { User2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OnboardingUserButton() {
  const ref = useRef<HTMLButtonElement | null>(null);

  return (
    <Button
      ref={ref}
      variant="outline"
      size="icon"
      aria-label="Open account menu"
      onClick={() => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        void window.electronAPI.auth.togglePopup({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }}
    >
      <User2 size={14} />
    </Button>
  );
}

import { ChatPane } from "@/components/panes/ChatPane";

export function OnboardingPane({
  onOutputsChanged,
  focusRequestKey = 0
}: {
  onOutputsChanged?: () => void;
  focusRequestKey?: number;
}) {
  return <ChatPane onOutputsChanged={onOutputsChanged} focusRequestKey={focusRequestKey} variant="onboarding" />;
}

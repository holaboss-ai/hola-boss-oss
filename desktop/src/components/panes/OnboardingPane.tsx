import { ChatPane } from "@/components/panes/ChatPane";

export function OnboardingPane({
  onOpenOutput,
  focusRequestKey = 0
}: {
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
  focusRequestKey?: number;
}) {
  return (
    <ChatPane
      onOpenOutput={onOpenOutput}
      focusRequestKey={focusRequestKey}
      variant="onboarding"
    />
  );
}

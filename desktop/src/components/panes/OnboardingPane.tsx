import { ChatPane } from "@/components/panes/ChatPane";

export function OnboardingPane({
  onOutputsChanged,
  onOpenOutput,
  focusRequestKey = 0
}: {
  onOutputsChanged?: () => void;
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
  focusRequestKey?: number;
}) {
  return (
    <ChatPane
      onOutputsChanged={onOutputsChanged}
      onOpenOutput={onOpenOutput}
      focusRequestKey={focusRequestKey}
      variant="onboarding"
    />
  );
}

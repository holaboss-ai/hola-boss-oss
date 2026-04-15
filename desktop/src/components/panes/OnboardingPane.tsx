import { ChatPane } from "@/components/panes/ChatPane";

export function OnboardingPane({
  onOpenOutput,
  onSyncFileDisplayFromAgentOperation,
  focusRequestKey = 0
}: {
  onOpenOutput?: (output: WorkspaceOutputRecordPayload) => void;
  onSyncFileDisplayFromAgentOperation?: (path: string) => void;
  focusRequestKey?: number;
}) {
  return (
    <ChatPane
      onOpenOutput={onOpenOutput}
      onSyncFileDisplayFromAgentOperation={
        onSyncFileDisplayFromAgentOperation
      }
      focusRequestKey={focusRequestKey}
      variant="onboarding"
    />
  );
}

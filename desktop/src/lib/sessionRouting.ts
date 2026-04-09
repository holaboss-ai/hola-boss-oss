const ONBOARDING_ACTIVE_STATUSES = new Set(["pending", "awaiting_confirmation", "in_progress"]);

function isPrimaryChatSessionKind(kind: string | null | undefined): boolean {
  const normalized = (kind || "").trim().toLowerCase();
  return !normalized || normalized === "workspace_session";
}

export function sessionSelectionUsesOnboarding(workspace: WorkspaceRecordPayload | null): boolean {
  if (!workspace) {
    return false;
  }
  const onboardingSessionId = (workspace.onboarding_session_id || "").trim();
  if (!onboardingSessionId) {
    return false;
  }
  const onboardingStatus = (workspace.onboarding_status || "").trim().toLowerCase();
  return ONBOARDING_ACTIVE_STATUSES.has(onboardingStatus);
}

export function preferredSessionId(
  workspace: WorkspaceRecordPayload | null,
  runtimeStates: SessionRuntimeRecordPayload[],
  sessions: AgentSessionRecordPayload[] = []
): string | null {
  if (!workspace) {
    return runtimeStates[0]?.session_id ?? sessions[0]?.session_id ?? null;
  }
  if (sessionSelectionUsesOnboarding(workspace)) {
    const onboardingSessionId = (workspace.onboarding_session_id || "").trim();
    if (onboardingSessionId) {
      return onboardingSessionId;
    }
  }

  const onboardingSessionId = (workspace.onboarding_session_id || "").trim();
  const preferredPrimary = sessions.find((session) => {
    if (session.session_id === onboardingSessionId) {
      return false;
    }
    return isPrimaryChatSessionKind(session.kind);
  });
  if (preferredPrimary) {
    return preferredPrimary.session_id;
  }

  const runtimeFallback = runtimeStates.find(
    (state) => state.session_id !== onboardingSessionId,
  );
  if (runtimeFallback) {
    return runtimeFallback.session_id;
  }

  const sessionFallback =
    sessions.find((session) => session.session_id !== onboardingSessionId) ??
    sessions[0] ??
    null;
  return sessionFallback?.session_id ?? null;
}

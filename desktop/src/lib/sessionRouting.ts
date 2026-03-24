const ONBOARDING_ACTIVE_STATUSES = new Set(["pending", "awaiting_confirmation", "in_progress"]);

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
  runtimeStates: SessionRuntimeRecordPayload[]
): string | null {
  if (!workspace) {
    return runtimeStates[0]?.session_id ?? null;
  }
  if (sessionSelectionUsesOnboarding(workspace)) {
    const onboardingSessionId = (workspace.onboarding_session_id || "").trim();
    if (onboardingSessionId) {
      return onboardingSessionId;
    }
  }

  const mainSessionId = (workspace.main_session_id || "").trim();
  if (mainSessionId) {
    return mainSessionId;
  }
  return runtimeStates[0]?.session_id ?? null;
}

export type AgentPreviewSubjectMode = 'editorial_model' | 'customer_photo';

export function agentPreviewPrompt(subjectMode: AgentPreviewSubjectMode) {
  if (subjectMode === 'customer_photo') {
    return 'On the ÉLANE Style Studio page I already have open, create a complete preview of my currently staged outfit on me. If I have not already attached a clear full-body photo in this conversation, ask me to attach one first. Generate the finished image here. Treat it as a visual concept, not proof of fit or sizing.';
  }

  return 'On the ÉLANE Style Studio page I already have open, create a complete preview of my currently staged outfit on an editorial model. Generate the finished image in this conversation. Treat it as a visual concept, not proof of fit or sizing.';
}

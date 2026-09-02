import { decisionMakerSelectionValue } from '../protocol/decision-makers.mjs';

export function resolveSelfReportSelection(selected, otherName, participants = []) {
  const value = String(selected || '');
  if (value.startsWith('participant:') || value.startsWith('owner:')) {
    const [selectedRole, id] = value.split(':', 2);
    const participant = participants.find((item) => item?.id === id);
    if (participant && decisionMakerSelectionValue(participant) === value) {
      return {
        explicit: true,
        mode: selectedRole,
        label: participant.name,
        report: { id: participant.id, name: participant.name },
      };
    }
  }
  if (value === 'other') {
    const name = String(otherName || '').trim();
    return {
      explicit: Boolean(name),
      mode: 'other',
      label: name,
      report: name ? { name } : undefined,
    };
  }
  if (value === 'anonymous') {
    return { explicit: true, mode: 'anonymous', label: '匿名', report: undefined };
  }
  return { explicit: false, mode: '', label: '', report: undefined };
}

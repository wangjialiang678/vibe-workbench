export function resolveSelfReportSelection(selected, otherName, participants = []) {
  const value = String(selected || '');
  if (value.startsWith('participant:')) {
    const id = value.slice('participant:'.length);
    const participant = participants.find((item) => item?.id === id);
    if (participant) {
      return {
        explicit: true,
        mode: 'participant',
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

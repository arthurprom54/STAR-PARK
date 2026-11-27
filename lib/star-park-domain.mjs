export function normalizePlayerTag(value) {
  return String(value ?? '').replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
}

export function applicationWasApproved(application) {
  if (!Array.isArray(application?.history)) return false;
  const finalDecision = application.history.slice().reverse().find(entry => ['APPROVED', 'REJECTED', 'CANCELLED'].includes(entry?.status));
  return finalDecision?.status === 'APPROVED';
}

export function memberAccountEligible(member, applications) {
  if (!member || member.status !== 'ACTIVE' || !member.applicationId || !Array.isArray(applications)) return false;
  const application = applications.find(item => item?.id === member.applicationId);
  if (!application || application.status !== 'ACTIVE' || !applicationWasApproved(application)) return false;
  const originalTag = normalizePlayerTag(application.playerTag);
  const acceptedTags = new Set([
    normalizePlayerTag(member.playerTag),
    ...(Array.isArray(member.previousPlayerTags) ? member.previousPlayerTags.map(normalizePlayerTag) : []),
    ...(Array.isArray(member.tagHistory) ? member.tagHistory.map(item => normalizePlayerTag(item?.playerTag)) : []),
  ].filter(Boolean));
  return Boolean(originalTag && acceptedTags.has(originalTag));
}

export function accountRoles(user) {
  const roles = new Set(Array.isArray(user?.roles) ? user.roles : []);
  if (user?.role) roles.add(user.role);
  if (user?.memberId) roles.add('MEMBER');
  return [...roles];
}

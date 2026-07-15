export function isAuditedCompetitionFeatureMutation(method: string, path: string) {
  return method === 'PUT' && /^\/seasons\/[^/]+\/features$/.test(path);
}

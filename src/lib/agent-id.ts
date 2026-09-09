/** Extract the human-readable ERC-8004 token ID from a registry identifier. */
export function displayAgentId(agentId: string): string {
  const tokenId = agentId.split(":").at(-1)?.trim();
  return tokenId || agentId;
}

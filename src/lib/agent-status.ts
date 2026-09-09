import type { Agent } from "./types";

export type EndpointStatus = {
  label: "Live" | "Down" | "Unchecked";
  dot: string;
  text: string;
  title: string;
};

/**
 * Turns 8004scan's health data into something displayable. "Unchecked" is a real
 * third state — 8004scan only publishes a score for a minority of agents, and
 * having no score must not be shown as either working or broken.
 */
export function endpointStatus(agent: Agent): EndpointStatus {
  if (!agent.healthChecked) {
    return {
      label: "Unchecked",
      dot: "bg-[#4a4a4a]",
      text: "text-[#7c7c7c]",
      title: "This agent's endpoint has not been checked yet",
    };
  }
  if (agent.healthScore >= 50) {
    return {
      label: "Live",
      dot: "bg-[#33fba1]",
      text: "text-[#8fdcb8]",
      title: `Endpoint answered its last check (health ${Math.round(agent.healthScore)}/100)`,
    };
  }
  return {
    label: "Down",
    dot: "bg-[#e5484d]",
    text: "text-[#c98b8d]",
    title: `Endpoint failed its last check (health ${Math.round(agent.healthScore)}/100)`,
  };
}

/**
 * Confirmed answering — 8004scan checked the endpoint and enough services
 * replied. The single precondition for "this agent can execute right now",
 * and the marketplace's primary sort key. Mirrors isRespondingAgent in
 * scan8004.ts, which cannot be imported into client components.
 */
export function isLiveAgent(agent: Pick<Agent, "healthChecked" | "healthScore">): boolean {
  return agent.healthChecked && agent.healthScore >= 50;
}

/**
 * Relative time for onchain timestamps ("3 days ago"). Empty string for
 * missing or future dates, so callers can simply render nothing.
 */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Keyword match over an agent's name and description. Short keywords like "LP"
 * and "APR" are matched on word boundaries so they cannot hit "help" or "apron".
 */
export function agentMatchesKeywords(agent: Agent, keywords: readonly string[]): boolean {
  const text = `${agent.name} ${agent.description}`.toLowerCase();
  return keywords.some((keyword) => {
    const needle = keyword.toLowerCase().trim();
    if (!needle) return false;
    if (needle.length <= 3) {
      return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text);
    }
    return text.includes(needle);
  });
}
